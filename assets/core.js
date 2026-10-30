// Pure logic shared by the page, the CLI and the tests. No DOM, no network.

export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
export const TX_RE = /^[0-9a-f]{64}$/;
// Cardano caps every metadata text string at 64 bytes.
export const METADATA_TEXT_MAX = 64;
export const METADATA_LABEL = 674;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function toHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function isFingerprint(value) {
  return typeof value === "string" && FINGERPRINT_RE.test(value);
}

export function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

export function checkExamName(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return { ok: false, name, error: "Give the paper a name." };
  const bytes = utf8Length(name);
  if (bytes > METADATA_TEXT_MAX) {
    return { ok: false, name, bytes, error: `Too long for Cardano metadata: ${bytes} of ${METADATA_TEXT_MAX} bytes.` };
  }
  return { ok: true, name, bytes };
}

// Same shape as the first seal written at the hackathon, so old and new
// records are read the same way.
export function buildMetadata(exam, fingerprint) {
  return { [METADATA_LABEL]: { exam, fingerprint } };
}

export function checkFile(file) {
  if (!file) return "No file was selected.";
  if (file.size === 0) return "That file is empty (0 bytes), so there is nothing to fingerprint.";
  if (file.size > MAX_FILE_BYTES) return "That file is over 100 MB. Exam papers are far smaller, so this is probably the wrong file.";
  return null;
}

export function diffFingerprints(a, b) {
  const mismatched = [];
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) mismatched.push(i);
  return { mismatched, matched: 64 - mismatched.length };
}

export function validateRegistry(json) {
  const errors = [];
  if (!json || typeof json !== "object") return { ok: false, errors: ["Registry is not an object."], seals: [] };
  const issuers = json.issuers && typeof json.issuers === "object" ? json.issuers : {};
  const seen = new Set();
  const seals = [];
  for (const [i, s] of (Array.isArray(json.seals) ? json.seals : []).entries()) {
    const where = `seals[${i}]`;
    if (!s || typeof s !== "object") { errors.push(`${where} is not an object`); continue; }
    if (typeof s.id !== "string" || !s.id) { errors.push(`${where} has no id`); continue; }
    if (seen.has(s.id)) { errors.push(`${where} repeats id ${s.id}`); continue; }
    if (!isFingerprint(s.fingerprint)) { errors.push(`${where} has a bad fingerprint`); continue; }
    if (typeof s.tx !== "string" || !TX_RE.test(s.tx)) { errors.push(`${where} has a bad transaction hash`); continue; }
    const issuer = issuers[s.issuer];
    if (!issuer || typeof issuer.address !== "string") { errors.push(`${where} names an unknown issuer`); continue; }
    seen.add(s.id);
    seals.push({ ...s, issuerName: issuer.name || s.issuer, issuerAddress: issuer.address });
  }
  return { ok: errors.length === 0, errors, seals, demo: json.demo || null, network: json.network || "preprod" };
}

// Compares one registry entry with what the ledger returned for its transaction.
export function assessSeal(seal, chain) {
  if (!chain) return { status: "unreachable" };
  if (chain.error) return { status: "unreachable", detail: chain.error };
  if (!chain.found) return { status: "missing" };
  const meta = chain.metadata;
  if (!meta || !isFingerprint(meta.fingerprint)) return { status: "no-metadata", chain };
  if (!Array.isArray(chain.inputAddresses) || !chain.inputAddresses.includes(seal.issuerAddress)) {
    return { status: "wrong-issuer", chain };
  }
  if (meta.fingerprint !== seal.fingerprint) return { status: "registry-mismatch", chain };
  return { status: "verified", chain };
}

export const SEAL_STATUS_TEXT = {
  verified: "Read from the ledger and matches",
  unreachable: "Ledger could not be reached",
  missing: "Transaction not found on the ledger",
  "no-metadata": "Transaction carries no Exam Guard record",
  "wrong-issuer": "Signed by a different wallet",
  "registry-mismatch": "Registry and ledger disagree",
};

/**
 * Decides what to tell the person who dropped a file.
 * claimedId: the seal they say this file should match, or null for "any".
 * assessments: Map of seal id -> result of assessSeal.
 */
export function decideVerdict({ fingerprint, claimedId, seals, assessments }) {
  if (!isFingerprint(fingerprint)) throw new Error("decideVerdict needs a 64-character fingerprint");

  if (claimedId) {
    const seal = seals.find((s) => s.id === claimedId);
    if (!seal) return { kind: "no-seal", reason: "unknown-claim" };
    const a = assessments.get(seal.id);
    if (!a || a.status === "unreachable") return { kind: "unverifiable", seal, assessment: a };
    if (a.status !== "verified") return { kind: "record-problem", seal, assessment: a };
    const onChain = a.chain.metadata.fingerprint;
    if (onChain === fingerprint) return { kind: "intact", seal, assessment: a };
    return { kind: "broken", seal, assessment: a, diff: diffFingerprints(fingerprint, onChain) };
  }

  const matches = seals.filter((s) => s.fingerprint === fingerprint);
  if (matches.length === 0) return { kind: "no-seal" };
  // Prefer a match the ledger confirms; otherwise report the first problem.
  for (const seal of matches) {
    const a = assessments.get(seal.id);
    if (a && a.status === "verified" && a.chain.metadata.fingerprint === fingerprint) {
      return { kind: "intact", seal, assessment: a };
    }
  }
  const seal = matches[0];
  const a = assessments.get(seal.id);
  if (!a || a.status === "unreachable") return { kind: "unverifiable", seal, assessment: a };
  return { kind: "record-problem", seal, assessment: a };
}

export function shortHash(hex, head = 8, tail = 8) {
  if (typeof hex !== "string" || hex.length <= head + tail + 1) return hex || "";
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatBlockTime(unixSeconds, locale, timeZone) {
  if (!Number.isFinite(unixSeconds)) return "";
  const d = new Date(unixSeconds * 1000);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone, timeZoneName: "short",
  }).format(d);
}

export function explorerTxUrl(network, tx) {
  const host = network === "mainnet" ? "cardanoscan.io" : `${network}.cardanoscan.io`;
  return `https://${host}/transaction/${tx}`;
}
