// Local dev server: serves public/ and the same /api routes Vercel runs.
//   cp .env.example .env   (fill in the keys)
//   node server.mjs        → http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(ROOT, "public");
const ENV = join(ROOT, ".env");

if (existsSync(ENV)) for (const line of readFileSync(ENV, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const routes = { "/api/tinyfish": (await import("./api/tinyfish.js")).POST, "/api/claude": (await import("./api/claude.js")).POST };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const PORT = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (routes[url.pathname]) {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await routes[url.pathname](new Request(url, { method: "POST", headers: req.headers, body: Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const path = normalize(join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(PUBLIC + "/")) { res.writeHead(403).end(); return; }
  let file;
  try { file = await readFile(path); } catch { res.writeHead(404).end("Not found"); return; }
  res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" }).end(file);
}).listen(PORT, () => console.log(`Brand Scan on http://localhost:${PORT}`));
