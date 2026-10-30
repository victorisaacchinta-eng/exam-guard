// Browser client for /api/ledger. Returns a Map of tx hash -> seal record,
// or throws a LedgerError the page can explain.

export class LedgerError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // "offline" | "timeout" | "upstream" | "shape"
  }
}

function checkShape(body) {
  if (!body || !Array.isArray(body.seals)) return false;
  return body.seals.every((s) => s && typeof s.tx === "string" && typeof s.found === "boolean");
}

export async function fetchSeals(txs, { fetchImpl = fetch, timeoutMs = 12000, endpoint = "/api/ledger" } = {}) {
  if (txs.length === 0) return { seals: new Map(), tip: null };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new LedgerError("You are offline. The fingerprint is ready, but the ledger cannot be read.", "offline");
  }
  let res;
  try {
    res = await fetchImpl(`${endpoint}?tx=${txs.join(",")}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new LedgerError(
      timedOut ? "The ledger took too long to answer." : "Could not reach the Exam Guard ledger service.",
      timedOut ? "timeout" : "offline",
    );
  }
  let body = null;
  try { body = await res.json(); } catch { /* handled below */ }
  if (!res.ok) throw new LedgerError(body?.message || `Ledger service answered ${res.status}.`, "upstream");
  if (!checkShape(body)) throw new LedgerError("The ledger service sent something unexpected.", "shape");
  return { seals: new Map(body.seals.map((s) => [s.tx, s])), tip: body.tip || null };
}
