#!/usr/bin/env node
// Check paper demos in a real browser and write their gallery thumbnails.
//   node scripts/check.mjs                 # every paper
//   node scripts/check.mjs attention-is-all-you-need
// Fails on: bad paper.json, missing sections, console errors, unpinned or
// non-allowlisted scripts, oversized pages, horizontal scroll on a phone, or a
// demo that does not visibly respond to the interactions listed in paper.json.
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAPERS = join(ROOT, "papers");
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\//;
const PINNED = /@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+\//;
const TAGS = new Set(["transformers", "nlp", "vision", "generative", "diffusion", "rl", "robotics", "optimization",
  "regularization", "3d", "architectures", "representation-learning", "sequence-models", "theory"]);
const MAX_BYTES = 400 * 1024;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
const server = createServer((req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(ROOT) || !existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

function validatePaper(p) {
  const errs = [];
  for (const k of ["arxiv", "title", "authors", "year", "url", "one_liner", "tags", "difficulty", "interaction"]) {
    if (p[k] === undefined) errs.push(`paper.json: missing "${k}"`);
  }
  if (JSON.stringify(p).includes("TODO")) errs.push("paper.json: still contains TODO");
  if (p.one_liner?.length > 110) errs.push(`paper.json: one_liner is ${p.one_liner.length} chars (max 110)`);
  if (!["beginner", "intermediate", "advanced"].includes(p.difficulty)) errs.push("paper.json: bad difficulty");
  for (const t of p.tags || []) if (!TAGS.has(t)) errs.push(`paper.json: unknown tag "${t}" (add it to scripts/check.mjs if needed)`);
  if (!(p.tags?.length >= 1 && p.tags.length <= 3)) errs.push("paper.json: use 1-3 tags");
  if (!Array.isArray(p.interaction) || !p.interaction.some((s) => s.action !== "wait")) {
    errs.push("paper.json: interaction must include at least one real action");
  }
  return errs;
}

async function interact(page, step) {
  const box = step.selector ? await page.locator(step.selector).first().boundingBox() : null;
  if (step.selector && !box) throw new Error(`interaction: ${step.selector} not found or not visible`);
  const at = ([fx, fy]) => [box.x + box.width * fx, box.y + box.height * fy];
  switch (step.action) {
    case "click": await page.locator(step.selector).first().click(); break;
    case "type": await page.locator(step.selector).first().fill(step.text); break;
    case "select": await page.locator(step.selector).first().selectOption(String(step.value)); break;
    case "range":
      await page.locator(step.selector).first().evaluate((el, v) => {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, String(step.value));
      break;
    case "drag": {
      const [x0, y0] = at(step.from), [x1, y1] = at(step.to);
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12);
      await page.mouse.up();
      break;
    }
    case "wait": await page.waitForTimeout(step.ms ?? 300); break;
    default: throw new Error(`interaction: unknown action "${step.action}"`);
  }
}

async function checkPaper(browser, slug) {
  const dir = join(PAPERS, slug);
  const errs = [];
  if (!existsSync(join(dir, "index.html"))) return [`missing papers/${slug}/index.html`];
  if (!existsSync(join(dir, "paper.json"))) return [`missing papers/${slug}/paper.json`];
  const paper = JSON.parse(readFileSync(join(dir, "paper.json"), "utf8"));
  errs.push(...validatePaper(paper));

  const htmlBytes = readdirSync(dir).filter((f) => f !== "thumb.png")
    .reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  if (htmlBytes > MAX_BYTES) errs.push(`page is ${Math.round(htmlBytes / 1024)} KB (max ${MAX_BYTES / 1024})`);

  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const consoleErrs = [];
  page.on("console", (m) => m.type() === "error" && consoleErrs.push(m.text()));
  page.on("pageerror", (e) => consoleErrs.push(e.message));
  const scripts = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith(base) || u.startsWith("data:")) return;
    if (r.resourceType() === "script" || r.resourceType() === "stylesheet") scripts.push(u);
    else if (!u.startsWith("https://fonts.")) errs.push(`unexpected network request: ${u}`);
  });

  await page.goto(`${base}/papers/${slug}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  for (const s of scripts) {
    if (!CDN.test(s) && !s.startsWith("https://fonts.googleapis.com/")) errs.push(`script from a non-allowlisted host: ${s}`);
    else if (CDN.test(s) && !PINNED.test(s)) errs.push(`script is not pinned to an exact version: ${s}`);
  }
  for (const id of ["demo", "explainer", "simplifications"]) {
    if (!(await page.locator(`#${id}`).count())) errs.push(`missing <section id="${id}">`);
  }
  if (!(await page.locator(".ph-title").count())) errs.push("header did not render (is demo.js linked and paper.json valid?)");
  if ((await page.locator("#simplifications li").count()) < 2) errs.push("#simplifications needs at least 2 bullet points");
  if ((await page.locator("#explainer li").count()) < 2) errs.push("#explainer needs a 'Try this' list with at least 2 items");

  if (await page.locator("#demo").count()) {
    const demo = page.locator("#demo");
    const before = await demo.screenshot();
    try {
      for (const step of paper.interaction || []) await interact(page, step);
      await page.waitForTimeout(400);
      const after = await demo.screenshot();
      if (Buffer.compare(before, after) === 0) errs.push("#demo looks identical after the interactions in paper.json");
    } catch (e) {
      errs.push(e.message);
    }
    await page.setViewportSize({ width: 1200, height: 750 });
    await page.waitForTimeout(300);
    await demo.screenshot({ path: join(dir, "thumb.png") });
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errs.push(`horizontal scroll of ${overflow}px on a 375px phone`);

  for (const theme of ["dark", "light"]) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; window.dispatchEvent(new Event("themechange")); }, theme);
    await page.waitForTimeout(150);
  }
  errs.push(...consoleErrs.map((m) => `console error: ${m}`));
  await page.close();
  return errs;
}

const slugs = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(PAPERS, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => d.name);
const browser = await chromium.launch();
let failed = 0;
for (const slug of slugs) {
  const errs = await checkPaper(browser, slug);
  if (errs.length) {
    failed++;
    console.log(`✖ ${slug}\n${errs.map((e) => `    - ${e}`).join("\n")}`);
  } else {
    console.log(`✔ ${slug}`);
  }
}
await browser.close();
server.close();
console.log(`\n${slugs.length - failed}/${slugs.length} papers passed`);
process.exit(failed ? 1 : 0);
