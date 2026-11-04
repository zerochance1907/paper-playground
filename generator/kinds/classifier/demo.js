// Two tiny MLPs trained live side by side. CONFIG: { technique, dataset }
const SETUPS = {
  dropout: { a: { label: "Baseline (no dropout)" }, b: { label: "With dropout p = 0.5", dropout: 0.5 }, hidden: [64, 64], act: "relu", n: 60, lr: 0.01 },
  "weight-decay": { a: { label: "Baseline (no weight decay)" }, b: { label: "With weight decay", l2: 0.004 }, hidden: [64, 64], act: "relu", n: 60, lr: 0.01 },
  residual: { a: { label: "Plain deep net (12 layers)" }, b: { label: "Residual net (12 layers)", residual: true }, hidden: Array(12).fill(10), act: "tanh", n: 200, lr: 0.004 },
  depth: { a: { label: "Shallow (1 hidden layer)", hidden: [8] }, b: { label: "Deep (4 hidden layers)", hidden: [8, 8, 8, 8] }, act: "tanh", n: 200, lr: 0.01 },
  relu: { a: { label: "Sigmoid activations" }, b: { label: "ReLU activations", act: "relu" }, hidden: [12, 12, 12, 12, 12, 12], act: "sigmoid", n: 200, lr: 0.01 },
};
const setup = SETUPS[CONFIG.technique] || SETUPS.depth;
const $ = (id) => document.getElementById(id);
$("dataset").value = CONFIG.dataset;
$("name-a").textContent = setup.a.label;
$("name-b").textContent = setup.b.label;

function makeData(kind, n, noise, seed) {
  const r = U.rng(seed), pts = [];
  for (let i = 0; i < n; i++) {
    const y = i % 2;
    let p;
    if (kind === "spiral") {
      const t = 0.15 + (Math.floor(i / 2) / (n / 2)) * 0.85, th = y * Math.PI + t * 3.4 * Math.PI;
      p = [1.4 * t * Math.cos(th) + 0.06 * r.normal(), 1.4 * t * Math.sin(th) + 0.06 * r.normal()];
    } else if (kind === "moons") {
      const th = r() * Math.PI;
      p = y ? [1 - Math.cos(th) - 0.5, 0.35 - Math.sin(th) + 0.1] : [Math.cos(th) - 0.5, Math.sin(th) - 0.25];
      p = [p[0] * 1.1 + 0.1 * r.normal(), p[1] * 1.1 + 0.1 * r.normal()];
    } else if (kind === "circles") {
      const th = r() * 2 * Math.PI, rad = (y ? 0.45 : 1.15) + 0.12 * r.normal();
      p = [rad * Math.cos(th), rad * Math.sin(th)];
    } else {
      p = [r() * 2.8 - 1.4, r() * 2.8 - 1.4];
      pts.push({ x: p, y: p[0] * p[1] > 0 ? 1 : 0 });
      continue;
    }
    pts.push({ x: p, y });
  }
  for (const pt of pts) if (r() < noise) pt.y = 1 - pt.y;
  return pts;
}

const ACT = {
  tanh: [Math.tanh, (a) => 1 - a * a],
  relu: [(z) => (z > 0 ? z : 0), (a) => (a > 0 ? 1 : 0)],
  sigmoid: [(z) => 1 / (1 + Math.exp(-z)), (a) => a * (1 - a)],
};

function makeNet(opts, seed) {
  const r = U.rng(seed), sizes = [2, ...opts.hidden, 1], layers = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const nin = sizes[l], nout = sizes[l + 1], scale = Math.sqrt((opts.act === "relu" ? 2 : 1) / nin);
    const W = new Float64Array(nin * nout).map(() => r.normal() * scale);
    layers.push({ nin, nout, W, b: new Float64Array(nout), gW: new Float64Array(nin * nout), gb: new Float64Array(nout),
      mW: new Float64Array(nin * nout), vW: new Float64Array(nin * nout), mb: new Float64Array(nout), vb: new Float64Array(nout) });
  }
  return { ...opts, layers, t: 0, rand: U.rng(seed + 99), train: [], test: [] };
}

function forward(net, x, train, cache) {
  const [f] = ACT[net.act];
  let h = x;
  const L = net.layers.length;
  for (let l = 0; l < L; l++) {
    const { nin, nout, W, b } = net.layers[l];
    const z = new Float64Array(nout);
    for (let o = 0; o < nout; o++) {
      let s = b[o];
      for (let i = 0; i < nin; i++) s += W[o * nin + i] * h[i];
      z[o] = s;
    }
    if (l === L - 1) {
      const p = 1 / (1 + Math.exp(-z[0]));
      if (cache) cache.push({ h });
      return p;
    }
    const a = z.map(f);
    const res = net.residual && l > 0 && nin === nout;
    let u = res ? a.map((v, i) => v + h[i]) : a;
    let mask = null;
    if (train && net.dropout) {
      mask = new Float64Array(nout).map(() => (net.rand() < net.dropout ? 0 : 1 / (1 - net.dropout)));
      u = u.map((v, i) => v * mask[i]);
    }
    if (cache) cache.push({ h, a, res, mask });
    h = u;
  }
}

function trainStep(net, data) {
  const [, df] = ACT[net.act];
  for (const ly of net.layers) { ly.gW.fill(0); ly.gb.fill(0); }
  let loss = 0;
  for (const { x, y } of data) {
    const cache = [];
    const p = forward(net, x, true, cache);
    loss -= y ? Math.log(p + 1e-9) : Math.log(1 - p + 1e-9);
    let d = new Float64Array([p - y]);
    for (let l = net.layers.length - 1; l >= 0; l--) {
      const ly = net.layers[l], c = cache[l];
      let dz = d;
      if (l < net.layers.length - 1) {
        const du = c.mask ? d.map((v, i) => v * c.mask[i]) : d;
        dz = du.map((v, i) => v * df(c.a[i]));
        d = du;
      }
      const dh = new Float64Array(ly.nin);
      for (let o = 0; o < ly.nout; o++) {
        ly.gb[o] += dz[o];
        for (let i = 0; i < ly.nin; i++) { ly.gW[o * ly.nin + i] += dz[o] * c.h[i]; dh[i] += ly.W[o * ly.nin + i] * dz[o]; }
      }
      if (l < net.layers.length - 1 && c.res) for (let i = 0; i < ly.nin; i++) dh[i] += d[i];
      d = dh;
    }
  }
  net.t++;
  const n = data.length, lr = setup.lr, b1 = 0.9, b2 = 0.999;
  const c1 = 1 - b1 ** net.t, c2 = 1 - b2 ** net.t;
  for (const ly of net.layers) {
    for (const [P, G, M, V, decay] of [[ly.W, ly.gW, ly.mW, ly.vW, net.l2 || 0], [ly.b, ly.gb, ly.mb, ly.vb, 0]]) {
      for (let k = 0; k < P.length; k++) {
        const g = G[k] / n + decay * P[k];
        M[k] = b1 * M[k] + (1 - b1) * g;
        V[k] = b2 * V[k] + (1 - b2) * g * g;
        P[k] -= (lr * (M[k] / c1)) / (Math.sqrt(V[k] / c2) + 1e-8);
      }
    }
  }
  return loss / n;
}

function evalLoss(net, data) {
  let s = 0, correct = 0;
  for (const { x, y } of data) {
    const p = forward(net, x, false);
    s -= y ? Math.log(p + 1e-9) : Math.log(1 - p + 1e-9);
    correct += (p > 0.5) === (y === 1);
  }
  return [s / data.length, correct / data.length];
}

let nets, train, test, step, paused = false, seed = 1;
function reset() {
  const ds = $("dataset").value, noise = Number($("noise").value);
  train = makeData(ds, setup.n, noise, 11 + seed);
  test = makeData(ds, 400, 0, 500 + seed);
  nets = ["a", "b"].map((k) => makeNet({ hidden: setup.hidden, act: setup.act, ...setup[k] }, seed * 31));
  step = 0;
}

let A, B, Lc;
function layout() {
  A = U.fit($("map-a"), 1, 360);
  B = U.fit($("map-b"), 1, 360);
  Lc = U.fit($("loss"), 0.62, 280);
}

const RANGE = 1.75;
function drawMap(net, M) {
  const c0 = U.rgb(U.PALETTE[0]), c1 = U.rgb(U.PALETTE[1]), bg = U.rgb(Demo.color("--surface"));
  const N = 44, cell = M.w / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = [-RANGE + ((i + 0.5) / N) * 2 * RANGE, RANGE - ((j + 0.5) / N) * 2 * RANGE];
    const p = forward(net, x, false);
    M.ctx.fillStyle = U.css(U.mix(bg, p > 0.5 ? c1 : c0, 0.15 + 0.5 * Math.abs(p - 0.5)));
    M.ctx.fillRect(i * cell, j * cell, cell + 1, cell + 1);
  }
  for (const { x, y } of train) {
    M.ctx.fillStyle = y ? U.PALETTE[1] : U.PALETTE[0];
    M.ctx.strokeStyle = Demo.color("--bg");
    M.ctx.beginPath();
    M.ctx.arc(((x[0] + RANGE) / (2 * RANGE)) * M.w, ((RANGE - x[1]) / (2 * RANGE)) * M.h, 3.2, 0, 7);
    M.ctx.fill(); M.ctx.stroke();
  }
}

function draw() {
  drawMap(nets[0], A);
  drawMap(nets[1], B);
  const series = [];
  nets.forEach((n, k) => {
    series.push({ values: n.train, color: U.PALETTE[k ? 2 : 5], width: 2 });
    series.push({ values: n.test, color: U.PALETTE[k ? 2 : 5], width: 2, dash: [5, 4] });
  });
  U.lineChart(Lc.ctx, Lc.w, Lc.h, series, { log: true, xLabel: `step ${step}` });
  const lines = nets.map((n, k) => {
    const [, trAcc] = evalLoss(n, train), [, teAcc] = evalLoss(n, test);
    return `<span style="color:${U.PALETTE[k ? 2 : 5]}">■</span> ${k ? setup.b.label : setup.a.label}<br>&nbsp;&nbsp;train acc ${(trAcc * 100).toFixed(0)}% · test acc ${(teAcc * 100).toFixed(0)}%`;
  });
  $("stats").innerHTML = lines.join("<br>");
}

let frames = 0;
function frame() {
  if (!paused && step < 3000) {
    for (let k = 0; k < 3; k++, step++) {
      nets.forEach((n) => {
        trainStep(n, train);
        if (step % 10 === 0) { n.train.push(evalLoss(n, train)[0]); n.test.push(evalLoss(n, test)[0]); }
      });
    }
    if (frames++ % 2 === 0) draw();
  }
  requestAnimationFrame(frame);
}

$("dataset").addEventListener("change", () => { reset(); draw(); });
$("noise").addEventListener("input", () => { reset(); draw(); });
$("reinit").addEventListener("click", () => { seed++; reset(); draw(); });
$("pause").addEventListener("click", (e) => {
  paused = !paused;
  e.target.textContent = paused ? "▶ Train" : "❚❚ Pause";
});
window.addEventListener("resize", () => { layout(); draw(); });
reset();
Demo.onTheme(() => { layout(); draw(); });
requestAnimationFrame(frame);
