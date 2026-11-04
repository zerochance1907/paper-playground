#!/usr/bin/env node
// Create papers/<slug>/paper.json from arXiv metadata.
//   node scripts/new-paper.mjs 1706.03762
//   node scripts/new-paper.mjs https://arxiv.org/abs/2006.11239 ddpm
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/new-paper.mjs <arxiv-id-or-url> [slug]");
  process.exit(2);
}
const id = input.match(/(\d{4}\.\d{4,5})(v\d+)?/)?.[1] ?? input.match(/([a-z-]+(?:\.[A-Z]{2})?\/\d{7})/)?.[1];
if (!id) {
  console.error(`could not find an arXiv id in ${input}`);
  process.exit(2);
}

const xml = await (await fetch(`https://export.arxiv.org/api/query?id_list=${id}`)).text();
const entry = xml.split("<entry>")[1];
if (!entry) {
  console.error(`arXiv has no entry for ${id}`);
  process.exit(1);
}
const tag = (name, s = entry) => s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1].replace(/\s+/g, " ").trim();
const title = tag("title");
const authors = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m) => m[1].trim());
const year = Number(tag("published").slice(0, 4));
const abstract = tag("summary");

const slug = process.argv[3] ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 6).join("-");
const dir = new URL(`../papers/${slug}/`, import.meta.url);
if (existsSync(new URL("paper.json", dir))) {
  console.error(`papers/${slug}/paper.json already exists`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
const paper = {
  arxiv: id,
  title,
  authors,
  year,
  url: `https://arxiv.org/abs/${id}`,
  one_liner: "TODO: what the visitor does, under 110 characters, starting with a verb",
  tags: ["TODO"],
  difficulty: "TODO: beginner | intermediate | advanced",
  interaction: [{ action: "TODO", selector: "#demo" }],
};
writeFileSync(new URL("paper.json", dir), JSON.stringify(paper, null, 2) + "\n");
console.log(`created papers/${slug}/paper.json\n\n${title} (${year})\n${authors.slice(0, 4).join(", ")}${authors.length > 4 ? " et al." : ""}\n\nAbstract:\n${abstract}\n\nNext: read https://arxiv.org/html/${id} (or the PDF), write papers/${slug}/index.html per CLAUDE.md, then run node scripts/check.mjs ${slug}`);
