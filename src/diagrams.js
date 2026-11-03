// Smart-Diagramme: fertige Anordnungen aus Formen und Texten, die nach dem Einfügen
// ganz normal bearbeitbar sind. Jede Vorlage baut ihre Objekte um den Mittelpunkt (0, 0)
// in der Einheit u (ein Sechzehntel der sichtbaren Breite).

const DARK = "#15161a";

function box(x, y, w, h, fill, shape = "rect") {
  return { type: "shape", shape, x: x - w / 2, y: y - h / 2, w, h, fill };
}

function label(x, y, w, h, text, size, color, extra = {}) {
  return { type: "text", x: x - w / 2, y: y - h / 2, w, h, text, size, color, align: "center", ...extra };
}

// Linie von (x1, y1) nach (x2, y2) als gedrehtes, flaches Rechteck.
function line(x1, y1, x2, y2, thickness, fill) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const rot = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return { ...box((x1 + x2) / 2, (y1 + y2) / 2, len, thickness, fill), rot };
}

// Einzeiliger Text mittig in einer Box (h der Box wird nur für die Lesbarkeit der Aufrufe mitgegeben).
function boxText(x, y, w, _h, text, size, color, extra = {}) {
  return label(x, y, w * 0.9, size * 1.4, text, size, color, extra);
}

export const DIAGRAMS = [
  {
    id: "process",
    label: "Prozess",
    build(u, t) {
      const out = [];
      const n = 4;
      const w = 2.6 * u;
      const step = 3.6 * u;
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * step;
        out.push(box(x, 0, w, 1.5 * u, t.accent));
        out.push(boxText(x, 0, w, 1.5 * u, `Schritt ${i + 1}`, 0.4 * u, DARK));
        if (i < n - 1) out.push(box(x + step / 2, 0, 0.6 * u, 0.5 * u, t.text, "arrow"));
      }
      return out;
    },
  },
  {
    id: "cycle",
    label: "Kreislauf",
    build(u, t) {
      const out = [];
      const n = 4;
      const r = 2.6 * u;
      for (let i = 0; i < n; i++) {
        const a = ((-90 + (360 / n) * i) * Math.PI) / 180;
        const am = ((-90 + (360 / n) * (i + 0.5)) * Math.PI) / 180;
        const x = r * Math.cos(a);
        const y = r * Math.sin(a);
        out.push(box(x, y, 2 * u, 2 * u, t.accent, "ellipse"));
        out.push(boxText(x, y, 2 * u, 2 * u, `Phase ${i + 1}`, 0.36 * u, DARK));
        const arrow = box(r * 0.95 * Math.cos(am), r * 0.95 * Math.sin(am), 0.6 * u, 0.45 * u, t.text, "arrow");
        arrow.rot = (am * 180) / Math.PI + 90;
        out.push(arrow);
      }
      return out;
    },
  },
  {
    id: "timeline",
    label: "Zeitstrahl",
    build(u, t) {
      const out = [line(-7 * u, 0, 7 * u, 0, 0.08 * u, t.text)];
      const n = 5;
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 3.2 * u;
        out.push(box(x, 0, 0.5 * u, 0.5 * u, t.accent, "ellipse"));
        const y = i % 2 ? 1.1 * u : -1.1 * u;
        out.push(label(x, y, 2.8 * u, 0.6 * u, `Ereignis ${i + 1}`, 0.36 * u, t.text));
        out.push(label(x, y + (i % 2 ? 0.55 : -0.55) * u, 2.8 * u, 0.5 * u, `Jahr ${2020 + i}`, 0.26 * u, t.accent));
      }
      return out;
    },
  },
  {
    id: "pyramid",
    label: "Pyramide",
    build(u, t) {
      const out = [];
      // Ebenen so zuschneiden, dass ihre Schrägen eine durchgehende Pyramide ergeben.
      const n = 4;
      const h = 1.3 * u;
      const gap = 0.12 * u;
      const base = 9 * u;
      for (let i = 0; i < n; i++) {
        const top = (base * i) / n;
        const bottom = (base * (i + 1)) / n;
        const inset = ((bottom - top) / 2 / bottom) * 100;
        const y = (i - (n - 1) / 2) * (h + gap);
        const layer = box(0, y, bottom, h, shade(t.accent, i * 0.18), "polygon");
        layer.points = [[inset, 0], [100 - inset, 0], [100, 100], [0, 100]];
        out.push(layer);
        out.push(boxText(0, y + (i === 0 ? h * 0.2 : 0), Math.max(bottom * 0.7, 2 * u), h, `Ebene ${i + 1}`, 0.34 * u, DARK));
      }
      return out;
    },
  },
  {
    id: "mindmap",
    label: "Mindmap",
    build(u, t) {
      const out = [];
      const n = 6;
      const r = 4.2 * u;
      const items = [];
      for (let i = 0; i < n; i++) {
        const a = ((-90 + (360 / n) * i) * Math.PI) / 180;
        const x = r * Math.cos(a) * 1.25;
        const y = r * Math.sin(a) * 0.8;
        out.push(line(0, 0, x, y, 0.06 * u, t.text));
        items.push([x, y, i]);
      }
      out.push(box(0, 0, 3 * u, 1.8 * u, t.accent, "ellipse"));
      out.push(boxText(0, 0, 3 * u, 1.8 * u, "Thema", 0.5 * u, DARK));
      for (const [x, y, i] of items) {
        out.push(box(x, y, 2.4 * u, 1 * u, t.background === DARK ? "#2a2c33" : "#e3e5ea"));
        out.push(boxText(x, y, 2.4 * u, 1 * u, `Idee ${i + 1}`, 0.34 * u, t.text));
      }
      return out;
    },
  },
  {
    id: "compare",
    label: "Vergleich",
    build(u, t) {
      const out = [];
      for (const [side, title] of [[-1, "Vorher"], [1, "Nachher"]]) {
        const x = side * 2.8 * u;
        out.push(box(x, -2 * u, 5 * u, 1 * u, side < 0 ? t.text : t.accent));
        out.push(boxText(x, -2 * u, 5 * u, 1 * u, title, 0.45 * u, DARK, { weight: 700 }));
        for (let k = 0; k < 3; k++) {
          out.push(label(x, (-0.6 + k * 1.1) * u, 4.6 * u, 0.6 * u, `Punkt ${k + 1}`, 0.34 * u, t.text));
        }
      }
      out.push(line(0, -1.3 * u, 0, 2.4 * u, 0.05 * u, t.text));
      return out;
    },
  },
  {
    id: "grid",
    label: "Kacheln",
    build(u, t) {
      const out = [];
      for (let k = 0; k < 4; k++) {
        const x = (k % 2 ? 1 : -1) * 2.2 * u;
        const y = (k < 2 ? -1 : 1) * 1.45 * u;
        out.push(box(x, y, 4.2 * u, 2.7 * u, k % 3 === 0 ? t.accent : shade(t.accent, 0.3)));
        out.push(boxText(x, y, 4.2 * u, 2.7 * u, `Bereich ${k + 1}`, 0.42 * u, DARK));
      }
      return out;
    },
  },
  {
    id: "list",
    label: "Aufzählung",
    build(u, t) {
      const out = [];
      for (let k = 0; k < 4; k++) {
        const y = (k - 1.5) * 1.4 * u;
        out.push(box(-4 * u, y, 1 * u, 1 * u, t.accent, "ellipse"));
        out.push(boxText(-4 * u, y, 1 * u, 1 * u, String(k + 1), 0.45 * u, DARK));
        out.push(label(0.6 * u, y, 8 * u, 0.7 * u, `Aussage ${k + 1}`, 0.42 * u, t.text, { align: "left" }));
      }
      return out;
    },
  },
];

// Farbe aufhellen (amount 0..1), für abgestufte Flächen.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * amount));
  return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
}
