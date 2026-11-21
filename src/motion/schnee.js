// Hintergrund-Effekt "Schnee": weiche Flocken fallen langsam und pendeln leicht.
// Nur transform/opacity werden animiert, damit alles auf dem Compositor läuft (schwache PCs).

// Kleiner fester Zufallsgenerator (mulberry32), damit das Bild bei jedem Neuaufbau gleich aussieht.
function zufall(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function istDunkel(hex) {
  const n = parseInt(String(hex || "#000000").slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

// Feste Pendel-Amplituden statt CSS-Variablen in @keyframes – die sind in älterem WebKitGTK unzuverlässig.
const CSS = `
@keyframes mo-schnee-fall { from { transform: translate3d(0,0,0); } to { transform: translate3d(0,calc(100vh + 40px),0); } }
@keyframes mo-schnee-pendel-0 { from { transform: translateX(-8px); } to { transform: translateX(8px); } }
@keyframes mo-schnee-pendel-1 { from { transform: translateX(-16px); } to { transform: translateX(16px); } }
@keyframes mo-schnee-pendel-2 { from { transform: translateX(-26px); } to { transform: translateX(26px); } }
`;

export default {
  id: "schnee",
  label: "Schnee",
  // layer: leeres, bildschirmfestes <div> hinter der Leinwand (position:absolute; inset:0; overflow:hidden; pointer-events:none).
  // theme: { background, text, accent, accent2 } als #rrggbb. strength: 0..1 (0 = kaum sichtbar, 1 = deutlich; Standard 0.5).
  build(layer, theme, strength) {
    const s = Math.min(1, Math.max(0, strength ?? 0.5));
    const dunkel = istDunkel(theme?.background);
    // Auf hellen Themes ein kühles Blaugrau, Weiß wäre dort unsichtbar.
    const rgb = dunkel ? "255,255,255" : "120,140,165";
    const grundAlpha = (dunkel ? 0.3 : 0.35) + 0.5 * s;
    const anzahl = Math.round(8 + 12 * s); // höchstens 20 Flocken = 40 animierte Elemente
    const rnd = zufall(20251121);

    const style = document.createElement("style");
    style.textContent = CSS;
    layer.appendChild(style);

    for (let i = 0; i < anzahl; i++) {
      const tiefe = rnd(); // 0 = fern (klein, blass, langsam), 1 = nah
      const groesse = 6 + tiefe * tiefe * 14;
      const alpha = grundAlpha * (0.45 + 0.55 * tiefe);
      const fallDauer = 30 - tiefe * 18; // 12–30 s
      // Gleichmäßig über die Breite verteilt, mit etwas Streuung, damit keine Lücken entstehen.
      const x = ((i + 0.2 + rnd() * 0.6) / anzahl) * 100;

      const fall = document.createElement("div");
      fall.className = "mo-schnee-fall";
      fall.style.cssText =
        `position:absolute;left:${x.toFixed(2)}%;top:-${Math.ceil(groesse) + 4}px;` +
        `width:${groesse.toFixed(1)}px;height:${groesse.toFixed(1)}px;` +
        `animation:mo-schnee-fall ${fallDauer.toFixed(1)}s linear ${(-rnd() * fallDauer).toFixed(1)}s infinite;`;

      const flocke = document.createElement("div");
      flocke.className = "mo-schnee-flocke";
      const pendelDauer = 4 + rnd() * 5;
      flocke.style.cssText =
        `width:100%;height:100%;border-radius:50%;` +
        `background:radial-gradient(circle, rgba(${rgb},${alpha.toFixed(3)}) 30%, rgba(${rgb},${(alpha * 0.5).toFixed(3)}) 50%, rgba(${rgb},0) 70%);` +
        `animation:mo-schnee-pendel-${Math.floor(tiefe * 2.999)} ${pendelDauer.toFixed(1)}s ease-in-out ${(-rnd() * pendelDauer * 2).toFixed(1)}s infinite alternate;`;

      fall.appendChild(flocke);
      layer.appendChild(fall);
    }
  },
};
