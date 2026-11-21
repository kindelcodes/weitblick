// Lichtpunkte: weiche, unscharfe Kreise (Bokeh), die langsam aufsteigen und ein-/ausblenden.
// Nur transform/opacity werden animiert, damit alles auf dem Compositor läuft (schwache PCs).

// Kleiner, gesäter Zufallsgenerator (mulberry32): gleiche Anordnung bei jedem Aufbau,
// damit Vorschaubilder und Screenshots stabil bleiben.
function zufall(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export default {
  id: "lichter",
  label: "Lichtpunkte",
  build(layer, theme, strength = 0.5) {
    const s = Math.min(1, Math.max(0, strength));
    const r = zufall(7);
    const farben = [theme.accent, theme.accent2, theme.text].map(rgb);

    // var() in @keyframes: jede Lichtkugel bekommt eigene Weglänge/Deckkraft, aber nur ein Keyframe-Satz.
    const style = document.createElement("style");
    style.textContent = `
@keyframes mo-lichter-steigen {
  0%   { opacity: 0; transform: translate3d(0, 0, 0) scale(0.85); }
  25%  { opacity: var(--mo-o); }
  75%  { opacity: var(--mo-o); }
  100% { opacity: 0; transform: translate3d(var(--mo-dx), var(--mo-dy), 0) scale(1.1); }
}
.mo-lichter-punkt {
  position: absolute;
  height: 0;
  border-radius: 50%;
  opacity: 0;
  will-change: transform;
  animation: mo-lichter-steigen linear infinite;
}`;
    layer.appendChild(style);

    const anzahl = Math.round(12 + 18 * s); // 12 bei 0, 30 bei 1
    for (let i = 0; i < anzahl; i++) {
      const groesse = 2.5 + r() * r() * 11; // in % der Breite; viele kleine, wenige große
      const farbe = farben[i % 3 === 2 && r() < 0.6 ? 0 : i % 3];
      const dauer = 15 + r() * 25;
      // Aufstieg in eigenen Größen (transform-% bezieht sich aufs Element): kleine Punkte wandern weiter.
      const steig = (18 + r() * 22) / groesse;
      const el = document.createElement("div");
      el.className = "mo-lichter-punkt";
      el.style.cssText = `
left:${(r() * 104 - 7).toFixed(2)}%;
top:${(r() * 100 + 5).toFixed(2)}%;
width:${groesse.toFixed(2)}%;
padding-bottom:${groesse.toFixed(2)}%;
background:radial-gradient(circle closest-side, rgba(${farbe},0.9) 0%, rgba(${farbe},0.55) 55%, rgba(${farbe},0) 100%);
--mo-o:${((0.1 + 0.38 * s) * (0.5 + r() * 0.5)).toFixed(3)};
--mo-dx:${((r() - 0.5) * steig * 40).toFixed(1)}%;
--mo-dy:${(-steig * 100).toFixed(1)}%;
animation-duration:${dauer.toFixed(1)}s;
animation-delay:${(-r() * dauer).toFixed(1)}s;`;
      layer.appendChild(el);
    }
  },
};
