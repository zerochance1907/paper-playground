#!/usr/bin/env node
// Build the static site into dist/: the gallery page plus every paper folder.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

const papers = readdirSync(new URL("papers/", root), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => {
    const dir = new URL(`papers/${d.name}/`, root);
    if (!existsSync(new URL("index.html", dir)) || !existsSync(new URL("paper.json", dir))) return null;
    const p = JSON.parse(readFileSync(new URL("paper.json", dir)));
    return {
      slug: d.name, title: p.title, year: p.year, authors: p.authors, tags: p.tags,
      one_liner: p.one_liner, difficulty: p.difficulty, url: p.url,
      thumb: existsSync(new URL("thumb.png", dir)),
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

cpSync(new URL("papers/", root), new URL("papers/", dist), { recursive: true });
const html = readFileSync(new URL("site/index.html", root), "utf8")
  .replace("/*PAPERS*/[]", JSON.stringify(papers).replace(/</g, "\\u003c"));
writeFileSync(new URL("index.html", dist), html);
writeFileSync(new URL(".nojekyll", dist), "");
console.log(`built dist/ with ${papers.length} papers`);
