// Tabular RL in a cliff gridworld. CONFIG: { algorithm }
const $ = (id) => document.getElementById(id);
const W = 10, H = 5, START = [0, 4], GOAL = [9, 4], MAXSTEPS = 150;
const MOVES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const ARROW = ["↑", "→", "↓", "←"];
let cells = new Uint8Array(W * H); // 0 empty, 1 wall, 2 lava
for (let x = 1; x < 9; x++) cells[4 * W + x] = 2;
$("algo").value = CONFIG.algorithm;
let Q, theta, V, returns, episodes, baseline, rand = U.rng(5);
const idx = (x, y) => y * W + x;

function reset() {
  Q = new Float64Array(W * H * 4);
  theta = new Float64Array(W * H * 4);
  V = new Float64Array(W * H);
  returns = [];
  episodes = 0;
  baseline = 0;
}

function stepEnv([x, y], a) {
  const nx = Math.max(0, Math.min(W - 1, x + MOVES[a][0])), ny = Math.max(0, Math.min(H - 1, y + MOVES[a][1]));
  if (cells[idx(nx, ny)] === 1) return { s: [x, y], r: -1, done: false };
  if (cells[idx(nx, ny)] === 2) return { s: [nx, ny], r: -100, done: true };
  if (nx === GOAL[0] && ny === GOAL[1]) return { s: [nx, ny], r: -1, done: true };
  return { s: [nx, ny], r: -1, done: false };
}

const greedy = (s) => { let b = 0; for (let a = 1; a < 4; a++) if (Q[s * 4 + a] > Q[s * 4 + b]) b = a; return b; };
const epsGreedy = (s, eps) => (rand() < eps ? Math.floor(rand() * 4) : greedy(s));
function policy(s) {
  const t = [0, 1, 2, 3].map((a) => theta[s * 4 + a]), m = Math.max(...t);
  const e = t.map((v) => Math.exp(v - m)), Z = e.reduce((a, b) => a + b);
  return e.map((v) => v / Z);
}
function samplePolicy(s) {
  const p = policy(s);
  let u = rand();
  for (let a = 0; a < 4; a++) { u -= p[a]; if (u <= 0) return a; }
  return 3;
}

function episode() {
  const algo = $("algo").value, eps = Number($("eps").value), gamma = Number($("gamma").value), alpha = 0.5;
  let pos = [...START], s = idx(...pos), G = 0;
  const traj = [];
  let a = algo === "reinforce" ? samplePolicy(s) : epsGreedy(s, eps);
  for (let t = 0; t < MAXSTEPS; t++) {
    const { s: np, r, done } = stepEnv(pos, a);
    const s2 = idx(...np);
    G += r;
    traj.push([s, a, r]);
    let a2 = 0;
    if (algo === "q-learning") {
      const target = r + (done ? 0 : gamma * Q[s2 * 4 + greedy(s2)]);
      Q[s * 4 + a] += alpha * (target - Q[s * 4 + a]);
      a2 = epsGreedy(s2, eps);
    } else if (algo === "sarsa") {
      a2 = epsGreedy(s2, eps);
      const target = r + (done ? 0 : gamma * Q[s2 * 4 + a2]);
      Q[s * 4 + a] += alpha * (target - Q[s * 4 + a]);
    } else {
      a2 = samplePolicy(s2);
    }
    pos = np; s = s2; a = a2;
    if (done) break;
  }
  if (algo === "reinforce") {
    let Gt = 0;
    for (let t = traj.length - 1; t >= 0; t--) {
      const [st, at, rt] = traj[t];
      Gt = rt + gamma * Gt;
      V[st] += 0.1 * (Gt - V[st]);
      const p = policy(st), adv = (Gt - baseline) / 50;
      for (let b = 0; b < 4; b++) theta[st * 4 + b] += 0.1 * adv * ((b === at ? 1 : 0) - p[b]);
    }
    baseline += 0.05 * (G - baseline);
  }
  episodes++;
  returns.push(G);
  if (returns.length > 800) returns.shift();
}

function value(s) {
  if ($("algo").value === "reinforce") return V[s];
  return Math.max(Q[s * 4], Q[s * 4 + 1], Q[s * 4 + 2], Q[s * 4 + 3]);
}
function bestAction(s) {
  if ($("algo").value === "reinforce") { const p = policy(s); return p.indexOf(Math.max(...p)); }
  return greedy(s);
}

let G1, R;
function layout() {
  G1 = U.fit($("grid"), H / W, 360);
  R = U.fit($("returns"), 0.62, 260);
}

function draw() {
  const ctx = G1.ctx, cw = G1.w / W, ch = G1.h / H;
  const low = U.rgb(Demo.color("--surface-2")), high = U.rgb(Demo.color("--accent")), text = Demo.color("--text");
  let lo = 0;
  for (let s = 0; s < W * H; s++) if (cells[s] === 0) lo = Math.min(lo, value(s));
  ctx.clearRect(0, 0, G1.w, G1.h);
  ctx.font = `${Math.round(Math.min(cw, ch) * 0.42)}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = idx(x, y), c = cells[s];
    if (c === 1) ctx.fillStyle = Demo.color("--text");
    else if (c === 2) ctx.fillStyle = U.css(U.rgb(Demo.color("--bad")), 0.75);
    else ctx.fillStyle = U.css(U.mix(low, high, lo < 0 ? 1 - value(s) / lo : 0.2));
    ctx.fillRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2);
    ctx.fillStyle = text;
    const isStart = x === START[0] && y === START[1], isGoal = x === GOAL[0] && y === GOAL[1];
    if (isGoal) ctx.fillText("G", (x + 0.5) * cw, (y + 0.5) * ch);
    else if (c === 0 && episodes > 0) ctx.fillText(ARROW[bestAction(s)], (x + 0.5) * cw, (y + 0.5) * ch);
    if (isStart) { ctx.font = `${Math.round(ch * 0.25)}px system-ui`; ctx.fillText("S", (x + 0.18) * cw, (y + 0.2) * ch); ctx.font = `${Math.round(Math.min(cw, ch) * 0.42)}px system-ui, sans-serif`; }
  }
  // Greedy route from the start.
  let pos = [...START];
  ctx.strokeStyle = Demo.color("--accent-2") || text; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo((pos[0] + 0.5) * cw, (pos[1] + 0.5) * ch);
  for (let t = 0; t < 40; t++) {
    const { s: np, done } = stepEnv(pos, bestAction(idx(...pos)));
    pos = np;
    ctx.lineTo((pos[0] + 0.5) * cw, (pos[1] + 0.5) * ch);
    if (done) break;
  }
  ctx.stroke();
  const avg = returns.map((_, i) => { const w = returns.slice(Math.max(0, i - 19), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
  U.lineChart(R.ctx, R.w, R.h, [{ values: avg, color: Demo.color("--accent") }], { xLabel: `episode ${episodes}` });
  $("stats").textContent = `${episodes} episodes · last-20 average return ${avg.length ? avg.at(-1).toFixed(1) : "–"}${$("algo").value === "reinforce" ? " · REINFORCE explores through its own random policy (ε unused)" : ""}`;
}

function frame() {
  if (episodes < 3000) { for (let k = 0; k < 4; k++) episode(); draw(); }
  requestAnimationFrame(frame);
}

$("grid").addEventListener("pointerdown", (e) => {
  const rect = e.target.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * W), y = Math.floor(((e.clientY - rect.top) / rect.height) * H);
  if ((x === START[0] && y === START[1]) || (x === GOAL[0] && y === GOAL[1])) return;
  cells[idx(x, y)] = (cells[idx(x, y)] + 1) % 3;
  if (episodes >= 3000) episodes = 2000;
  draw();
});
$("algo").addEventListener("change", () => { reset(); draw(); });
$("reset").addEventListener("click", () => { reset(); draw(); });
window.addEventListener("resize", () => { layout(); draw(); });
reset();
Demo.onTheme(() => { layout(); draw(); });
requestAnimationFrame(frame);
