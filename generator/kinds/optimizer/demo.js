// Optimizer race on a 2D loss surface. CONFIG: { highlight, surface }
const SURFACES = {
  ravine: { f: (x, y) => 0.05 * x * x + 2 * y * y, g: (x, y) => [0.1 * x, 4 * y], box: [-4, 4, -2, 2], min: [0, 0], start: [-3.6, 1.2] },
  rosenbrock: {
    f: (x, y) => (1 - x) ** 2 + 10 * (y - x * x) ** 2,
    g: (x, y) => [-2 * (1 - x) - 40 * x * (y - x * x), 20 * (y - x * x)],
    box: [-2, 2, -1, 3], min: [1, 1], start: [-1.5, 2.5],
  },
  saddle: { f: (x, y) => x * x - y * y + 0.25 * y ** 4 + 1, g: (x, y) => [2 * x, -2 * y + y ** 3], box: [-2.5, 2.5, -2.5, 2.5], min: [0, Math.SQRT2], start: [-2.2, 0.01] },
  noisy: { f: (x, y) => 0.5 * (x * x + 3 * y * y), g: (x, y) => [x, 3 * y], box: [-3, 3, -3, 3], min: [0, 0], start: [-2.6, 2.4], noise: 1.2 },
};
const OPTS = {
  sgd: { label: "SGD", lr: 1 },
  momentum: { label: "Momentum", lr: 1 },
  nesterov: { label: "Nesterov", lr: 1 },
  adagrad: { label: "AdaGrad", lr: 10 },
  rmsprop: { label: "RMSProp", lr: 1 },
  adam: { label: "Adam", lr: 1 },
};
const order = Object.keys(OPTS).sort((a, b) => (a === CONFIG.highlight ? -1 : b === CONFIG.highlight ? 1 : 0));
const colors = {};
order.forEach((k, i) => (colors[k] = U.PALETTE[i % U.PALETTE.length]));

const $ = (id) => document.getElementById(id);
const sel = $("surface-select"), lrIn = $("lr");
sel.value = CONFIG.surface;
let surf, start, runners, step, rand, heat;
const STEPS = 400;

function makeRunner(kind) {
  return { kind, p: [...start], v: [0, 0], s: [0, 0], m: [0, 0], path: [[...start]], loss: [], dead: false };
}

function update(r, lr) {
  if (r.dead) return;
  const [x, y] = r.p;
  let g = surf.g(x, y);
  if (r.kind === "nesterov") g = surf.g(x + 0.9 * r.v[0], y + 0.9 * r.v[1]);
  if (surf.noise) g = g.map((gi) => gi + surf.noise * rand.normal());
  const a = lr * OPTS[r.kind].lr, t = r.path.length;
  for (let i = 0; i < 2; i++) {
    let d;
    switch (r.kind) {
      case "sgd": d = -a * g[i]; break;
      case "momentum": r.v[i] = 0.9 * r.v[i] - a * g[i]; d = r.v[i]; break;
      case "nesterov": r.v[i] = 0.9 * r.v[i] - a * g[i]; d = r.v[i]; break;
      case "adagrad": r.s[i] += g[i] * g[i]; d = (-a * g[i]) / (Math.sqrt(r.s[i]) + 1e-8); break;
      case "rmsprop": r.s[i] = 0.9 * r.s[i] + 0.1 * g[i] * g[i]; d = (-a * g[i]) / (Math.sqrt(r.s[i]) + 1e-8); break;
      case "adam": {
        r.m[i] = 0.9 * r.m[i] + 0.1 * g[i];
        r.s[i] = 0.999 * r.s[i] + 0.001 * g[i] * g[i];
        const mh = r.m[i] / (1 - 0.9 ** t), vh = r.s[i] / (1 - 0.999 ** t);
        d = (-a * mh) / (Math.sqrt(vh) + 1e-8);
        break;
      }
    }
    r.p[i] += d;
  }
  const L = surf.f(r.p[0], r.p[1]);
  const [x0, x1, y0, y1] = surf.box, mx = 0.25 * (x1 - x0), my = 0.25 * (y1 - y0);
  if (!Number.isFinite(L) || r.p[0] < x0 - mx || r.p[0] > x1 + mx || r.p[1] < y0 - my || r.p[1] > y1 + my) { r.dead = true; return; }
  r.path.push([...r.p]);
  r.loss.push(Math.max(L - surf.f(...surf.min), 1e-6));
}

function reset(newStart) {
  surf = SURFACES[sel.value];
  start = newStart || [...surf.start];
  rand = U.rng(7);
  step = 0;
  heat = null;
  runners = order.map(makeRunner);
  $("lr-readout").textContent = `α = ${(10 ** Number(lrIn.value)).toPrecision(2)}`;
}

let S, L;
function layout() {
  S = U.fit($("surface"), 0.62);
  L = U.fit($("loss"), 0.6, 260);
  heat = null;
}

function toPx([x, y]) {
  const [x0, x1, y0, y1] = surf.box;
  return [((x - x0) / (x1 - x0)) * S.w, (1 - (y - y0) / (y1 - y0)) * S.h];
}

function drawHeat() {
  const N = 120, M = Math.round(N * (S.h / S.w));
  const [x0, x1, y0, y1] = surf.box;
  const vals = [];
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
    const v = Math.log(surf.f(x0 + ((i + 0.5) / N) * (x1 - x0), y1 - ((j + 0.5) / M) * (y1 - y0)) - surf.f(...surf.min) + 0.05);
    vals.push(v); lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const low = U.rgb(Demo.color("--surface-2")), high = U.rgb(Demo.color("--accent-2") || Demo.color("--accent"));
  const off = document.createElement("canvas");
  off.width = N; off.height = M;
  const octx = off.getContext("2d"), img = octx.createImageData(N, M);
  vals.forEach((v, k) => {
    const t = (v - lo) / (hi - lo);
    const band = Math.abs(((t * 12) % 1) - 0.5) < 0.04 ? 0.12 : 0;
    const c = U.mix(low, high, Math.min(1, t * 0.55 + band));
    img.data.set([c[0], c[1], c[2], 255], k * 4);
  });
  octx.putImageData(img, 0, 0);
  heat = off;
}

function draw() {
  if (!heat) drawHeat();
  const ctx = S.ctx;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(heat, 0, 0, S.w, S.h);
  const [mx, my] = toPx(surf.min);
  ctx.strokeStyle = Demo.color("--text"); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(mx - 6, my - 6); ctx.lineTo(mx + 6, my + 6); ctx.moveTo(mx + 6, my - 6); ctx.lineTo(mx - 6, my + 6); ctx.stroke();
  for (const r of [...runners].reverse()) {
    ctx.strokeStyle = colors[r.kind];
    ctx.lineWidth = r.kind === CONFIG.highlight ? 3.5 : 2;
    ctx.beginPath();
    r.path.forEach((p, i) => { const [px, py] = toPx(p); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    const [px, py] = toPx(r.path[r.path.length - 1]);
    ctx.fillStyle = colors[r.kind];
    ctx.beginPath(); ctx.arc(px, py, r.kind === CONFIG.highlight ? 6 : 4, 0, 7); ctx.fill();
  }
  U.lineChart(L.ctx, L.w, L.h, runners.map((r) => ({ values: r.loss, color: colors[r.kind], width: r.kind === CONFIG.highlight ? 3 : 1.5 })), { log: true, xLabel: `step ${step}` });
  $("board").innerHTML = [...runners]
    .sort((a, b) => (a.dead - b.dead) || ((a.loss.at(-1) ?? 1e9) - (b.loss.at(-1) ?? 1e9)))
    .map((r) => `<tr><td style="color:${colors[r.kind]}">●</td><td>${OPTS[r.kind].label}${r.kind === CONFIG.highlight ? " ★" : ""}</td><td>${r.dead ? "diverged" : (r.loss.at(-1) ?? 0).toExponential(1)}</td></tr>`)
    .join("");
}

function legend() {
  $("legend").innerHTML = order.map((k) => `<span><i style="background:${colors[k]}"></i>${k === CONFIG.highlight ? `<b>${OPTS[k].label}</b>` : OPTS[k].label}</span>`).join("");
}

function frame() {
  const lr = 10 ** Number(lrIn.value);
  for (let k = 0; k < 4 && step < STEPS; k++, step++) runners.forEach((r) => update(r, lr));
  draw();
  requestAnimationFrame(frame);
}

$("surface").addEventListener("pointerdown", (e) => {
  const rect = e.target.getBoundingClientRect();
  const [x0, x1, y0, y1] = surf.box;
  reset([x0 + ((e.clientX - rect.left) / rect.width) * (x1 - x0), y1 - ((e.clientY - rect.top) / rect.height) * (y1 - y0)]);
});
sel.addEventListener("change", () => reset());
lrIn.addEventListener("input", () => reset(start));
$("replay").addEventListener("click", () => reset(start));
window.addEventListener("resize", layout);
reset();
legend();
Demo.onTheme(layout);
requestAnimationFrame(frame);
