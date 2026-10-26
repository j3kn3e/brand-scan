"""
Brand Guide Generator — powered by TinyFish (Search + Fetch + Agent).

Usage:
    export TINYFISH_API_KEY=...
    python brand_guide.py "Spotify"                 # company name
    python brand_guide.py https://www.revolut.com   # or a URL

Writes out/<slug>.json (brand guide) and out/<slug>.tokens.json (W3C design tokens).

Pipeline
  1. SEARCH  resolve a name to the official site, and find the brand's own
             guideline / press-kit pages (beyond the homepage).
  2. FETCH   (core extraction)
             a. homepage as HTML <head>: stylesheet URLs, font preloads,
                theme-color, mask-icon colour, favicon, og:image
             b. homepage as markdown: headlines + copy for tone of voice
             c. each stylesheet: CSS custom properties, hex/rgb frequency,
                @font-face families, border-radius values
             d. official guideline pages / PDFs: named colours, logo rules
  3. AGENT   fallback only: when Fetch can't render a page (empty_content,
             bot_blocked), a real browser reads the hero copy and computed
             styles. Its values are tagged source="agent" so they can be
             checked against CSS rather than trusted blindly.
"""
from __future__ import annotations

import collections
import json
import os
import re
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

import requests

KEY = os.environ.get("TINYFISH_API_KEY", "")
H = {"X-API-Key": KEY, "Content-Type": "application/json"}
SEARCH = "https://api.search.tinyfish.ai"
FETCH = "https://api.fetch.tinyfish.ai"
AGENT = "https://agent.tinyfish.ai/v1/automation/run"

# ---------------------------------------------------------------- TinyFish calls

def tf_search(query: str, **kw) -> list[dict]:
    r = requests.get(SEARCH, headers=H, params={"query": query, **kw}, timeout=15)
    r.raise_for_status()
    return r.json().get("results", [])


def tf_fetch(urls: list[str], **kw) -> dict:
    body = {"urls": urls[:10], **kw}
    r = requests.post(FETCH, headers=H, json=body, timeout=150)
    r.raise_for_status()
    return r.json()


def tf_agent(url: str, goal: str, schema: dict) -> dict:
    body = {"url": url, "goal": goal, "output_schema": schema,
            "session_id": str(uuid.uuid4()), "browser_profile": "lite"}
    r = requests.post(AGENT, headers=H, json=body, timeout=300)
    r.raise_for_status()
    return r.json().get("result") or {}

# ---------------------------------------------------------------- 1. resolve

def resolve(target: str) -> tuple[str, str]:
    """Return (brand_name, homepage_url) from a URL or a company name."""
    if target.startswith("http"):
        host = urlparse(target).netloc.removeprefix("www.")
        return host.split(".")[0].title(), target
    hits = tf_search(f"{target} official site")
    for h in hits:
        host = urlparse(h["url"]).netloc
        if target.lower().replace(" ", "") in host.replace("-", ""):
            return target, f"https://{host}/"
    return target, hits[0]["url"]


def find_guideline_pages(brand: str, domain: str) -> list[str]:
    """Brand's own guideline / press-kit pages, first-party domains only."""
    hits = tf_search(f"{brand} brand guidelines logo colours press kit")
    root = ".".join(domain.split(".")[-2:])
    return [h["url"] for h in hits if root in urlparse(h["url"]).netloc][:3]

# ---------------------------------------------------------------- 2. parse

HEX = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
RGB = re.compile(r"rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*([\d.]+))?\)")
VAR = re.compile(r"--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6}\b)")
FACE = re.compile(r"@font-face\s*{[^}]*font-family:\s*['\"]?([^;'\"]+)", re.I)
RADIUS = re.compile(r"border-radius:\s*([\d.]+(?:px|rem|%))")


def norm_hex(h: str) -> str:
    h = h.lstrip("#").upper()
    return "#" + ("".join(c * 2 for c in h) if len(h) == 3 else h)


def parse_css(css: str) -> dict:
    """Pull design tokens out of raw CSS text."""
    counts: collections.Counter = collections.Counter()
    for m in HEX.finditer(css):
        counts[norm_hex(m.group())] += 1
    for r, g, b, a in RGB.findall(css):
        if a and float(a) < 0.5:
            continue  # skip scrims and overlays
        counts["#%02X%02X%02X" % (int(r), int(g), int(b))] += 1
    named = {k: norm_hex(v) for k, v in VAR.findall(css)}
    radii = collections.Counter(RADIUS.findall(css))
    return {
        "colour_frequency": counts.most_common(16),
        "named_colours": named,  # CSS custom properties = the site's own token names
        "font_faces": sorted(set(f.strip() for f in FACE.findall(css))),
        "radii": radii.most_common(6),
    }


def parse_head(html: str) -> dict:
    get = lambda pat: (re.search(pat, html) or [None, None])[1]
    return {
        "stylesheets": re.findall(r'href="([^"]+\.css)"[^>]*rel="stylesheet"', html),
        "font_files": re.findall(r'href="([^"]+\.woff2?)"', html),
        "theme_color": get(r'content="(#[0-9A-Fa-f]{3,6})"[^>]*name="theme-color"'),
        "tile_color": get(r'content="(#[0-9A-Fa-f]{3,6})"[^>]*name="msapplication-TileColor"'),
        "mask_icon_color": get(r'color="(#[0-9A-Fa-f]{3,6})"[^>]*rel="mask-icon"'),
    }


def font_families(font_files: list[str]) -> dict[str, list[str]]:
    """'AeonikPro-Black.woff2' -> {'AeonikPro': ['Black']}"""
    fams: dict[str, list[str]] = collections.defaultdict(list)
    for f in font_files:
        stem = Path(urlparse(f).path).stem
        fam, _, weight = stem.partition("-")
        fams[fam].append(weight or "Regular")
    return dict(fams)


def voice(copy: str) -> dict:
    """Cheap, deterministic tone signals from live copy."""
    lines = [l.strip("# ").strip() for l in copy.splitlines() if l.startswith("#")]
    words = re.findall(r"[A-Za-z']+", copy)
    sents = [s for s in re.split(r"[.!?]\s", copy) if len(s.split()) > 2]
    you = sum(w.lower() in {"you", "your", "you're"} for w in words)
    return {
        "headlines": [l for l in lines if l][:8],
        "avg_sentence_words": round(len(words) / max(len(sents), 1), 1),
        "second_person_per_100_words": round(100 * you / max(len(words), 1), 1),
        "exclamations": copy.count("!"),
    }

# ---------------------------------------------------------------- 3. run

def build(target: str) -> dict:
    brand, home = resolve(target)                                   # SEARCH
    domain = urlparse(home).netloc
    guide = {"brand": brand, "url": home, "sources": [home], "colours": [],
             "typography": {}, "logo": {}, "voice": {}, "ui": {}}

    head = tf_fetch([home], format="html", include_selectors=["head"],  # FETCH a
                    page_metadata=True, image_links=True)
    copy = tf_fetch([home], format="markdown")                          # FETCH b
    ok = head.get("results") and copy.get("results") and copy["results"][0]["text"]

    if ok:
        h = parse_head(head["results"][0]["text"])
        meta = head["results"][0].get("page_metadata", {})
        guide["logo"]["favicon"] = meta.get("favicon")
        guide["logo"]["og_image"] = (meta.get("og") or {}).get("image")
        guide["typography"]["families"] = font_families(h["font_files"])
        for k in ("theme_color", "tile_color", "mask_icon_color"):
            if h[k]:
                guide["colours"].append({"hex": norm_hex(h[k]), "role": k, "source": "html-head"})
        css = tf_fetch(h["stylesheets"][:10], format="markdown")        # FETCH c
        merged = "\n".join(r["text"] for r in css.get("results", []))
        parsed = parse_css(merged)
        guide["ui"]["radii"] = parsed["radii"]
        guide["typography"]["font_faces"] = parsed["font_faces"]
        for name, hx in parsed["named_colours"].items():
            guide["colours"].append({"hex": hx, "role": name, "source": "css-var"})
        guide["colour_frequency"] = parsed["colour_frequency"]
        guide["voice"] = voice(copy["results"][0]["text"])
    else:                                                               # AGENT fallback
        guide["agent"] = tf_agent(home,
            "Do not log in. Report the hero headline, 3-5 section headlines, and the "
            "computed font-family, colour (hex) and border-radius of the primary CTA, "
            "body text and page background.",
            {"type": "object", "properties": {
                "headlines": {"type": "array", "items": {"type": "string"}},
                "elements": {"type": "array", "items": {"type": "object"}}}})

    pages = find_guideline_pages(brand, domain)                         # SEARCH
    if pages:
        g = tf_fetch(pages, format="markdown")                         # FETCH d
        for r in g.get("results", []):
            guide["sources"].append(r["url"])
            for m in re.finditer(r"([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s*#\s?([0-9A-F]{6})", r["text"]):
                guide["colours"].append({"name": m[1], "hex": "#" + m[2],
                                         "role": "official", "source": r["url"]})
    return guide


def to_tokens(guide: dict) -> dict:
    """W3C Design Tokens (DTCG) — imports into Figma Tokens Studio, Style Dictionary."""
    colour = {}
    for c in guide["colours"]:
        key = re.sub(r"[^a-z0-9]+", "-", (c.get("name") or c["role"]).lower()).strip("-")
        colour[key] = {"$type": "color", "$value": c["hex"], "$description": c.get("role", "")}
    fonts = {k: {"$type": "fontFamily", "$value": v}
             for k, v in (guide.get("typography", {}).get("tokens") or {}).items()}
    return {guide["brand"].lower(): {"color": colour, "font": fonts}}


if __name__ == "__main__":
    target = sys.argv[1]
    g = build(target)
    out = Path("out"); out.mkdir(exist_ok=True)
    slug = g["brand"].lower().replace(" ", "-")
    (out / f"{slug}.json").write_text(json.dumps(g, indent=2))
    (out / f"{slug}.tokens.json").write_text(json.dumps(to_tokens(g), indent=2))
    print(f"wrote out/{slug}.json and out/{slug}.tokens.json")
