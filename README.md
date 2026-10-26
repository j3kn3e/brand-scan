# Brand Scan

Paste a link or type a brand name. Brand Scan reads the brand's live site with [TinyFish](https://tinyfish.ai) and has Claude write a brand guide: colours, fonts, logo, UI patterns, tone of voice and business model, shown in the brand's own style. You can copy the result as JSON or as W3C design tokens.

Built for the TinyFish "Brand Guide Generator" bounty.

## How a scan works

1. **Search**: resolve a name to the official site; find the brand's own guideline / press-kit pages and recent results.
2. **Fetch**: read the homepage `<head>` (stylesheets, font files, theme colours), the homepage copy, the stylesheets and the brand pages. Colours, fonts and corner radii are parsed out of the real CSS, so hex codes match what the site ships.
3. **Agent** (fallback only): when a page needs a real browser (script-rendered pages, bot protection, brand sites that need JavaScript), a TinyFish agent reads computed styles instead.
4. **Claude**: writes the guide as JSON from the extracted data only, and is told never to invent a hex code.

More detail in [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

## Layout

```
public/          the website (index.html, how-it-works.html)
api/tinyfish.js  POST /api/tinyfish: proxies Search, Fetch and the Agent (keys stay on the server)
api/claude.js    POST /api/claude: writes the guide with Claude
lib/shared.js    JSON helpers + a simple per-IP rate limit
server.mjs       local dev server (same routes, no dependencies)
cli/             the same pipeline as a Python CLI, plus example outputs
```

The API only allows the four calls the page needs, and the Agent goals and the Claude prompt live on the server. So the endpoints can't be used as a general scraper, agent or chatbot on your keys.

## Run it locally

Needs Node 20+.

```bash
cp .env.example .env    # add TINYFISH_API_KEY and ANTHROPIC_API_KEY
node server.mjs         # http://localhost:3000
```

Without keys the site still runs: the three examples replay saved scans, and live scans say they aren't set up.

## Deploy (Vercel, free plan)

1. Import this repo at [vercel.com/new](https://vercel.com/new). No build settings needed: `public/` is served as the site and `api/` becomes serverless functions.
2. Add `TINYFISH_API_KEY` and `ANTHROPIC_API_KEY` under Settings → Environment Variables, then redeploy.

Optional variables: `ANTHROPIC_MODEL` (default `claude-haiku-5-5`; set `claude-sonnet-5-5` for higher quality), `TF_CALLS_PER_10_MIN` (default 150) and `GUIDES_PER_10_MIN` (default 8) per visitor.

**Daily limits:** each visitor gets 5 live scans a day and the whole site 100 (Agent runs: 10 per visitor, 150 site-wide). Change them with `SCANS_PER_VISITOR_PER_DAY`, `SCANS_PER_DAY`, `AGENT_RUNS_PER_VISITOR_PER_DAY` and `AGENT_RUNS_PER_DAY`. For the limits to hold across Vercel's servers, add a free Upstash Redis database (Vercel → Storage → Upstash → Redis, connect it to the project); without it they only apply per server instance.

**Cost control:** the site is public and runs on your keys. The rate limit is per server instance, so also set a monthly spend limit in the Anthropic console and keep an eye on TinyFish credits. Repeat scans of the same brand are cached in the visitor's browser for 24 hours.

## Python CLI

```bash
export TINYFISH_API_KEY=...
python cli/brand_guide.py "Spotify"
python cli/brand_guide.py https://www.revolut.com
```

Writes `out/<brand>.json` and `out/<brand>.tokens.json`. Examples are in [cli/out](cli/out).
