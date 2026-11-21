// Farbverlauf: drei weiche Farbflecken ziehen langsam umeinander (Aurora-Effekt).
// Nur transform wird animiert, die Farben stecken statisch in radial-gradients.

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// Mischung aus Hintergrund und Textfarbe: auf dunklem Thema heller, auf hellem dunkler.
function mix(a, b, t) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return "#" + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
}

const KEYFRAMES = `
@keyframes mo-verlauf-a { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(18%,12%) scale(1.12); } 66% { transform: translate(6%,-10%) scale(0.94); } }
@keyframes mo-verlauf-b { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(-16%,-8%) scale(0.92); } 66% { transform: translate(-6%,14%) scale(1.1); } }
@keyframes mo-verlauf-c { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-14%,-16%) scale(1.15); } }
`;

export default {
  id: "verlauf",
  label: "Farbverlauf",
  build(layer, theme, strength) {
    const s = Math.max(0, Math.min(1, strength ?? 0.5));
    // Maximale Deckkraft 0.15..0.6, damit Text auf beiden Themen lesbar bleibt.
    const alpha = 0.15 + 0.45 * s;
    const style = document.createElement("style");
    style.textContent = KEYFRAMES;
    layer.appendChild(style);

    // Startpositionen sind so gewählt, dass auch das eingefrorene Bild ausgewogen wirkt.
    const blobs = [
      { color: theme.accent, left: -15, top: -25, w: 75, h: 110, anim: "a", dur: 32, delay: 0 },
      { color: theme.accent2, left: 45, top: 15, w: 70, h: 105, anim: "b", dur: 38, delay: -12 },
      { color: mix(theme.background, theme.text, 0.35), left: 15, top: 35, w: 60, h: 90, anim: "c", dur: 26, delay: -7 },
    ];
    for (const b of blobs) {
      const el = document.createElement("div");
      el.className = "mo-verlauf-blob";
      el.style.cssText =
        `position:absolute;left:${b.left}%;top:${b.top}%;width:${b.w}%;height:${b.h}%;` +
        `background:radial-gradient(closest-side, ${rgba(b.color, alpha)} 0%, ${rgba(b.color, alpha * 0.7)} 35%, ${rgba(b.color, 0)} 100%);` +
        `will-change:transform;animation:mo-verlauf-${b.anim} ${b.dur}s ease-in-out ${b.delay}s infinite;`;
      layer.appendChild(el);
    }
  },
};
