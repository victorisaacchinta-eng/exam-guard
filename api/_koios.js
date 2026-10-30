// Reads Exam Guard seals from Cardano through Koios.
// Koios answers preflight requests but leaves Access-Control-Allow-Origin off
// the real responses, so browsers cannot call it directly. This module runs
// on the server (Vercel function and the local dev server) instead.

export const KOIOS_BASE = {
  preprod: "https://preprod.koios.rest/api/v1",
  preview: "https://preview.koios.rest/api/v1",
  mainnet: "https://api.koios.rest/api/v1",
};
export const TX_RE = /^[0-9a-f]{64}$/;
export const MAX_TX_PER_REQUEST = 20;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

export function parseTxList(raw) {
  if (typeof raw !== "string" || raw.length === 0) return { error: "Pass one or more transaction hashes as ?tx=hash1,hash2" };
  const list = [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0) return { error: "No transaction hashes given" };
  if (list.length > MAX_TX_PER_REQUEST) return { error: `At most ${MAX_TX_PER_REQUEST} transactions per request` };
  const bad = list.find((t) => !TX_RE.test(t));
  if (bad) return { error: "Transaction hashes are 64 lowercase hex characters" };
  return { list };
}

async function call(fetchImpl, url, init, { timeoutMs, retries }) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`upstream ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err && /upstream 4\d\d/.test(err.message) && !/429/.test(err.message)) break;
    }
  }
  throw lastErr;
}

// Keeps only what the page needs, and only if it has the expected shape.
export function normaliseTx(raw, tipHeight) {
  const inputs = Array.isArray(raw.inputs) ? raw.inputs : [];
  const inputAddresses = [...new Set(inputs.map((i) => i?.payment_addr?.bech32).filter((a) => typeof a === "string"))];
  let metadata = null;
  const m = raw.metadata && typeof raw.metadata === "object" ? raw.metadata["674"] : null;
  if (m && typeof m === "object" && typeof m.fingerprint === "string") {
    const fingerprint = m.fingerprint.trim().toLowerCase();
    if (FINGERPRINT_RE.test(fingerprint)) {
      metadata = { fingerprint, exam: typeof m.exam === "string" ? m.exam.slice(0, 64) : null };
    }
  }
  const blockHeight = Number.isInteger(raw.block_height) ? raw.block_height : null;
  return {
    tx: raw.tx_hash,
    found: true,
    blockHeight,
    blockTime: Number.isInteger(raw.tx_timestamp) ? raw.tx_timestamp : null,
    confirmations: blockHeight !== null && Number.isInteger(tipHeight) ? Math.max(0, tipHeight - blockHeight + 1) : null,
    inputAddresses,
    metadata,
  };
}

export async function readSeals(txs, { network = "preprod", fetchImpl = fetch, timeoutMs = 8000, retries = 1 } = {}) {
  const base = KOIOS_BASE[network];
  if (!base) throw new Error(`Unknown network ${network}`);
  const opts = { timeoutMs, retries };
  const [txInfo, tip] = await Promise.all([
    call(fetchImpl, `${base}/tx_info`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _tx_hashes: txs, _inputs: true, _metadata: true, _assets: false,
        _withdrawals: false, _certs: false, _scripts: false, _bytecode: false,
      }),
    }, opts),
    call(fetchImpl, `${base}/tip`, { headers: { Accept: "application/json" } }, opts).catch(() => null),
  ]);
  if (!Array.isArray(txInfo)) throw new Error("upstream returned an unexpected shape");
  const tipHeight = Array.isArray(tip) && Number.isInteger(tip[0]?.block_height) ? tip[0].block_height : null;
  const byHash = new Map(txInfo.filter((t) => t && typeof t.tx_hash === "string").map((t) => [t.tx_hash, t]));
  return {
    network,
    tip: tipHeight === null ? null : { blockHeight: tipHeight, blockTime: tip[0].block_time ?? null },
    seals: txs.map((tx) => (byHash.has(tx) ? normaliseTx(byHash.get(tx), tipHeight) : { tx, found: false })),
  };
}
