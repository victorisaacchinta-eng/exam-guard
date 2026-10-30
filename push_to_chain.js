// Seals an exam paper: writes its SHA-256 fingerprint to Cardano preprod
// (metadata label 674) from the board's wallet, then records the seal in
// registry.json so the site can find it.
//
//   node push_to_chain.js --file samples/physics-midsem-2026.pdf \
//     --exam "Physics Mid-Semester 2026 (mock)" --id physics-midsem-2026
//
// Add --dry-run to see the record without touching the network.
// The wallet comes from BLOCKFROST_KEY and MNEMONIC in the environment or a
// .env file; a CommonJS secrets.cjs (or the old secrets.js) also works.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkExamName, buildMetadata, isFingerprint, validateRegistry } from "./assets/core.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REGISTRY = resolve(ROOT, "registry.json");

const USAGE = `Usage: node push_to_chain.js --file <paper.pdf> --exam "<name>" [--id <slug>] [--dry-run] [--force]

  --file     the final paper, exactly as it will be distributed
  --exam     name stored on the ledger, at most 64 bytes
  --id       registry id for the seal (default: made from --exam)
  --dry-run  print the record and stop; nothing is signed or sent
  --force    seal even if this fingerprint is already in registry.json

With no --file, the old flow is used: record.json from hash_check.py.`;

export function parseArgs(argv) {
  const opts = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--file" || a === "--exam" || a === "--id") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = v;
    } else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

export function slugify(name) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "seal";
}

export function hashFile(path) {
  return new Promise((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(path).on("error", fail).on("data", (c) => h.update(c)).on("end", () => ok(h.digest("hex")));
  });
}

// Everything that can be checked before a wallet is involved.
export async function prepareSeal(opts, { registry } = {}) {
  let exam, fingerprint, file = null;
  if (opts.file) {
    if (!existsSync(opts.file)) throw new Error(`No such file: ${opts.file}`);
    file = opts.file;
    fingerprint = await hashFile(opts.file);
    const named = checkExamName(opts.exam);
    if (!named.ok) throw new Error(named.error);
    exam = named.name;
  } else {
    const recordPath = resolve(ROOT, "record.json");
    if (!existsSync(recordPath)) throw new Error("Pass --file and --exam (or create record.json with hash_check.py).");
    const rec = JSON.parse(readFileSync(recordPath, "utf8"));
    const named = checkExamName(rec.exam_name);
    if (!named.ok) throw new Error(`record.json: ${named.error}`);
    exam = named.name;
    fingerprint = rec.fingerprint;
  }
  if (!isFingerprint(fingerprint)) throw new Error("The fingerprint must be 64 lowercase hex characters.");

  const reg = registry ? validateRegistry(registry) : { seals: [] };
  const dup = reg.seals.find((s) => s.fingerprint === fingerprint);
  if (dup && !opts.force) throw new Error(`This file is already sealed as "${dup.exam}" (${dup.id}). Use --force to seal it again.`);

  const taken = new Set(reg.seals.map((s) => s.id));
  let id = opts.id ? slugify(opts.id) : slugify(exam);
  if (taken.has(id)) {
    if (opts.id) throw new Error(`Registry id ${id} is already used.`);
    let n = 2;
    while (taken.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  return { id, exam, fingerprint, file, metadata: buildMetadata(exam, fingerprint) };
}

export function addToRegistry(registry, { id, exam, fingerprint, tx, issuerAddress, file }) {
  const next = structuredClone(registry);
  next.issuers ||= {};
  let issuer = Object.entries(next.issuers).find(([, v]) => v.address === issuerAddress)?.[0];
  if (!issuer) {
    issuer = `wallet-${issuerAddress.slice(-8)}`;
    next.issuers[issuer] = { name: "Board wallet", address: issuerAddress };
  }
  next.seals ||= [];
  next.seals.push({ id, exam, fingerprint, tx, issuer, sample: file && file.startsWith("samples/") ? file : null });
  return next;
}

function loadSecrets() {
  const envFile = resolve(ROOT, ".env");
  if (existsSync(envFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(envFile);
  if (process.env.BLOCKFROST_KEY && process.env.MNEMONIC) {
    return { key: process.env.BLOCKFROST_KEY, words: process.env.MNEMONIC.trim().split(/\s+/) };
  }
  const require = createRequire(import.meta.url);
  for (const name of ["secrets.cjs", "secrets.js"]) {
    const p = resolve(ROOT, name);
    if (!existsSync(p)) continue;
    try {
      const s = require(p);
      const words = Array.isArray(s.MNEMONIC) ? s.MNEMONIC : String(s.MNEMONIC || "").trim().split(/\s+/);
      if (s.BLOCKFROST_KEY && words.length >= 12) return { key: s.BLOCKFROST_KEY, words };
    } catch {
      throw new Error(`${name} could not be loaded. Rename a CommonJS secrets.js to secrets.cjs, or use .env.`);
    }
  }
  throw new Error("No wallet found. Put BLOCKFROST_KEY and MNEMONIC in .env (see .env.example).");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(USAGE);
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  const seal = await prepareSeal(opts, { registry });
  console.log("Paper:      ", seal.exam);
  console.log("Fingerprint:", seal.fingerprint);
  console.log("Registry id:", seal.id);
  console.log("Metadata:   ", JSON.stringify(seal.metadata));
  if (opts.dryRun) return console.log("\nDry run: nothing was signed or sent.");

  const { key, words } = loadSecrets();
  if (!key.startsWith("preprod")) throw new Error("BLOCKFROST_KEY is not a preprod project key. Exam Guard only seals on preprod.");

  const { MeshWallet, Transaction, BlockfrostProvider } = await import("@meshsdk/core");
  const provider = new BlockfrostProvider(key);
  const wallet = new MeshWallet({ networkId: 0, fetcher: provider, submitter: provider, key: { type: "mnemonic", words } });
  await wallet.init();
  const address = await wallet.getChangeAddress();

  // 1 ADA back to our own address is the smallest valid transaction that can
  // carry metadata; only the fee is spent.
  const tx = new Transaction({ initiator: wallet });
  tx.sendLovelace({ address }, "1000000");
  tx.setMetadata(674, seal.metadata[674]);
  const signed = await wallet.signTx(await tx.build());
  const txHash = await wallet.submitTx(signed);

  writeFileSync(resolve(ROOT, "record.json"), JSON.stringify({ exam_name: seal.exam, fingerprint: seal.fingerprint, tx: txHash }) + "\n");
  writeFileSync(REGISTRY, JSON.stringify(addToRegistry(registry, { ...seal, tx: txHash, issuerAddress: address }), null, 2) + "\n");
  console.log("\nSealed. Transaction:", txHash);
  console.log(`https://preprod.cardanoscan.io/transaction/${txHash}`);
  console.log("registry.json now lists it. The block usually lands within a minute; commit registry.json to publish the seal on the site.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}
