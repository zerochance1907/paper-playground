// Shared helpers inlined at the top of every generated demo (before the kind's script).
const U = {
  rgb(color) {
    const c = color.trim();
    if (c.startsWith("#")) {
      const h = c.length === 4 ? [...c.slice(1)].map((d) => d + d).join("") : c.slice(1, 7);
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    const m = c.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
  },
  mix(a, b, t) {
    return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
  },
  css(rgb, alpha = 1) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  },
  // Size a canvas to its parent's width with a fixed aspect ratio; returns {ctx, w, h}.
  fit(canvas, aspect, maxH = 420) {
    const w = Math.max(200, Math.floor(canvas.parentElement.clientWidth));
    const h = Math.min(maxH, Math.round(w * aspect));
    return { ctx: Demo.hiDPI(canvas, w, h), w, h };
  },
  // Simple multi-series line chart. series: [{values, color, label, dash}]
  lineChart(ctx, w, h, series, { log = false, yLabel = "", xLabel = "" } = {}) {
    const text = Demo.color("--muted"), grid = Demo.color("--border");
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 44, r: 10, t: 10, b: 24 };
    const tf = (v) => (log ? Math.log10(Math.max(v, 1e-6)) : v);
    let lo = Infinity, hi = -Infinity, n = 1;
    for (const s of series) {
      n = Math.max(n, s.values.length);
      for (const v of s.values) if (Number.isFinite(v)) { lo = Math.min(lo, tf(v)); hi = Math.max(hi, tf(v)); }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
    const X = (i) => pad.l + ((w - pad.l - pad.r) * i) / Math.max(1, n - 1);
    const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (tf(v) - lo) / (hi - lo));
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b); ctx.stroke();
    ctx.fillStyle = text; ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "right";
    for (const f of [0, 0.5, 1]) {
      const v = lo + (hi - lo) * f;
      const label = log ? `1e${v.toFixed(1)}` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
      ctx.fillText(label, pad.l - 4, Y(log ? 10 ** v : v) + 4);
    }
    ctx.textAlign = "left";
    if (yLabel) ctx.fillText(yLabel, pad.l + 4, pad.t + 10);
    if (xLabel) { ctx.textAlign = "right"; ctx.fillText(xLabel, w - pad.r, h - 6); }
    for (const s of series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      let started = false;
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const y = Math.max(pad.t, Math.min(h - pad.b, Y(v)));
        if (!started) { ctx.moveTo(X(i), y); started = true; } else ctx.lineTo(X(i), y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
  },
  // Seeded random numbers so demos are reproducible.
  rng(seed = 1) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.normal = () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
    return next;
  },
  PALETTE: ["#4c8bf5", "#e8a33d", "#3fb37f", "#c35fd1", "#e25b55", "#8a94a3"],
};
