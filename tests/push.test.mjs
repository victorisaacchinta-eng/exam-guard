import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parseArgs, slugify, prepareSeal, addToRegistry, hashFile } from "../push_to_chain.js";

const registry = JSON.parse(readFileSync(new URL("../registry.json", import.meta.url)));
const MOCK = "samples/physics-midsem-2026.pdf";
// sample_exam.pdf is the file behind the first on-chain seal; skip its checks if it is removed.
const HAS_FIRST = existsSync("sample_exam.pdf");

test("parseArgs", () => {
  assert.deepEqual(parseArgs(["--file", "a.pdf", "--exam", "X", "--dry-run"]), { file: "a.pdf", exam: "X", dryRun: true, force: false });
  assert.throws(() => parseArgs(["--file"]), /needs a value/);
  assert.throws(() => parseArgs(["--file", "--exam"]), /needs a value/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
});

test("slugify", () => {
  assert.equal(slugify("Physics Mid-Sem 2026"), "physics-mid-sem-2026");
  assert.equal(slugify("  ***  "), "seal");
});

test("hashFile matches the known fingerprint of the hackathon file", { skip: !HAS_FIRST }, async () => {
  assert.equal(await hashFile("sample_exam.pdf"), "ee47d1dab3dd41ada1687923306bd864523bf1ac53269fb681e183e6ddc3c581");
});

test("prepareSeal validates before any wallet is used", async () => {
  const s = await prepareSeal({ file: MOCK, exam: "Physics Mid-Semester 2026 (mock)", id: "physics-midsem-2026" }, { registry });
  assert.equal(s.id, "physics-midsem-2026");
  assert.equal(s.metadata[674].fingerprint, s.fingerprint);
  await assert.rejects(prepareSeal({ file: "nope.pdf", exam: "X" }, { registry }), /No such file/);
  await assert.rejects(prepareSeal({ file: MOCK, exam: "x".repeat(65) }, { registry }), /Too long/);
  await assert.rejects(prepareSeal({ file: MOCK }, { registry }), /name/);
  if (HAS_FIRST) {
    await assert.rejects(prepareSeal({ file: "sample_exam.pdf", exam: "Again" }, { registry }), /already sealed/);
    assert.ok(await prepareSeal({ file: "sample_exam.pdf", exam: "Again", force: true }, { registry }));
  }
  await assert.rejects(prepareSeal({ file: MOCK, exam: "X", id: "physics-midsem-2026-hackathon" }, { registry }), /already used/);
});

test("prepareSeal makes a fresh id when the name repeats", async () => {
  const reg = structuredClone(registry);
  reg.seals.push({ ...reg.seals[0], id: "physics-mid-sem-2026", fingerprint: "a".repeat(64) });
  const s = await prepareSeal({ file: MOCK, exam: "Physics Mid-Sem 2026" }, { registry: reg });
  assert.equal(s.id, "physics-mid-sem-2026-2");
});

test("addToRegistry reuses a known wallet and adds an unknown one", () => {
  const known = registry.issuers["team-pragmatic"].address;
  const a = addToRegistry(registry, { id: "x", exam: "X", fingerprint: "b".repeat(64), tx: "c".repeat(64), issuerAddress: known, file: MOCK });
  assert.equal(a.seals.at(-1).issuer, "team-pragmatic");
  assert.equal(a.seals.at(-1).sample, MOCK);
  assert.equal(registry.seals.length, 1, "input is not mutated");
  const b = addToRegistry(registry, { id: "y", exam: "Y", fingerprint: "b".repeat(64), tx: "c".repeat(64), issuerAddress: "addr_test1zzzzzzzz12345678", file: "/tmp/p.pdf" });
  assert.ok(b.issuers["wallet-12345678"]);
  assert.equal(b.seals.at(-1).sample, null);
});

test("CLI dry run prints the record and exits 0; errors exit 1", () => {
  const out = execFileSync("node", ["push_to_chain.js", "--file", MOCK, "--exam", "Physics Mid-Semester 2026 (mock)", "--dry-run"], { encoding: "utf8" });
  assert.match(out, /Dry run: nothing was signed or sent/);
  assert.throws(() => execFileSync("node", ["push_to_chain.js", "--exam"], { stdio: "pipe" }));
});
