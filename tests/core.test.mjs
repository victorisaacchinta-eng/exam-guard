import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  toHex, isFingerprint, checkExamName, checkFile, diffFingerprints, validateRegistry,
  assessSeal, decideVerdict, shortHash, buildMetadata, explorerTxUrl, MAX_FILE_BYTES,
} from "../assets/core.js";

const FP_A = "ee47d1dab3dd41ada1687923306bd864523bf1ac53269fb681e183e6ddc3c581";
const FP_B = "b37188e216f2bbe34d4d212adc552c5c7a892d50a5e24f4d652b602585a25c7a";
const TX = "2359d5ee55cd58ff614cc364c35dbc42d29df79a67d278323c40091247ae752b";
const ADDR = "addr_test1qrypdw0wy7s9raumq7wm5aujgzsp3xd7nq8znwseksdc0wjjk4hgnxsn5eeazzev68paxg3wsaw2l53ur9yy250934ssr9hd0f";

const REG = {
  network: "preprod",
  issuers: { board: { name: "Board", address: ADDR } },
  seals: [{ id: "a", exam: "Physics", fingerprint: FP_A, tx: TX, issuer: "board" }],
};
const seals = validateRegistry(REG).seals;
const chainOk = { tx: TX, found: true, blockHeight: 10, blockTime: 1783839614, inputAddresses: [ADDR], metadata: { fingerprint: FP_A, exam: "Physics" } };

test("toHex pads every byte", () => {
  assert.equal(toHex(new Uint8Array([0, 1, 15, 16, 255])), "00010f10ff");
  assert.equal(toHex(new ArrayBuffer(0)), "");
});

test("isFingerprint accepts only 64 lowercase hex characters", () => {
  assert.ok(isFingerprint(FP_A));
  assert.ok(!isFingerprint(FP_A.toUpperCase()));
  assert.ok(!isFingerprint(FP_A.slice(1)));
  assert.ok(!isFingerprint(`${FP_A.slice(0, 63)}g`));
  assert.ok(!isFingerprint(null));
});

test("exam names are limited by bytes, not characters", () => {
  assert.equal(checkExamName("  Physics Mid-Sem 2026 ").name, "Physics Mid-Sem 2026");
  assert.ok(!checkExamName("").ok);
  assert.ok(!checkExamName("   ").ok);
  assert.ok(checkExamName("x".repeat(64)).ok);
  assert.ok(!checkExamName("x".repeat(65)).ok);
  // 22 Telugu characters are 66 bytes in UTF-8: short to the eye, too long for the ledger.
  const telugu = "\u0c2d".repeat(22);
  assert.equal(telugu.length, 22);
  assert.ok(!checkExamName(telugu).ok);
  assert.ok(checkExamName("\u0c2d".repeat(21)).ok);
  assert.ok(!checkExamName(42).ok);
});

test("checkFile rejects missing, empty and oversized files", () => {
  assert.match(checkFile(null), /No file/);
  assert.match(checkFile({ size: 0 }), /empty/);
  assert.match(checkFile({ size: MAX_FILE_BYTES + 1 }), /100 MB/);
  assert.equal(checkFile({ size: 2599 }), null);
});

test("diffFingerprints counts positions", () => {
  assert.deepEqual(diffFingerprints(FP_A, FP_A), { mismatched: [], matched: 64 });
  const d = diffFingerprints(FP_A, FP_B);
  assert.equal(d.matched + d.mismatched.length, 64);
  assert.ok(d.mismatched.length > 40);
});

test("validateRegistry rejects bad rows and keeps good ones", () => {
  const r = validateRegistry({
    issuers: { board: { address: ADDR } },
    seals: [
      { id: "a", fingerprint: FP_A, tx: TX, issuer: "board" },
      { id: "a", fingerprint: FP_A, tx: TX, issuer: "board" },
      { id: "b", fingerprint: "nope", tx: TX, issuer: "board" },
      { id: "c", fingerprint: FP_A, tx: "short", issuer: "board" },
      { id: "d", fingerprint: FP_A, tx: TX, issuer: "ghost" },
      null,
    ],
  });
  assert.equal(r.seals.length, 1);
  assert.equal(r.errors.length, 5);
  assert.equal(r.seals[0].issuerAddress, ADDR);
  assert.equal(validateRegistry(null).ok, false);
  assert.equal(validateRegistry({}).seals.length, 0);
});

test("the shipped registry is valid and its demo files exist", () => {
  const reg = JSON.parse(readFileSync(new URL("../registry.json", import.meta.url)));
  const r = validateRegistry(reg);
  assert.deepEqual(r.errors, []);
  assert.ok(r.seals.length >= 1);
  assert.ok(existsSync(new URL(`../${reg.demo.original}`, import.meta.url)));
  assert.ok(existsSync(new URL(`../${reg.demo.tampered}`, import.meta.url)));
});

test("assessSeal covers every ledger outcome", () => {
  const s = seals[0];
  assert.equal(assessSeal(s, undefined).status, "unreachable");
  assert.equal(assessSeal(s, { error: "x" }).status, "unreachable");
  assert.equal(assessSeal(s, { tx: TX, found: false }).status, "missing");
  assert.equal(assessSeal(s, { ...chainOk, metadata: null }).status, "no-metadata");
  assert.equal(assessSeal(s, { ...chainOk, inputAddresses: ["addr_test1other"] }).status, "wrong-issuer");
  assert.equal(assessSeal(s, { ...chainOk, metadata: { fingerprint: FP_B } }).status, "registry-mismatch");
  assert.equal(assessSeal(s, chainOk).status, "verified");
});

test("decideVerdict in 'any paper' mode", () => {
  const ok = new Map([["a", assessSeal(seals[0], chainOk)]]);
  assert.equal(decideVerdict({ fingerprint: FP_A, claimedId: null, seals, assessments: ok }).kind, "intact");
  assert.equal(decideVerdict({ fingerprint: FP_B, claimedId: null, seals, assessments: ok }).kind, "no-seal");
  const down = new Map([["a", { status: "unreachable" }]]);
  assert.equal(decideVerdict({ fingerprint: FP_A, claimedId: null, seals, assessments: down }).kind, "unverifiable");
  // An unknown file is "no seal" even when the ledger is down: the registry alone rules it out.
  assert.equal(decideVerdict({ fingerprint: FP_B, claimedId: null, seals, assessments: down }).kind, "no-seal");
  const lying = new Map([["a", assessSeal(seals[0], { ...chainOk, metadata: { fingerprint: FP_B } })]]);
  assert.equal(decideVerdict({ fingerprint: FP_A, claimedId: null, seals, assessments: lying }).kind, "record-problem");
});

test("decideVerdict against a named paper", () => {
  const ok = new Map([["a", assessSeal(seals[0], chainOk)]]);
  assert.equal(decideVerdict({ fingerprint: FP_A, claimedId: "a", seals, assessments: ok }).kind, "intact");
  const broken = decideVerdict({ fingerprint: FP_B, claimedId: "a", seals, assessments: ok });
  assert.equal(broken.kind, "broken");
  assert.equal(broken.diff.matched + broken.diff.mismatched.length, 64);
  assert.equal(decideVerdict({ fingerprint: FP_A, claimedId: "zzz", seals, assessments: ok }).kind, "no-seal");
  const wrongSigner = new Map([["a", assessSeal(seals[0], { ...chainOk, inputAddresses: [] })]]);
  assert.equal(decideVerdict({ fingerprint: FP_A, claimedId: "a", seals, assessments: wrongSigner }).kind, "record-problem");
  assert.throws(() => decideVerdict({ fingerprint: "abc", claimedId: null, seals, assessments: ok }));
});

test("formatting helpers", () => {
  assert.equal(shortHash(TX, 4, 4), "2359…752b");
  assert.equal(shortHash("abc"), "abc");
  assert.deepEqual(buildMetadata("P", FP_A), { 674: { exam: "P", fingerprint: FP_A } });
  assert.equal(explorerTxUrl("preprod", TX), `https://preprod.cardanoscan.io/transaction/${TX}`);
  assert.equal(explorerTxUrl("mainnet", TX), `https://cardanoscan.io/transaction/${TX}`);
});
