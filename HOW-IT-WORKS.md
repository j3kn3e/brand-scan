# Brand Scan: how it works

## Running a scan
Anyone can run a live scan: the site's backend (`api/`) calls TinyFish to read the brand's site, and Claude writes the guide from what TinyFish extracts. The Revolut, Spotify and Duolingo examples replay saved scans and use no credit. The Python CLI and example outputs are in `cli/`.

## Why Fetch leads
In testing, the Agent got the font or hex wrong on 2 of 3 sites. Fetch plus CSS parsing was right every time, so Fetch measures and the Agent only fills gaps (its values are labelled).

## Awkward sites
- **Login walls** (Instagram): reads the brand's own pages instead.
- **Stylesheets added by JavaScript** (Adobe): checks common stylesheet locations first.
- **Bot protection** (Boots): Agent in stealth mode.
- **Brand site needs a browser** (TikTok): Agent reads the official palette.
- **Other companies' styles** (sign-in widgets, cookie banners): filtered out.

## Speed
Calls run in parallel. Colours show within seconds. The guide doesn't wait for slow Agent runs. Repeat scans load instantly for 24 hours.

## Not used
**Browser** and **Research**: Fetch and Search already cover their jobs at lower cost.
