// POST /api/claude  { data }
// Writes the brand guide from the extracted data. The prompt lives here, not in the
// page, so this endpoint only ever writes brand guides.
import { json, fail, limited, readBody } from "../lib/shared.js";
import { overQuota } from "../lib/quota.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

const prompt = data => `You are a senior product designer writing a brand guide for a PM/UX audience. Use ONLY the extracted data below (scraped live with TinyFish). Never invent hex codes: every hex you output must appear in head, css_custom_property_colours, colour_frequency, guideline_pages, agent_render or official_brand_site. Colours in official_brand_site are the brand's published palette: list them first, with source "guidelines". If login_wall is true, the homepage is just a sign-in screen: lean on guideline_pages for colours, logo and voice. Use proper UX terms. Keep every string short.

Reply with only one JSON object of this shape:
{"name":"Brand","style":"2-3 word style label like 'Fintech-minimal' or 'Playful-core'","tags":["3 short descriptors"],
"theme":{"bg":"#hex page background","fg":"#hex main text","sub":"#hex secondary text","surface":"#hex card surface (can be a near shade of bg)","line":"#hex hairline","accent":"#hex primary brand/CTA colour","onAccent":"#hex text on accent","display":"the Google Fonts family closest to their display/headline typeface (exact Google Fonts name)","body":"the Google Fonts family closest to their body typeface","headingCase":"none|lowercase|uppercase","radius":16,"btnRadius":999},
"title":{"font":"Google Fonts family that best mimics their LOGO WORDMARK or main headline lettering","weight":800,"case":"none|lowercase|uppercase (match how the wordmark/headlines are set)","tracking":-0.03,"italic":false,"color":"#hex the wordmark/headline colour as it appears on theme.bg"},
"colours":[{"name":"short name (use the site's CSS variable name if meaningful)","hex":"#RRGGBB","role":"how it's used","source":"site|guidelines"}],
"type":{"sample":"a real headline from the copy","rows":[["Display","Family · weights"],["Body","Family · weights"]],"note":"one sentence: where the families were found"},
"logo":{"kind":"wordmark / lettermark / combination mark / emblem etc., as far as the data shows","rules":["2-4 rules, only if found in guidelines; otherwise observations"]},
"ui":[["Pattern","value"]],
"voice":{"traits":["3 adjectives"],"lines":["2-4 verbatim lines from homepage_copy"],"pattern":"one or two sentences on how copy is written"},
"biz":{"model":"one line","period":"period of the figures, or 'Latest'","metrics":[["Metric","value","change or context"]],"streams":["revenue streams"],"next":"one or two sentences","pm":"one or two sentences: the product insight a PM should take away","src":[["Short source name","url from business_search"]]},
"cta":"the primary CTA text from the copy"}
Design brief: style the whole section the way the brand's own designer would. Pick light or dark from the site's real page background; surface/line must be subtle shades of bg; accent must be the real brand colour; title.color must read clearly on theme.bg. Use headline_and_logo_css and font_files for the fonts, weight, case and letter-spacing (tracking in em, between -0.08 and 0.2).
Rules: 6-10 colours, most important first; prefer named CSS variables over raw frequency; skip pure black/white unless they are clearly brand colours. ui: 3-5 rows from radii, layout and copy evidence. metrics: up to 4, ONLY figures stated in business_search snippets; if none, return an empty array. If a section has no evidence, say so briefly rather than guessing.

DATA:
${JSON.stringify(data)}`;

function firstJson(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return fail("not_configured", "This site has no Anthropic API key set.", 503);
  if (limited(req, "claude", Number(process.env.GUIDES_PER_10_MIN || 8))) return fail("rate_limited", "Too many requests right now. Wait a few minutes, then scan again.", 429);
  const b = await readBody(req, 120000);
  if (!b || typeof b.data !== "object" || !b.data) return fail("bad_request", "data is required");
  const over = await overQuota(req, "guide", Number(process.env.SCANS_PER_VISITOR_PER_DAY || 5), Number(process.env.SCANS_PER_DAY || 100));
  if (over) return fail("rate_limited", over, 429);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt(b.data) }] }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 429 || r.status === 529) return fail("rate_limited", "Claude is busy. Wait a minute, then scan again.", 429);
  if (!r.ok) return fail("claude_error", (body.error && body.error.message) || "Claude returned " + r.status, 502);
  if (body.stop_reason === "refusal") return fail("refused", "Claude declined to analyse this site.", 422);
  const text = (body.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  if (!text.trim()) return fail("empty_completion", "Claude returned nothing.", 502);
  const guide = firstJson(text);
  if (!guide) return fail("invalid_json", "Claude's reply wasn't valid JSON.", 502);
  return json({ guide });
}
