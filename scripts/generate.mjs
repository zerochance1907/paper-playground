#!/usr/bin/env node
// Generate a paper demo page with no Claude session: pick one of the demo engines in
// generator/kinds/, fill in the paper-specific text, write papers/<slug>/ and run the checker.
//
//   node scripts/generate.mjs 1706.03762                      # auto: local Ollama if running, else templates only
//   node scripts/generate.mjs 1706.03762 --backend template   # no AI at all, instant, $0
//   node scripts/generate.mjs 1706.03762 --backend ollama --model qwen3:8b
//   node scripts/generate.mjs 1706.03762 --backend openai     # any OpenAI-compatible server (OPENAI_BASE_URL, OPENAI_API_KEY)
//   node scripts/generate.mjs 1706.03762 --backend anthropic  # ANTHROPIC_API_KEY; uses a small model and ~2K tokens
//
// Other flags: --kind <name> (force an engine), --slug <slug>, --force (overwrite), --no-check, --dry-run
// The model, if any, only writes ~600 tokens of JSON text. It never writes code: every demo engine is
// hand-written, tested JavaScript, so a weak model can make the text worse but cannot break the page.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const KINDS_DIR = join(ROOT, "generator", "kinds");
const TAGS = ["transformers", "nlp", "vision", "generative", "diffusion", "rl", "robotics", "optimization",
  "regularization", "3d", "architectures", "representation-learning", "sequence-models", "theory"];

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith("--") ? 2 : 1);
  return v && !v.startsWith("--") ? v : true;
};
const opts = {
  backend: flag("backend", "auto"), model: flag("model"), kind: flag("kind"), slug: flag("slug"),
  force: flag("force", false), check: !flag("no-check", false), dry: flag("dry-run", false),
};
const input = argv[0];
if (!input) {
  console.error("usage: node scripts/generate.mjs <arxiv-id-or-url> [--backend auto|template|ollama|openai|anthropic] [--model m] [--kind k] [--slug s] [--force] [--no-check] [--dry-run]");
  process.exit(2);
}

// ---------- engines ----------
const KINDS = Object.fromEntries(readdirSync(KINDS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => [d.name, JSON.parse(readFileSync(join(KINDS_DIR, d.name, "kind.json"), "utf8"))]));
if (opts.kind && !KINDS[opts.kind]) {
  console.error(`unknown --kind "${opts.kind}". Engines: ${Object.keys(KINDS).join(", ")}`);
  process.exit(2);
}

// ---------- arXiv ----------
async function fetchArxiv(raw) {
  const id = raw.match(/(\d{4}\.\d{4,5})(v\d+)?/)?.[1] ?? raw.match(/([a-z-]+(?:\.[A-Z]{2})?\/\d{7})/)?.[1];
  if (!id) throw new Error(`could not find an arXiv id in "${raw}"`);
  const res = await fetch(`https://export.arxiv.org/api/query?id_list=${id}`);
  const entry = (await res.text()).split("<entry>")[1];
  if (!entry) throw new Error(`arXiv has no entry for ${id}`);
  const tag = (name) => entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1].replace(/\s+/g, " ").trim();
  const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return {
    id,
    title: unxml(tag("title")),
    authors: [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m) => unxml(m[1].trim())),
    year: Number(tag("published").slice(0, 4)),
    abstract: unxml(tag("summary")),
    categories: [...entry.matchAll(/<category term="([^"]+)"/g)].map((m) => m[1]),
  };
}

// ---------- heuristic content (no AI) ----------
// Count keyword hits at word starts ("optimiz" matches "optimizer", but "reinforce" needs \b after it to
// avoid matching "reinforcement" when used as a whole word).
const hits = (text, kw) => (text.match(new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")) || []).length;
const word = (text, ...ws) => ws.some((w) => new RegExp(`\\b${w}\\b`).test(text));

function scoreKinds(meta) {
  const title = meta.title.toLowerCase(), abs = meta.abstract.toLowerCase();
  const scores = {};
  for (const [name, k] of Object.entries(KINDS)) {
    // Diminishing returns per keyword so one word repeated in the abstract can't dominate; the title counts 6x.
    scores[name] = k.keywords.reduce((s, kw) => s + 6 * Math.min(hits(title, kw), 1) + Math.min(hits(abs, kw), 3), 0);
  }
  if (meta.categories.includes("cs.CL")) scores.sequence = (scores.sequence || 0) + 4;
  if (meta.categories.includes("cs.RO")) scores.rl = (scores.rl || 0) + 3;
  if (meta.categories.includes("math.OC")) scores.optimizer = (scores.optimizer || 0) + 3;
  return scores;
}

function heuristicConfig(kind, title, abs = "") {
  const k = KINDS[kind], cfg = Object.fromEntries(Object.entries(k.config).map(([key, spec]) => [key, spec.default]));
  // Look at the title first, then the abstract: abstracts often mention other methods in passing.
  const pick = (rules, fallback) => {
    for (const text of [title, abs]) for (const [value, ...words] of rules) if (words.some((w) => hits(text, w))) return value;
    return fallback;
  };
  if (kind === "optimizer") {
    cfg.highlight = pick([["adam", "adam"], ["rmsprop", "rmsprop"], ["adagrad", "adagrad"], ["nesterov", "nesterov"], ["momentum", "momentum"]], "adam");
  }
  if (kind === "classifier") {
    cfg.technique = pick([["dropout", "dropout"], ["weight-decay", "weight decay", "regulariz", "l2 penalty"],
      ["residual", "residual", "skip connection", "shortcut"], ["relu", "relu", "rectifi", "activation function"], ["depth", "deep", "depth"]], "depth");
  }
  if (kind === "rl") {
    const pg = (t) => word(t, "reinforce", "ppo", "trpo") || hits(t, "policy gradient") || hits(t, "policy optimization") || hits(t, "actor-critic");
    cfg.algorithm = pg(title) || pg(abs) ? "reinforce" : word(`${title} ${abs}`, "sarsa", "on-policy") ? "sarsa" : "q-learning";
  }
  return cfg;
}

function heuristicTags(kind, text) {
  const extra = [["transformer", "transformers"], ["attention", "transformers"], ["diffusion", "diffusion"], ["robot", "robotics"],
    ["image", "vision"], ["visual", "vision"], ["3d", "3d"], ["representation", "representation-learning"], ["regulariz", "regularization"],
    ["theorem", "theory"], ["bound", "theory"], ["language", "nlp"], ["generat", "generative"]];
  const tags = [...KINDS[kind].tags];
  for (const [w, t] of extra) if (text.includes(w) && !tags.includes(t)) tags.push(t);
  return tags.slice(0, 3);
}

function sentences(s) {
  return s.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((x) => x.trim()) ?? [s];
}

function heuristicContent(meta) {
  const text = `${meta.title} ${meta.abstract}`.toLowerCase();
  const scores = scoreKinds(meta);
  const kind = opts.kind || Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  const sents = sentences(meta.abstract);
  const idea = [sents.slice(0, 2).join(" "), sents.slice(2, 4).join(" "), sents.slice(4, 6).join(" ")].filter(Boolean);
  return {
    kind, scores,
    config: heuristicConfig(kind, meta.title.toLowerCase(), meta.abstract.toLowerCase()),
    one_liner: KINDS[kind].one_liner,
    tags: heuristicTags(kind, text),
    difficulty: "intermediate",
    idea, ideaFromAbstract: true,
    connection: "",
    simplifications: [],
  };
}

// ---------- model backends (all optional) ----------
function prompt(meta) {
  const engines = Object.entries(KINDS).map(([name, k]) => {
    const cfg = Object.entries(k.config).map(([key, s]) => `${key} ∈ ${JSON.stringify(s.enum)} (${s.help})`).join("; ");
    return `- ${name}: ${k.summary} Good for: ${k.use_for}. config: ${cfg}`;
  }).join("\n");
  return `Paper: ${meta.title} (${meta.year})
Abstract: ${meta.abstract.slice(0, 1800)}

Demo engines (hand-written interactive demos; you only choose one and write the text):
${engines}

Reply with JSON only, exactly these keys:
{"kind": "<engine name that best illustrates the paper's core idea>",
 "config": {<engine config values>},
 "one_liner": "<max 100 chars, starts with a verb, what the visitor does in that demo. The demo is a general illustration: never claim it runs the paper's own method>",
 "tags": [<1-3 of: ${TAGS.join(", ")}>],
 "difficulty": "beginner|intermediate|advanced",
 "idea": ["<3 short paragraphs, max 70 words each, plain English for a curious beginner: the problem, the paper's key idea, why it matters. Use **bold** for key terms. No invented numbers.>"],
 "connection": "<1-2 sentences: how the chosen demo relates to the paper's idea>",
 "simplifications": ["<1-2 sentences each, 2 items: what the real paper does that this demo leaves out>"]}`;
}
const SYSTEM = "You write short, accurate copy for an interactive web demo about a research paper. Only state what the abstract supports. Output a single JSON object and nothing else.";

async function ollama(meta) {
  const host = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "").replace(/^(?!https?:)/, "http://");
  let model = typeof opts.model === "string" ? opts.model : null;
  if (!model) {
    const tags = await (await fetch(`${host}/api/tags`)).json();
    const names = tags.models.map((m) => m.name);
    model = names.find((n) => /qwen|llama|mistral|gemma|phi/i.test(n)) || names[0];
    if (!model) throw new Error("Ollama is running but has no models. Try: ollama pull qwen3:8b");
  }
  const body = { model, stream: false, format: "json", think: false, options: { temperature: 0.3, num_ctx: 4096 },
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt(meta) }] };
  let res = await fetch(`${host}/api/chat`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) { delete body.think; res = await fetch(`${host}/api/chat`, { method: "POST", body: JSON.stringify(body) }); }
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { text: j.message.content, model, tokens: (j.prompt_eval_count || 0) + (j.eval_count || 0) };
}

async function openai(meta) {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = typeof opts.model === "string" ? opts.model : process.env.OPENAI_MODEL || "gpt-4o-mini";
  const headers = { "content-type": "application/json", ...(process.env.OPENAI_API_KEY && { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }) };
  const body = { model, temperature: 0.3, max_tokens: 1200, response_format: { type: "json_object" },
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt(meta) }] };
  let res = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
  if (res.status === 400) { delete body.response_format; res = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) }); }
  if (!res.ok) throw new Error(`${base} ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { text: j.choices[0].message.content, model, tokens: j.usage?.total_tokens };
}

async function anthropic(meta) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("set ANTHROPIC_API_KEY to use --backend anthropic");
  const model = typeof opts.model === "string" ? opts.model : process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1200, system: SYSTEM, messages: [{ role: "user", content: prompt(meta) }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { text: j.content.map((c) => c.text || "").join(""), model, tokens: (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0) };
}

async function ollamaUp() {
  const host = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "").replace(/^(?!https?:)/, "http://");
  try {
    const r = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return r.ok && (await r.json()).models?.length > 0;
  } catch { return false; }
}

// Keep only fields that pass validation; anything missing or bad falls back to the heuristic.
function merge(base, raw) {
  let j;
  try { j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { return null; }
  const out = { ...base, ideaFromAbstract: base.ideaFromAbstract };
  const str = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
  if (!opts.kind && KINDS[j.kind]) { out.kind = j.kind; out.config = heuristicConfig(j.kind, ""); out.one_liner = KINDS[j.kind].one_liner; out.tags = KINDS[j.kind].tags; }
  const spec = KINDS[out.kind].config;
  for (const [key, s] of Object.entries(spec)) if (j.config && s.enum.includes(j.config[key])) out.config[key] = j.config[key];
  const ol = str(j.one_liner, 110); if (ol) out.one_liner = ol;
  if (Array.isArray(j.tags)) { const t = [...new Set(j.tags.filter((x) => TAGS.includes(x)))].slice(0, 3); if (t.length) out.tags = t; }
  if (["beginner", "intermediate", "advanced"].includes(j.difficulty)) out.difficulty = j.difficulty;
  if (Array.isArray(j.idea)) { const p = j.idea.map((x) => str(x, 900)).filter(Boolean).slice(0, 4); if (p.length >= 2) { out.idea = p; out.ideaFromAbstract = false; } }
  const c = str(j.connection, 500); if (c) out.connection = c;
  if (Array.isArray(j.simplifications)) out.simplifications = j.simplifications.map((x) => str(x, 400)).filter(Boolean).slice(0, 3);
  return out;
}

// ---------- page ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");

function render(meta, c, backendLabel) {
  const dir = join(KINDS_DIR, c.kind), k = KINDS[c.kind];
  const short = meta.title.includes(":") && meta.title.indexOf(":") < 60 ? meta.title.split(":")[0] : meta.title.slice(0, 70);
  const util = readFileSync(join(KINDS_DIR, "_util.js"), "utf8");
  const js = readFileSync(join(dir, "demo.js"), "utf8");
  const ideas = c.idea.map((p, i) => `      <p>${i === 0 && c.ideaFromAbstract ? "<em>From the paper's abstract:</em> " : ""}${c.ideaFromAbstract ? esc(p) : md(p)}</p>`).join("\n");
  const simp = [
    `This page was generated automatically by <code>scripts/generate.mjs</code> (demo engine: <code>${esc(c.kind)}</code>; text: ${esc(backendLabel)}). The demo shows a general mechanism related to the paper's idea, not the paper's own method or results.`,
    ...k.simplifications, ...c.simplifications.map(md),
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(short)} · Paper → Playground</title>
  <meta name="description" content="${esc(c.one_liner)}">
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="../_shared/demo.css">
  <script type="module" src="../_shared/demo.js"></script>
</head>
<body>
  <header data-paper-header></header>
  <main>
    <section id="demo" aria-label="Interactive demo">
${readFileSync(join(dir, "demo.html"), "utf8").replace(/^/gm, "      ").trimEnd()}
    </section>

    <section id="explainer">
      <h2>The idea in 60 seconds</h2>
${ideas}
      <p>${k.mechanism}${c.connection ? ` ${md(c.connection)}` : ""}</p>
      <div class="try">
        <h3>Try this</h3>
        <ul>
${k.try.map((t) => `          <li>${t}</li>`).join("\n")}
        </ul>
      </div>
    </section>

    <section id="simplifications">
      <h2>How this demo simplifies the paper</h2>
      <ul>
${simp.map((s) => `        <li>${s}</li>`).join("\n")}
      </ul>
    </section>
  </main>

  <script type="module">
const CONFIG = ${JSON.stringify(c.config)};
${util}
${js}
  </script>
</body>
</html>
`;
}

// ---------- main ----------
const meta = await fetchArxiv(input);
console.log(`📄 ${meta.title} (${meta.year}) · arXiv ${meta.id}`);
let content = heuristicContent(meta);
let backend = opts.backend;
if (backend === "auto") {
  backend = (await ollamaUp()) ? "ollama" : "template";
  if (backend === "template") console.log("ℹ  no local model found (start Ollama for better text, or pass --backend openai|anthropic). Using templates only.");
}
let label = "built-in templates and the paper's abstract, no AI model";
if (backend !== "template") {
  const call = { ollama, openai, anthropic }[backend];
  if (!call) { console.error(`unknown --backend "${backend}"`); process.exit(2); }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const t0 = Date.now();
      const r = await call(meta);
      const merged = merge(content, r.text);
      if (!merged) throw new Error("model did not return valid JSON");
      content = merged;
      label = `${backend} model ${r.model}`;
      console.log(`🤖 ${backend}/${r.model}: ${r.tokens ?? "?"} tokens, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      break;
    } catch (e) {
      console.log(`⚠  ${backend} attempt ${attempt} failed: ${e.message}`);
      if (attempt === 2) console.log("   falling back to templates only.");
    }
  }
}
console.log(`🧩 engine: ${content.kind} ${JSON.stringify(content.config)}   (keyword scores ${JSON.stringify(content.scores)})`);

const slug = typeof opts.slug === "string" ? opts.slug
  : meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 5).join("-");
const paper = {
  arxiv: meta.id, title: meta.title, authors: meta.authors, year: meta.year, url: `https://arxiv.org/abs/${meta.id}`,
  one_liner: content.one_liner, tags: content.tags, difficulty: content.difficulty, interaction: KINDS[content.kind].interaction,
  generated: { by: "scripts/generate.mjs", engine: content.kind, text: label },
};
const html = render(meta, content, label);
if (opts.dry) {
  console.log(JSON.stringify({ slug, paper, config: content.config, idea: content.idea }, null, 2));
  process.exit(0);
}
const out = join(ROOT, "papers", slug);
if (existsSync(join(out, "index.html")) && !opts.force) {
  console.error(`papers/${slug} already exists (use --force to overwrite, or --slug to pick another name)`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "paper.json"), JSON.stringify(paper, null, 2) + "\n");
writeFileSync(join(out, "index.html"), html);
console.log(`✍  wrote papers/${slug}/ (${(html.length / 1024).toFixed(0)} KB)`);
if (opts.check) {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "check.mjs"), slug], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
