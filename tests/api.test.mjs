import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTxList, readSeals, normaliseTx, MAX_TX_PER_REQUEST } from "../api/_koios.js";
import handler from "../api/ledger.js";
import { fetchSeals, LedgerError } from "../assets/ledger.js";

const TX = "2359d5ee55cd58ff614cc364c35dbc42d29df79a67d278323c40091247ae752b";
const TX2 = "1".repeat(64);
const FP = "ee47d1dab3dd41ada1687923306bd864523bf1ac53269fb681e183e6ddc3c581";
const ADDR = "addr_test1qrypdw0wy7s9raumq7wm5aujgzsp3xd7nq8znwseksdc0wjjk4hgnxsn5eeazzev68paxg3wsaw2l53ur9yy250934ssr9hd0f";

const txInfo = {
  tx_hash: TX, block_height: 4926909, tx_timestamp: 1783839614,
  inputs: [{ payment_addr: { bech32: ADDR } }, { payment_addr: { bech32: ADDR } }],
  metadata: { 674: { exam: "Physics Mid-Sem 2026", fingerprint: FP } },
};

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Answers like Koios: POST /tx_info and GET /tip.
function koios({ info = [txInfo], tip = [{ block_height: 4926918, block_time: 1 }], fail = [] } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(url);
    const step = fail.shift();
    if (step === "network") throw new TypeError("fetch failed");
    if (typeof step === "number") return json({}, step);
    return url.endsWith("/tip") ? json(tip) : json(info);
  };
  impl.calls = calls;
  return impl;
}

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; },
    get json() { return JSON.parse(this.body); },
  };
}

test("parseTxList validates input", () => {
  assert.ok(parseTxList(undefined).error);
  assert.ok(parseTxList("").error);
  assert.ok(parseTxList(",,").error);
  assert.ok(parseTxList("xyz").error);
  assert.ok(parseTxList(`${TX},DROP TABLE`).error);
  assert.deepEqual(parseTxList(` ${TX.toUpperCase()} ,${TX}`).list, [TX]);
  assert.ok(parseTxList(Array.from({ length: MAX_TX_PER_REQUEST + 1 }, (_, i) => i.toString(16).padStart(64, "0")).join(",")).error);
});

test("normaliseTx keeps only well-formed records", () => {
  const n = normaliseTx(txInfo, 4926918);
  assert.equal(n.confirmations, 10);
  assert.deepEqual(n.inputAddresses, [ADDR]);
  assert.equal(n.metadata.fingerprint, FP);
  assert.equal(normaliseTx({ ...txInfo, metadata: { 674: { fingerprint: "zz" } } }).metadata, null);
  assert.equal(normaliseTx({ ...txInfo, metadata: { 674: { fingerprint: FP.toUpperCase() } } }).metadata.fingerprint, FP);
  assert.equal(normaliseTx({ ...txInfo, metadata: null }).metadata, null);
  assert.equal(normaliseTx({ ...txInfo, metadata: { 674: { fingerprint: FP, exam: "x".repeat(300) } } }).metadata.exam.length, 64);
  assert.equal(normaliseTx({ tx_hash: TX }).confirmations, null);
});

test("readSeals reads found and missing transactions", async () => {
  const r = await readSeals([TX, TX2], { fetchImpl: koios() });
  assert.equal(r.tip.blockHeight, 4926918);
  assert.equal(r.seals[0].found, true);
  assert.equal(r.seals[1].found, false);
});

test("readSeals retries once after a 5xx or a network error", async () => {
  const f = koios({ fail: [503] });
  const r = await readSeals([TX], { fetchImpl: f });
  assert.equal(r.seals[0].found, true);
  const g = koios({ fail: ["network"] });
  assert.equal((await readSeals([TX], { fetchImpl: g })).seals[0].found, true);
});

test("readSeals gives up after repeated failures and on bad shapes", async () => {
  await assert.rejects(readSeals([TX], { fetchImpl: koios({ fail: [500, 500, 500, 500] }) }));
  await assert.rejects(readSeals([TX], { fetchImpl: koios({ info: { not: "a list" } }) }));
  await assert.rejects(readSeals([TX], { network: "moon" }));
});

test("a missing tip does not fail the read", async () => {
  const r = await readSeals([TX], { fetchImpl: koios({ tip: "garbage" }) });
  assert.equal(r.tip, null);
  assert.equal(r.seals[0].confirmations, null);
});

test("handler: method, input and upstream errors", async () => {
  let res = fakeRes();
  await handler({ method: "POST", url: "/api/ledger" }, res);
  assert.equal(res.statusCode, 405);

  res = fakeRes();
  await handler({ method: "GET", url: "/api/ledger?tx=bad" }, res);
  assert.equal(res.statusCode, 400);

  res = fakeRes();
  await handler({ method: "GET", url: `/api/ledger?tx=${TX2}` }, res, { fetchImpl: koios() });
  assert.equal(res.statusCode, 403, "transactions outside the registry are refused");

  res = fakeRes();
  await handler({ method: "GET", url: `/api/ledger?tx=${TX}` }, res, { fetchImpl: koios() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.seals[0].metadata.fingerprint, FP);
  assert.match(res.headers["cache-control"], /s-maxage/);

  res = fakeRes();
  const original = console.error;
  console.error = () => {};
  await handler({ method: "GET", url: `/api/ledger?tx=${TX}` }, res, { fetchImpl: koios({ fail: [500, 500, 500, 500] }), allowed: new Set([TX]) });
  console.error = original;
  assert.equal(res.statusCode, 502);
  assert.equal(res.json.error, "ledger_unreachable");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("browser client turns failures into LedgerError kinds", async () => {
  const ok = await fetchSeals([TX], { fetchImpl: async () => json({ seals: [{ tx: TX, found: true }], tip: null }) });
  assert.equal(ok.seals.get(TX).found, true);
  assert.equal((await fetchSeals([], {})).seals.size, 0);

  const kinds = async (impl) => { try { await fetchSeals([TX], { fetchImpl: impl }); } catch (e) { assert.ok(e instanceof LedgerError); return e.kind; } return "none"; };
  assert.equal(await kinds(async () => { throw new TypeError("Failed to fetch"); }), "offline");
  assert.equal(await kinds(async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }), "timeout");
  assert.equal(await kinds(async () => json({ message: "down" }, 502)), "upstream");
  assert.equal(await kinds(async () => json({ seals: "nope" })), "shape");
  assert.equal(await kinds(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } })), "shape");
});
