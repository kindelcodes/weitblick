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

// Teil eines Unterschritts im Pfad: alle Teile mit gleichem Namen bekommen zusammen einen Schritt.
function st(o, key) {
  return { ...o, step: key };
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
        out.push(st(box(x, 0, w, 1.5 * u, t.accent), `Schritt ${i + 1}`));
        out.push(st(boxText(x, 0, w, 1.5 * u, `Schritt ${i + 1}`, 0.4 * u, DARK), `Schritt ${i + 1}`));
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
        out.push(st(box(x, y, 2 * u, 2 * u, t.accent, "ellipse"), `Phase ${i + 1}`));
        out.push(st(boxText(x, y, 2 * u, 2 * u, `Phase ${i + 1}`, 0.36 * u, DARK), `Phase ${i + 1}`));
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
        const k = `Ereignis ${i + 1}`;
        out.push(st(box(x, 0, 0.5 * u, 0.5 * u, t.accent, "ellipse"), k));
        const y = i % 2 ? 1.1 * u : -1.1 * u;
        out.push(st(label(x, y, 2.8 * u, 0.6 * u, k, 0.36 * u, t.text), k));
        out.push(st(label(x, y + (i % 2 ? 0.55 : -0.55) * u, 2.8 * u, 0.5 * u, `Jahr ${2020 + i}`, 0.26 * u, t.accent), k));
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
        out.push(st(box(x, y, 2.4 * u, 1 * u, t.background === DARK ? "#2a2c33" : "#e3e5ea"), `Idee ${i + 1}`));
        out.push(st(boxText(x, y, 2.4 * u, 1 * u, `Idee ${i + 1}`, 0.34 * u, t.text), `Idee ${i + 1}`));
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

// Weitere Inhaltsblöcke (Tabelle, Ziel, Venn, Balken, Karte, Organigramm, Team).
DIAGRAMS.push(
  {
    id: "table",
    label: "Tabelle",
    build(u, t) {
      const out = [];
      const cols = 4;
      const rows = 4;
      const cw = 3 * u;
      const rh = 0.9 * u;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = (c - (cols - 1) / 2) * (cw + 0.06 * u);
          const y = (r - (rows - 1) / 2) * (rh + 0.06 * u);
          const fill = r === 0 ? t.accent : shade(t.background === "#ffffff" ? "#cccccc" : t.background, r % 2 ? 0.12 : 0.2);
          out.push(box(x, y, cw, rh, fill));
          const text = r === 0 ? `Spalte ${c + 1}` : c === 0 ? `Zeile ${r}` : "–";
          out.push(boxText(x, y, cw, rh, text, 0.32 * u, r === 0 ? DARK : t.text, r === 0 ? { weight: 700 } : {}));
        }
      }
      return out;
    },
  },
  {
    id: "target",
    label: "Ziel",
    build(u, t) {
      const out = [];
      const rings = 4;
      for (let i = 0; i < rings; i++) {
        const d = (5 - i * 1.15) * u;
        out.push(box(-3 * u, 0, d, d, i % 2 ? shade(t.accent, 0.55) : t.accent, "ellipse"));
      }
      out.push(boxText(-3 * u, 0, 1.4 * u, 1.4 * u, "Ziel", 0.36 * u, DARK, { weight: 700 }));
      for (let i = 0; i < 3; i++) {
        const y = (i - 1) * 1.5 * u;
        out.push(line(-0.4 * u, y, 1.4 * u, y, 0.05 * u, t.text));
        out.push(label(4.2 * u, y, 5 * u, 0.6 * u, `Meilenstein ${i + 1}`, 0.4 * u, t.text, { align: "left" }));
      }
      return out;
    },
  },
  {
    id: "venn",
    label: "Venn",
    build(u, t) {
      const out = [];
      const colors = [t.accent, t.accent2 ?? shade(t.accent, 0.4), shade(t.accent, 0.6)];
      const centers = [[-1.4, -0.9], [1.4, -0.9], [0, 1.5]];
      centers.forEach(([cx, cy], i) => {
        out.push({ ...box(cx * u, cy * u, 4.6 * u, 4.6 * u, colors[i], "ellipse"), opacity: 0.6 });
      });
      const labels = [[-2.4, -1.6, "Bereich A"], [2.4, -1.6, "Bereich B"], [0, 2.9, "Bereich C"], [0, -0.1, "Schnitt"]];
      for (const [x, y, text] of labels) out.push(label(x * u, y * u, 2.6 * u, 0.6 * u, text, 0.36 * u, t.text, { weight: 700 }));
      return out;
    },
  },
  {
    id: "bars",
    label: "Balkendiagramm",
    build(u, t) {
      const out = [line(-5 * u, 2.5 * u, 5 * u, 2.5 * u, 0.06 * u, t.text)];
      const values = [40, 65, 55, 85, 70];
      values.forEach((v, i) => {
        const x = (i - 2) * 2 * u;
        const h = (v / 100) * 5 * u;
        out.push(box(x, 2.5 * u - h / 2, 1.3 * u, h, i === 3 ? t.accent : shade(t.accent, 0.35)));
        out.push(label(x, 2.5 * u - h - 0.4 * u, 1.6 * u, 0.5 * u, `${v} %`, 0.32 * u, t.text, { weight: 700 }));
        out.push(label(x, 3 * u, 1.8 * u, 0.5 * u, `Wert ${i + 1}`, 0.28 * u, t.text));
      });
      return out;
    },
  },
  {
    id: "map",
    label: "Weltkarte",
    build(u, t) {
      const out = [box(0, 0, 12 * u, 4.8 * u, t.accent2 ?? shade(t.accent, 0.5), "world")];
      // Lage in der Karte (0..1): Europa, Nordamerika, Südostasien
      const places = [[0.53, 0.2, "Europa"], [0.22, 0.27, "Nordamerika"], [0.79, 0.5, "Asien"]];
      for (const [px, py, name] of places) {
        const x = (px - 0.5) * 12 * u;
        const y = (py - 0.5) * 4.8 * u;
        out.push(box(x, y - 0.35 * u, 0.5 * u, 0.7 * u, t.accent, "pin"));
        out.push(label(x, y - 1 * u, 2.6 * u, 0.5 * u, name, 0.3 * u, t.text, { weight: 700 }));
      }
      return out;
    },
  },
  {
    id: "tree",
    label: "Organigramm",
    build(u, t) {
      const out = [];
      const kids = [-4, 0, 4];
      out.push(line(0, -1.6 * u, 0, -0.6 * u, 0.06 * u, t.text));
      out.push(line(-4 * u, -0.6 * u, 4 * u, -0.6 * u, 0.06 * u, t.text));
      for (const k of kids) out.push(line(k * u, -0.6 * u, k * u, 0.4 * u, 0.06 * u, t.text));
      out.push(box(0, -2.2 * u, 3.4 * u, 1.2 * u, t.accent));
      out.push(boxText(0, -2.2 * u, 3.4 * u, 1.2 * u, "Leitung", 0.4 * u, DARK, { weight: 700 }));
      kids.forEach((k, i) => {
        out.push(box(k * u, 1 * u, 3 * u, 1.1 * u, shade(t.accent, 0.4)));
        out.push(boxText(k * u, 1 * u, 3 * u, 1.1 * u, `Bereich ${i + 1}`, 0.36 * u, DARK));
      });
      return out;
    },
  },
  {
    id: "team",
    label: "Team",
    build(u, t) {
      const out = [];
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 3 * u;
        const k = `Name ${i + 1}`;
        out.push(st(box(x, -0.8 * u, 2 * u, 2 * u, t.accent, "ellipse"), k));
        out.push(st({ type: "icon", name: "user", x: x - 0.6 * u, y: -1.4 * u, w: 1.2 * u, h: 1.2 * u, color: DARK }, k));
        out.push(st(label(x, 0.75 * u, 2.8 * u, 0.6 * u, k, 0.38 * u, t.text, { weight: 700 }), k));
        out.push(st(label(x, 1.35 * u, 2.8 * u, 0.5 * u, "Rolle", 0.3 * u, t.accent), k));
      }
      return out;
    },
  },
);

// Planet mit Monden: eine große Kugel, eine Umlaufbahn und Monde darauf. group: true heißt,
// dass alle Teile nach dem Einfügen eine Gruppe bilden und als ein Block gelten.
DIAGRAMS.push({
  id: "planet",
  label: "Planet mit Monden",
  group: true,
  build(u, t) {
    const out = [];
    const rx = 5.6 * u;
    const ry = 2.4 * u;
    const moonColor = t.accent2 ?? shade(t.accent, 0.4);
    out.push({ ...box(0, 0, rx * 2, ry * 2, t.text, "ring"), opacity: 0.45 });
    out.push(box(0, 0, 3.6 * u, 3.6 * u, t.accent, "ellipse"));
    // Ein heller Fleck oben links lässt die Kugel räumlich wirken.
    out.push({ ...box(-0.7 * u, -0.75 * u, 1.3 * u, 1.1 * u, "#ffffff", "ellipse"), opacity: 0.22 });
    out.push(boxText(0, 0, 3.6 * u, 3.6 * u, "Thema", 0.55 * u, DARK, { weight: 700, role: "title" }));
    const moons = [[-150, "Mond 1"], [-60, "Mond 2"], [20, "Mond 3"], [120, "Mond 4"]];
    for (const [deg, name] of moons) {
      const a = (deg * Math.PI) / 180;
      const x = rx * Math.cos(a);
      const y = ry * Math.sin(a);
      // step: Mond und Beschriftung bilden einen eigenen Unterschritt im Pfad.
      out.push({ ...box(x, y, 1.2 * u, 1.2 * u, moonColor, "ellipse"), step: name });
      const below = y >= 0;
      out.push(label(x, y + (below ? 1.05 : -1.05) * u, 2.6 * u, 0.6 * u, name, 0.36 * u, t.text, { weight: 700, step: name }));
    }
    return out;
  },
});

// Farbe aufhellen (amount 0..1), für abgestufte Flächen.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * amount));
  return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
}
