// Daily scan limits, shared across all server instances.
// Uses Upstash Redis (free on Vercel: Storage → Upstash → Redis, which sets the env vars below).
// Without Redis it falls back to memory, which only limits per server instance.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const DAY = 24 * 60 * 60;
const mem = new Map();

async function incr(key) {
  if (URL_ && TOKEN) {
    try {
      const r = await fetch(URL_ + "/pipeline", {
        method: "POST",
        headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", key], ["EXPIRE", key, String(DAY + 3600)]]),
      });
      const out = await r.json();
      const n = Number(out?.[0]?.result);
      if (Number.isFinite(n)) return n;
    } catch {}
  }
  if (mem.size > 5000) mem.clear();
  const n = (mem.get(key) || 0) + 1;
  mem.set(key, n);
  return n;
}

const ipOf = req => (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();

// Counts one use of `kind` for this visitor and for the whole site today.
// Returns null if allowed, or a message if over a limit.
export async function overQuota(req, kind, perVisitor, perSite) {
  const day = new Date().toISOString().slice(0, 10);
  const [mine, all] = await Promise.all([
    incr(`q:${kind}:${day}:ip:${ipOf(req)}`),
    incr(`q:${kind}:${day}:all`),
  ]);
  if (mine > perVisitor) return `You've used your ${perVisitor} free live scans for today. Come back tomorrow, or try the examples.`;
  if (all > perSite) return "Brand Scan has hit its daily limit of live scans. It resets at midnight (UTC). Try the examples meanwhile.";
  return null;
}
