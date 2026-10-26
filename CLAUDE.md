# Brand Scan: notes for Claude

Turns a URL or company name into a brand guide (colours, fonts, logo, UI, voice, business model), shown in the brand's own style. Built for the TinyFish "Brand Guide Generator" bounty. The README covers layout, running and deploying.

## History
- Started as a claude.ai artifact that called TinyFish through the viewer's own connector (`window.claude.use("mcp")`) and Claude through `window.claude.use("sample")`, so only people with the connector could run live scans.
- 21 Oct 2026: made standalone. `public/index.html` now calls `/api/tinyfish` and `/api/claude`, which hold the keys. The Agent goals and the Claude prompt moved server-side so the endpoints can't be used as a general scraper or chatbot. Per-IP rate limit in `lib/shared.js` (per instance only).
- TinyFish REST endpoints (from docs.tinyfish.ai): Search `GET https://api.search.tinyfish.ai/?query=`, Fetch `POST https://api.fetch.tinyfish.ai/` (`urls` 1–10), Agent `POST https://agent.tinyfish.ai/v1/automation/run-async` → `{run_id}`, then `GET /v1/runs/{id}` (status PENDING/RUNNING/COMPLETED/FAILED/CANCELLED, data in `result`). Auth header `X-API-Key`. run-async has no `session_id` field.

## Tested
- Full scan in the browser at 375×812 against stand-in TinyFish/Claude replies (search → fetch head + copy → stylesheet → Claude → rendered guide). API guards checked: unknown tools, non-http URLs and path traversal are rejected.
- NOT tested with real keys yet, and the Agent fallback (async run + polling) has never run against the real API. Do that first once keys are in `.env`.

## Status / next steps
1. Git repo initialised on `main`, all files staged, **no commit yet**. Not pushed: this Mac had no GitHub login. `gh` is installed (Homebrew); run `gh auth login --web -h github.com -p https`, set the commit email to the account's GitHub no-reply address (not a personal email), commit, then `gh repo create brand-scan --public --source . --push`.
2. Deploy on Vercel (free): import the repo, add `TINYFISH_API_KEY` + `ANTHROPIC_API_KEY`. Not Netlify (the owner's Netlify credits are reserved for another site).
3. Run a real scan or two; fix whatever the real API responses break.
4. Record a 1–2 min screen capture of a fresh live scan for the bounty.
5. No licence file yet: ask the owner before adding one (e.g. MIT).

## Working notes
- Never commit `.env` or any key. Keep keys server-side only.
- The site is public and spends the owner's credits: keep the rate limits, and remind them to set a spend limit in the Anthropic console.
- Owner prefers plain language, short explanations, and being asked before anything is published.
