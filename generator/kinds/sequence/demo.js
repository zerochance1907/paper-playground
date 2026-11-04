// Character n-gram language model with Witten-Bell smoothing. CONFIG: { context }
const $ = (id) => document.getElementById(id);
const CORPUS = `the light on the hill turns once every ten seconds, and the sailors who pass the point at night count the beats to know where they are. the keeper climbs the stairs at dusk with a can of oil and a cloth, and he cleans the glass until the lamp shines clean across the water. when the fog comes in from the sea the light is not enough, so he starts the horn, and the horn calls out over the waves in a long low voice. the boats answer with their own horns, and for a while the whole bay is full of slow calls going back and forth in the grey.
in the morning the fog lifts and the keeper writes in his book. he writes the time the lamp was lit and the time it was put out. he writes the wind and the weather and the ships that went by. he has kept the book for many years, and the pages are full of small notes about the sea. some days the sea is flat and bright and nothing at all happens. some days the wind is so strong that the whole tower hums and the windows shake in their frames.
the keeper has a small garden behind the house where he grows beans and onions and a few tall flowers. the salt in the air is hard on the plants, but the flowers come back every spring. a cat lives with him, and the cat sleeps in the warm room under the lamp while the light turns above. at the end of the day the keeper sits on the steps with a cup of tea and watches the boats come home to the harbour, one light after another along the dark line of the water.
there is a story in the village that the first keeper built the tower with his own hands, stone by stone, after a ship was lost on the rocks below the point. nobody knows if the story is true, but every child in the village knows it, and every child has climbed the stairs at least once to look out from the top. from the top you can see the whole coast, the long beach to the north, the cliffs to the south, and on a clear day the far islands sitting low on the edge of the sea.
the light still turns every night. the ships now carry their own maps and their own machines that tell them where they are, but the sailors still look for the light when they come round the point, and they still count the beats, once every ten seconds, the way the old sailors did.`;
const split = Math.floor(CORPUS.length * 0.88);
const TRAIN = CORPUS.slice(0, split), HELD = CORPUS.slice(split);
const VOCAB = [...new Set(CORPUS)].sort();
const MAXN = 6;

// counts[n]: Map(context -> {total, types, next: Map(char -> count)})
const counts = Array.from({ length: MAXN + 1 }, () => new Map());
for (let i = 0; i < TRAIN.length; i++) {
  for (let n = 0; n <= MAXN && n <= i; n++) {
    const h = TRAIN.slice(i - n, i);
    let e = counts[n].get(h);
    if (!e) counts[n].set(h, (e = { total: 0, next: new Map() }));
    e.total++;
    e.next.set(TRAIN[i], (e.next.get(TRAIN[i]) || 0) + 1);
  }
}

function prob(c, hist, n) {
  if (n === 0) {
    const e = counts[0].get("");
    return ((e.next.get(c) || 0) + 1) / (e.total + VOCAB.length);
  }
  const h = hist.slice(-n);
  const lower = prob(c, hist, n - 1);
  if (h.length < n) return lower;
  const e = counts[n].get(h);
  if (!e) return lower;
  const T = e.next.size;
  return ((e.next.get(c) || 0) + T * lower) / (e.total + T);
}

function dist(hist, n) {
  return VOCAB.map((c) => [c, prob(c, hist, n)]);
}

function bitsPerChar(text, n) {
  let s = 0;
  for (let i = 1; i < text.length; i++) s -= Math.log2(prob(text[i], text.slice(Math.max(0, i - n), i), n));
  return s / (text.length - 1);
}
const bpc = Array.from({ length: MAXN + 1 }, (_, n) => [bitsPerChar(TRAIN.slice(0, 1500), n), bitsPerChar(HELD, n)]);

const show = (c) => (c === " " ? "␣" : c === "\n" ? "↵" : c);
function bars() {
  const n = Number($("ctx").value), hist = $("prompt").value.toLowerCase();
  const d = dist(hist, n).sort((a, b) => b[1] - a[1]).slice(0, 10);
  $("bars").innerHTML = d.map(([c, p]) => `<span>${show(c)}</span><div class="track"><div class="fill" style="width:${(p * 100).toFixed(1)}%"></div></div><span>${(p * 100).toFixed(1)}%</span>`).join("");
  $("ctx-readout").textContent = n === 0 ? "0 chars (letter frequencies only)" : `${n} char${n > 1 ? "s" : ""}`;
}

let rand = U.rng(9);
function generate() {
  const n = Number($("ctx").value), temp = Number($("temp").value);
  let text = $("prompt").value.toLowerCase();
  const start = text.length;
  for (let i = 0; i < 220; i++) {
    const d = dist(text, n).map(([c, p]) => [c, Math.pow(p, 1 / temp)]);
    const Z = d.reduce((a, [, p]) => a + p, 0);
    let u = rand() * Z, pick = d[d.length - 1][0];
    for (const [c, p] of d) { u -= p; if (u <= 0) { pick = c; break; } }
    text += pick;
  }
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  $("out").innerHTML = `${esc(text.slice(0, start))}<b>${esc(text.slice(start))}</b>`;
}

let C;
function chart() {
  C = U.fit($("bpc"), 0.6, 240);
  const ctx = C.ctx, w = C.w, h = C.h, pad = { l: 34, b: 30, t: 18 };
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...bpc.flat());
  const gw = (w - pad.l) / (MAXN + 1), cur = Number($("ctx").value);
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  bpc.forEach(([tr, he], n) => {
    const x = pad.l + n * gw;
    [[tr, U.PALETTE[0]], [he, U.PALETTE[1]]].forEach(([v, col], k) => {
      const bh = ((h - pad.b - pad.t) * v) / max;
      ctx.fillStyle = col;
      ctx.globalAlpha = n === cur ? 1 : 0.55;
      ctx.fillRect(x + gw * 0.12 + k * gw * 0.38, h - pad.b - bh, gw * 0.36, bh);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = n === cur ? Demo.color("--text") : Demo.color("--muted");
    ctx.fillText(String(n), x + gw / 2, h - pad.b + 14);
  });
  ctx.fillStyle = Demo.color("--muted");
  ctx.textAlign = "left";
  ctx.fillText("context length →", pad.l, h - 4);
  ctx.fillStyle = U.PALETTE[0]; ctx.fillText("■ training text", pad.l, 12);
  ctx.fillStyle = U.PALETTE[1]; ctx.fillText("■ held-out text", pad.l + 100, 12);
}

$("ctx").value = CONFIG.context;
$("ctx").addEventListener("input", () => { bars(); chart(); generate(); });
$("prompt").addEventListener("input", bars);
$("temp").addEventListener("input", generate);
$("generate").addEventListener("click", generate);
window.addEventListener("resize", chart);
bars();
generate();
Demo.onTheme(chart);
