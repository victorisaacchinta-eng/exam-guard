// Local server that behaves like the Vercel deployment: static files, the
// /api/ledger function and the headers from vercel.json (including the CSP).
//
//   node scripts/dev.mjs            # http://localhost:3000
//   PORT=4000 node scripts/dev.mjs
//
// Behind a corporate proxy, run with NODE_USE_ENV_PROXY=1 so fetch() uses it.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ledger from "../api/ledger.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const config = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".pdf": "application/pdf",
};
// Only these are part of the site; everything else in the repo stays private.
const PUBLIC = [/^\/$/, /^\/index\.html$/, /^\/registry\.json$/, /^\/assets\//, /^\/samples\//];

function applyHeaders(res, pathname) {
  for (const rule of config.headers || []) {
    const re = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, ".*")}$`);
    if (re.test(pathname)) for (const { key, value } of rule.headers) res.setHeader(key, value);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  applyHeaders(res, url.pathname);
  if (url.pathname === "/api/ledger") return ledger(req, res);
  if (!PUBLIC.some((re) => re.test(url.pathname))) {
    res.statusCode = 404;
    return res.end("Not found");
  }
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1);
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) { res.statusCode = 400; return res.end("Bad path"); }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Exam Guard on http://localhost:${port}`));
