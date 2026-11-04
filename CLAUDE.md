# Paper → Playground: how to build a paper demo

This repo turns research papers into small interactive browser demos. Each paper
lives in `papers/<slug>/` and is published to a gallery on GitHub Pages. If you are
an agent asked to add a paper, follow this file exactly. The reference demo to match
in quality and structure is `papers/attention-is-all-you-need/`.

## Workflow for one paper

1. `node scripts/new-paper.mjs <arxiv-id-or-url> [slug]` creates
   `papers/<slug>/paper.json` from arXiv metadata. Fill in the fields marked `TODO`.
2. **Read the paper itself**, not just the abstract: `https://arxiv.org/abs/<id>`,
   and the HTML version at `https://arxiv.org/html/<id>` when it exists (else the PDF).
   Find the ONE core idea a curious engineer should come away understanding.
3. Design a demo where the visitor **does something** (drags, toggles, types, steps
   through training) and **sees the core idea respond**. A demo that only animates
   with no input is not acceptable.
4. Write `papers/<slug>/index.html` following the page contract below.
5. Run `node scripts/check.mjs <slug>` until it passes. It loads the page in a real
   browser, runs the interactions listed in `paper.json`, and fails on console errors,
   missing sections, unpinned scripts, oversized pages or horizontal scroll on phones.
   It also writes `papers/<slug>/thumb.png` for the gallery card.
6. Look at `thumb.png` yourself. If it doesn't show the idea clearly, improve the demo.
7. Commit only `papers/<slug>/`. Never edit other papers, `site/` or `scripts/` in a
   paper PR.

## Page contract (`papers/<slug>/index.html`)

- One self-contained HTML file. It links `../_shared/demo.css` and
  `../_shared/demo.js` (header, theme, layout helpers); everything else is inline.
- Required structure (the checker enforces the ids):
  - `<header data-paper-header></header>`: filled automatically from `paper.json`
    by `demo.js`. Don't write a custom header.
  - `<section id="demo">`: the interactive part, first thing on the page, usable
    without scrolling on a laptop.
  - `<section id="explainer">`: **"The idea in 60 seconds"**, 3–5 short paragraphs
    in plain English, no unexplained jargon, plus a **"Try this"** list of 2–4
    concrete things to do in the demo and what to notice.
  - `<section id="simplifications">`: **"How this demo simplifies the paper"**, an
    honest bullet list. Toy sizes, 2D instead of high-dimensional, hand-set weights
    instead of trained ones, etc. Never present a toy as the paper's real result.
- Real computation, not a fake animation. If the paper is about an algorithm, run a
  small version of it live in JS. Hand-set numbers are fine if the simplifications
  section says so.
- External scripts only from `cdn.jsdelivr.net`, `unpkg.com` or `cdnjs.cloudflare.com`,
  with an exact version (`three@0.170.0`, not `three`). Prefer plain canvas/SVG.
- Whole page under 400 KB (excluding pinned CDN libraries). No images over 100 KB.
- Works on a 375 px wide phone: no horizontal scroll, touch works (use pointer events).
- Colors come from the CSS variables in `demo.css`, so light and dark themes both
  work. Use `--accent`, `--accent-2`, `--good`, `--bad`, `--muted`.
- Controls have visible labels. Canvas content gets an `aria-label` describing it.
- No network calls at run time, no API keys, no tracking.

## `paper.json`

```json
{
  "arxiv": "1706.03762",
  "title": "Attention Is All You Need",
  "authors": ["Ashish Vaswani", "Noam Shazeer", "..."],
  "year": 2017,
  "url": "https://arxiv.org/abs/1706.03762",
  "one_liner": "Drag word vectors and watch scaled dot-product attention re-weight them live.",
  "tags": ["transformers", "nlp"],
  "difficulty": "beginner | intermediate | advanced",
  "interaction": [
    { "action": "drag", "selector": "#plane", "from": [0.7, 0.3], "to": [0.3, 0.6] },
    { "action": "click", "selector": "#scale-toggle" },
    { "action": "wait", "ms": 400 }
  ]
}
```

- `one_liner`: what the visitor *does*, under 110 characters, starting with a verb.
- `tags`: 1–3 lowercase tags. Reuse existing ones where they fit:
  transformers, nlp, vision, generative, diffusion, rl, robotics, optimization,
  regularization, 3d, architectures, representation-learning.
- `interaction`: steps the checker performs to prove the demo responds. Supported
  actions: `click` (selector), `drag` (selector, `from`/`to` as fractions of the
  element's box), `type` (selector, text), `select` (selector, value),
  `range` (selector, value), `wait` (ms). After running them, the screenshot of
  `#demo` must differ from the one before, or the check fails.

## Quality bar

Before you finish, ask: would a curious engineer who has never read the paper leave
with a correct intuition of its core idea in under two minutes? If not, simplify the
demo until they would. Prefer one idea shown clearly over three shown vaguely.
