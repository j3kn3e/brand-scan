// Small helpers shared by the API routes.

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const fail = (code, message, status = 400, extra = {}) => json({ error: { code, message, ...extra } }, status);

// Best-effort per-IP limit. Serverless instances don't share memory, so this only
// slows down a single abuser; set spending caps in the TinyFish and Anthropic consoles too.
const hits = new Map();
export function limited(req, bucket, max, windowMs = 10 * 60 * 1000) {
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  const key = bucket + ":" + ip, now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

export async function readBody(req, maxBytes) {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}
