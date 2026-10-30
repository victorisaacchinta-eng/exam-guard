// GET /api/ledger?tx=<hash>[,<hash>...]
// Returns the Exam Guard record (metadata label 674), block and signing
// addresses for each transaction, read live from Cardano preprod.

import { readFileSync } from "node:fs";
import { parseTxList, readSeals } from "./_koios.js";

// Only transactions listed in the registry are read, so the endpoint cannot
// be used as an open proxy to Koios.
function registryTxs() {
  try {
    const reg = JSON.parse(readFileSync(new URL("../registry.json", import.meta.url), "utf8"));
    return new Set((reg.seals || []).map((s) => s && s.tx).filter(Boolean));
  } catch {
    return new Set();
  }
}

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache || "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res, deps = {}) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return send(res, 405, { error: "method_not_allowed" });
  }
  const url = new URL(req.url, "http://localhost");
  const parsed = parseTxList(url.searchParams.get("tx"));
  if (parsed.error) return send(res, 400, { error: "bad_request", message: parsed.error });
  const allowed = deps.allowed || registryTxs();
  if (parsed.list.some((tx) => !allowed.has(tx))) {
    return send(res, 403, { error: "not_in_registry", message: "Only seals listed in registry.json can be read." });
  }

  try {
    const result = await readSeals(parsed.list, { network: "preprod", fetchImpl: deps.fetchImpl || fetch });
    // A confirmed seal never changes; the tip moves, so keep the cache short.
    return send(res, 200, result, "public, s-maxage=30, stale-while-revalidate=300");
  } catch (err) {
    console.error("ledger read failed:", err && err.message);
    return send(res, 502, { error: "ledger_unreachable", message: "Could not read the Cardano ledger right now." });
  }
}
