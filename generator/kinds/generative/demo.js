// 2D diffusion sampler with the exact score of the noised data. CONFIG: { shape, stochastic }
const $ = (id) => document.getElementById(id);
const NP = 350, SIG_MAX = 3, SIG_MIN = 0.03;
let data = [], frames = [], sigmas = [], stochastic = CONFIG.stochastic !== false, anim = null;
$("shape").value = CONFIG.shape;
$("stoch").setAttribute("aria-pressed", String(stochastic));

function shapePoints(kind) {
  const r = U.rng(3), pts = [];
  for (let i = 0; i < 300; i++) {
    let p;
    if (kind === "ring") { const th = r() * 2 * Math.PI; p = [1.6 * Math.cos(th), 1.6 * Math.sin(th)]; }
    else if (kind === "gaussians") { const k = i % 8, th = (k / 8) * 2 * Math.PI; p = [1.7 * Math.cos(th), 1.7 * Math.sin(th)]; p = p.map((v) => v + 0.12 * r.normal()); }
    else if (kind === "spiral") { const t = r(), th = t * 3 * Math.PI; p = [1.9 * t * Math.cos(th), 1.9 * t * Math.sin(th)]; }
    else { const y = i % 2, th = r() * Math.PI; p = y ? [1 - Math.cos(th) - 0.5, 0.25 - Math.sin(th)] : [Math.cos(th) - 0.5, Math.sin(th) - 0.25]; p = p.map((v) => v * 1.5); }
    pts.push(p.map((v) => v + 0.03 * r.normal()));
  }
  return pts;
}

function score(x, y, s) {
  // Gradient of log of a mixture of Gaussians centred on the data points (variance s^2).
  let mx = -Infinity;
  const inv = 1 / (2 * s * s), e = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const dx = data[i][0] - x, dy = data[i][1] - y;
    e[i] = -(dx * dx + dy * dy) * inv;
    if (e[i] > mx) mx = e[i];
  }
  let W = 0, sx = 0, sy = 0;
  for (let i = 0; i < data.length; i++) { const w = Math.exp(e[i] - mx); W += w; sx += w * data[i][0]; sy += w * data[i][1]; }
  return [(sx / W - x) / (s * s), (sy / W - y) / (s * s)];
}

function sample() {
  const T = Number($("steps").value), r = U.rng(Date.now() % 100000);
  sigmas = Array.from({ length: T + 1 }, (_, k) => SIG_MAX * (SIG_MIN / SIG_MAX) ** (k / T)); // k=0 noisiest
  let pts = Array.from({ length: NP }, () => [SIG_MAX * r.normal(), SIG_MAX * r.normal()]);
  frames = [pts.map((p) => [...p])];
  for (let k = 0; k < T; k++) {
    const s = sigmas[k], s2 = sigmas[k + 1], dv = s * s - s2 * s2;
    pts = pts.map(([x, y]) => {
      const [gx, gy] = score(x, y, s);
      if (stochastic) {
        const sd = Math.sqrt(dv);
        return [x + dv * gx + sd * r.normal(), y + dv * gy + sd * r.normal()];
      }
      return [x + 0.5 * dv * gx, y + 0.5 * dv * gy];
    });
    frames.push(pts.map((p) => [...p]));
  }
  const t = $("t");
  t.max = T;
  t.value = 0;
  cancelAnimationFrame(anim);
  const t0 = performance.now();
  const tick = (now) => {
    t.value = Math.min(T, Math.round(((now - t0) / 1400) * T));
    draw();
    if (Number(t.value) < T) anim = requestAnimationFrame(tick);
  };
  anim = requestAnimationFrame(tick);
}

let Bd, Fw;
const VIEW = 3.2;
function layout() {
  Bd = U.fit($("board"), 0.8, 440);
  Fw = U.fit($("forward"), 0.8, 300);
}
const px = (M, [x, y]) => [M.w / 2 + (x / VIEW) * (M.w / 2), M.h / 2 - (y / VIEW) * (M.w / 2)];

function dots(M, pts, color, rad) {
  M.ctx.fillStyle = color;
  for (const p of pts) {
    const [a, b] = px(M, p);
    if (a < -5 || b < -5 || a > M.w + 5 || b > M.h + 5) continue;
    M.ctx.beginPath(); M.ctx.arc(a, b, rad, 0, 7); M.ctx.fill();
  }
}

function draw() {
  const T = sigmas.length - 1, k = Math.min(Number($("t").value), T);
  const target = U.css(U.rgb(Demo.color("--muted")), 0.35);
  Bd.ctx.clearRect(0, 0, Bd.w, Bd.h);
  dots(Bd, data, target, 2);
  if (frames[k]) dots(Bd, frames[k], Demo.color("--accent"), 2.6);
  const s = sigmas[k] ?? SIG_MAX;
  $("sigma").textContent = `step ${k}/${T} · noise σ = ${s.toFixed(3)}`;
  $("steps-readout").textContent = `${$("steps").value} steps`;
  Fw.ctx.clearRect(0, 0, Fw.w, Fw.h);
  const r = U.rng(42);
  dots(Fw, data.map(([x, y]) => [x + s * r.normal(), y + s * r.normal()]), Demo.color("--accent-2") || Demo.color("--accent"), 2.2);
  $("note").textContent = `Forward process at σ = ${s.toFixed(3)}. The reverse sampler on the left has to undo exactly this much noise.`;
}

let drawing = false;
$("board").addEventListener("pointerdown", (e) => { drawing = true; data = []; addPoint(e); });
$("board").addEventListener("pointermove", (e) => drawing && addPoint(e));
window.addEventListener("pointerup", () => { if (drawing) { drawing = false; if (data.length < 20) data = shapePoints($("shape").value); sample(); } });
function addPoint(e) {
  const rect = $("board").getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2 * VIEW;
  const y = -((e.clientY - rect.top) / rect.height - 0.5) * 2 * VIEW * (rect.height / rect.width);
  for (let i = 0; i < 4; i++) data.push([x + 0.06 * (Math.random() - 0.5), y + 0.06 * (Math.random() - 0.5)]);
  draw();
}
$("shape").addEventListener("change", () => { data = shapePoints($("shape").value); sample(); });
$("sample").addEventListener("click", sample);
$("steps").addEventListener("change", sample);
$("steps").addEventListener("input", () => ($("steps-readout").textContent = `${$("steps").value} steps`));
$("t").addEventListener("input", () => { cancelAnimationFrame(anim); draw(); });
$("stoch").addEventListener("click", () => {
  stochastic = !stochastic;
  $("stoch").setAttribute("aria-pressed", String(stochastic));
  $("stoch").textContent = stochastic ? "Stochastic" : "Deterministic (ODE)";
  sample();
});
window.addEventListener("resize", () => { layout(); draw(); });
data = shapePoints($("shape").value);
$("stoch").textContent = stochastic ? "Stochastic" : "Deterministic (ODE)";
Demo.onTheme(() => { layout(); if (sigmas.length) draw(); });
sample();
