// Sternenhimmel: statische Sterne als Gradient-Liste (je ein Element), wenige funkelnde Sterne
// und eine seltene Sternschnuppe. Animiert werden nur transform/opacity (Compositor).

// Fester Seed, damit der Himmel bei jedem build() identisch aussieht (mulberry32).
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex) {
  const n = parseInt(String(hex || "#000000").slice(1, 7), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const KEYFRAMES = `
@keyframes mo-sterne-funkeln {
  0%, 100% { opacity: var(--mo-sterne-lo); transform: scale(0.7); }
  50% { opacity: 1; transform: scale(1.15); }
}
@keyframes mo-sterne-schnuppe {
  0%, 92% { opacity: 0; transform: rotate(18deg) translateX(0); }
  93% { opacity: 1; }
  97% { opacity: 0; transform: rotate(18deg) translateX(45vw); }
  100% { opacity: 0; transform: rotate(18deg) translateX(45vw); }
}`;

export default {
  id: "sterne",
  label: "Sternenhimmel",
  build(layer, theme, strength = 0.5) {
    const s = Math.max(0, Math.min(1, Number(strength) || 0));
    const bg = rgb(theme?.background);
    const dark = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 < 0.5;
    // Hell: Textfarbe wie feiner Staub; dunkel: fast weiß, damit es nach Sternen aussieht.
    const [r, g, b] = dark ? [245, 245, 250] : rgb(theme?.text);
    const alpha = (dark ? 0.35 + 0.5 * s : 0.12 + 0.28 * s);
    const col = (a) => `rgba(${r},${g},${b},${(a * alpha).toFixed(3)})`;
    const rand = rng(1337);

    const style = document.createElement("style");
    style.textContent = KEYFRAMES;
    layer.appendChild(style);

    // Statische Sterne: zwei Elemente mit vielen radial-gradients (keine Animation, ein Paint).
    const groups = [
      { n: Math.round(70 + 90 * s), size: [0.5, 1.0], a: [0.35, 0.7] },
      { n: Math.round(14 + 20 * s), size: [1.0, 1.6], a: [0.6, 1.0] },
    ];
    for (const grp of groups) {
      const parts = [];
      for (let i = 0; i < grp.n; i++) {
        const x = (rand() * 100).toFixed(2), y = (rand() * 100).toFixed(2);
        const rad = grp.size[0] + rand() * (grp.size[1] - grp.size[0]);
        const a = grp.a[0] + rand() * (grp.a[1] - grp.a[0]);
        parts.push(`radial-gradient(circle at ${x}% ${y}%, ${col(a)} 0, ${col(a)} ${rad.toFixed(2)}px, transparent ${(rad + 0.8).toFixed(2)}px)`);
      }
      const el = document.createElement("div");
      el.className = "mo-sterne-feld";
      el.style.cssText = `position:absolute;inset:0;background:${parts.join(",")};`;
      layer.appendChild(el);
    }

    // Funkelnde Sterne: wenige eigene Elemente, unterschiedliche Takte und Phasen.
    const twinkles = Math.round(12 + 16 * s); // max. 28
    for (let i = 0; i < twinkles; i++) {
      const d = 2 + rand() * 2.2;
      const dur = 3.5 + rand() * 5; // 3,5–8,5 s
      const el = document.createElement("div");
      el.className = "mo-sterne-funkel";
      el.style.cssText = [
        "position:absolute",
        `left:${(rand() * 100).toFixed(2)}%`,
        `top:${(rand() * 100).toFixed(2)}%`,
        `width:${d.toFixed(2)}px;height:${d.toFixed(2)}px`,
        "border-radius:50%",
        `background:${col(1)}`,
        `box-shadow:0 0 ${(d * 2).toFixed(1)}px ${col(0.6)}`,
        `--mo-sterne-lo:${(0.25 + rand() * 0.25).toFixed(2)}`,
        "opacity:0.6",
        `animation:mo-sterne-funkeln ${dur.toFixed(2)}s ease-in-out ${(-rand() * dur).toFixed(2)}s infinite`,
        "will-change:transform,opacity",
      ].join(";");
      layer.appendChild(el);
    }

    // Sternschnuppe: höchstens eine, alle 34 s kurz (~1,4 s sichtbar), eingefroren unsichtbar.
    if (s > 0.15) {
      const el = document.createElement("div");
      el.className = "mo-sterne-schnuppe";
      el.style.cssText = [
        "position:absolute;left:12%;top:14%",
        "width:120px;height:1px",
        `background:linear-gradient(90deg, transparent, ${col(0.5 + 0.4 * s)})`,
        "opacity:0;transform-origin:0 50%",
        "animation:mo-sterne-schnuppe 34s linear -6s infinite",
        "will-change:transform,opacity",
      ].join(";");
      layer.appendChild(el);
    }
  },
};
