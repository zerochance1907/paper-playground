// Shared helpers for every paper demo: fills the header from paper.json,
// handles the light/dark toggle, and exposes small utilities on window.Demo.

const THEME_KEY = "paper-playground-theme";

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  window.dispatchEvent(new Event("themechange"));
}

try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { /* storage unavailable */ }

const Demo = {
  /** Read a CSS color variable, e.g. Demo.color("--accent"). */
  color: (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
  /** Run cb now and again whenever the theme changes (to redraw canvases). */
  onTheme(cb) {
    cb();
    window.addEventListener("themechange", cb);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", cb);
  },
  /** Size a canvas for crisp drawing on high-DPI screens; returns its 2D context. */
  hiDPI(canvas, cssWidth, cssHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  },
};
window.Demo = Demo;

async function fillHeader() {
  const el = document.querySelector("[data-paper-header]");
  if (!el) return;
  let p;
  try {
    p = await (await fetch("paper.json")).json();
  } catch {
    return;
  }
  const authors = p.authors.length > 3 ? `${p.authors.slice(0, 3).join(", ")} et al.` : p.authors.join(", ");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  el.innerHTML = `
    <div class="ph-top">
      <a href="../../index.html">← All papers</a>
      <button class="theme-btn" type="button" aria-label="Toggle light or dark theme">◐ Theme</button>
    </div>
    <h1 class="ph-title">${esc(p.title)}</h1>
    <div class="ph-meta">
      <span>${esc(authors)} · ${esc(p.year)}</span>
      <a href="${esc(p.url)}" target="_blank" rel="noopener">Read the paper ↗</a>
      ${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
    </div>`;
  el.querySelector(".theme-btn").addEventListener("click", () => {
    const dark = Demo.color("--bg") === "#111110";
    const next = dark ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    applyTheme(next);
  });
  if (!document.title) document.title = p.title;
  const cite = document.createElement("footer");
  cite.className = "cite";
  cite.innerHTML = `Paper: ${esc(p.authors.join(", "))} (${esc(p.year)}). <em>${esc(p.title)}</em>. <a href="${esc(p.url)}">${esc(p.url)}</a><br>
    Interactive demo from <a href="../../index.html">Paper → Playground</a>. The demo is a simplified illustration, not the paper's experiments.`;
  document.querySelector("main")?.appendChild(cite);
}

fillHeader();
