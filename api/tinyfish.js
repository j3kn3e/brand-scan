// POST /api/tinyfish  { tool, args }
// Proxies the four TinyFish calls the page needs. The API key stays on the server,
// and only fixed tools (with fixed Agent goals) are allowed, so the endpoint
// can't be used as a general-purpose scraper or agent.
import { json, fail, limited, readBody } from "../lib/shared.js";
import { overQuota } from "../lib/quota.js";

const SEARCH = "https://api.search.tinyfish.ai/";
const FETCH = "https://api.fetch.tinyfish.ai/";
const AGENT = "https://agent.tinyfish.ai/v1";

const AGENT_GOALS = {
  render: {
    goal: "Do not log in or sign up. Dismiss any cookie banner. Return: the main hero headline text; 3-5 section headlines further down the page; using computed styles (getComputedStyle), the font-family, font-weight, color and background-color of the main headline, the primary call-to-action button, the header and the page body; and the 6-10 most-used non-transparent colours on the visible page (text, backgrounds, buttons, links, header, footer), each as a hex code with where it is used. Convert rgb() to hex. Return only values you actually observed.",
    output_schema: { type: "object", properties: {
      hero_headline: { type: "string" },
      section_headlines: { type: "array", items: { type: "string" } },
      top_colours: { type: "array", items: { type: "object", properties: { hex: { type: "string" }, used_for: { type: "string" } } } },
      styles: { type: "array", items: { type: "object", properties: { element: { type: "string" }, font_family: { type: "string" }, font_weight: { type: "string" }, color: { type: "string" }, background_color: { type: "string" } } } } } },
  },
  brand: {
    goal: "This is a company's official brand guidelines site. Do not log in. Read this page and, if the navigation has them, its Colour/Color section (open at most 1 other page; skip it if the colours are already on this page). Return the official brand colours with their names and hex codes exactly as published, any typefaces named, and any logo usage rules shown. Work quickly and return only what the pages actually state.",
    output_schema: { type: "object", properties: {
      colours: { type: "array", items: { type: "object", properties: { name: { type: "string" }, hex: { type: "string" }, usage: { type: "string" } } } },
      typefaces: { type: "array", items: { type: "string" } },
      logo_rules: { type: "array", items: { type: "string" } } } },
  },
};

const isWebUrl = u => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const str = (v, max) => typeof v === "string" && v.length <= max ? v : undefined;

async function call(url, init) {
  const r = await fetch(url, { ...init, headers: { "X-API-Key": process.env.TINYFISH_API_KEY, "Content-Type": "application/json", ...(init && init.headers) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = body.error || {};
    const retryable = r.status === 429 || r.status >= 500;
    throw { code: retryable ? "server_unavailable" : "tool_error", message: e.message || e.code || "TinyFish returned " + r.status, retryable, retryAfterMs: retryable ? 2000 : undefined, status: r.status };
  }
  return body;
}

const tools = {
  async search(a) {
    const query = str(a.query, 300);
    if (!query) throw { code: "bad_request", message: "query is required" };
    const p = new URLSearchParams({ query });
    if (str(a.purpose, 300)) p.set("purpose", a.purpose);
    return call(SEARCH + "?" + p, { method: "GET" });
  },
  async fetch_content(a) {
    const urls = Array.isArray(a.urls) ? a.urls.filter(isWebUrl).slice(0, 10) : [];
    if (!urls.length) throw { code: "bad_request", message: "urls must be http(s) links" };
    const body = { urls };
    if (["markdown", "html"].includes(a.format)) body.format = a.format;
    for (const k of ["links", "image_links", "iframe_links", "page_metadata"]) if (typeof a[k] === "boolean") body[k] = a[k];
    if (Array.isArray(a.include_selectors)) body.include_selectors = a.include_selectors.filter(s => str(s, 100)).slice(0, 5);
    if (str(a.purpose, 300)) body.purpose = a.purpose;
    return call(FETCH, { method: "POST", body: JSON.stringify(body) });
  },
  async agent_start(a) {
    const preset = AGENT_GOALS[a.kind];
    if (!preset || !isWebUrl(a.url)) throw { code: "bad_request", message: "kind and url are required" };
    return call(AGENT + "/automation/run-async", { method: "POST", body: JSON.stringify({
      url: a.url, goal: preset.goal, output_schema: preset.output_schema,
      browser_profile: a.stealth ? "stealth" : "lite",
      agent_config: { max_steps: 40, max_duration_seconds: 180 } }) });
  },
  async get_run(a) {
    if (!/^[\w-]{8,64}$/.test(a.id || "")) throw { code: "bad_request", message: "bad run id" };
    const r = await call(AGENT + "/runs/" + encodeURIComponent(a.id) + "?screenshots=none&html=none", { method: "GET" });
    return { status: r.status, result: r.result ?? null, error: r.error ?? null };
  },
};

export async function POST(req) {
  if (!process.env.TINYFISH_API_KEY) return fail("not_configured", "This site has no TinyFish API key set.", 503);
  if (limited(req, "tf", Number(process.env.TF_CALLS_PER_10_MIN || 150))) return fail("rate_limited", "Too many scans from your connection. Wait a few minutes.", 429);
  const b = await readBody(req, 20000);
  if (!b || !tools[b.tool]) return fail("bad_request", "Unknown tool");
  if (b.tool === "agent_start") {
    const over = await overQuota(req, "agent", Number(process.env.AGENT_RUNS_PER_VISITOR_PER_DAY || 10), Number(process.env.AGENT_RUNS_PER_DAY || 150));
    if (over) return fail("rate_limited", over, 429);
  }
  try {
    return json(await tools[b.tool](b.args || {}));
  } catch (e) {
    const status = e.code === "bad_request" ? 400 : e.retryable ? 503 : 502;
    return fail(e.code || "tool_error", e.message || "TinyFish call failed", status, { retryable: !!e.retryable, retryAfterMs: e.retryAfterMs });
  }
}
