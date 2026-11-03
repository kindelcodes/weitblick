import { WORLD_PATH } from "./vendor/world.js";

// Formen der Seitenleiste. Rechteck, abgerundetes Rechteck und Kreis zeichnet CSS, alle anderen
// ein SVG (Polygon oder Pfad) in einem 100×100-Feld, das auf die Objektgröße gestreckt wird.

function regular(n, rotate = 0) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = ((-90 + rotate + (360 / n) * k) * Math.PI) / 180;
    pts.push([50 + 50 * Math.cos(a), 50 + 50 * Math.sin(a)]);
  }
  return pts;
}

function star(points, inner = 0.45) {
  const pts = [];
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 ? 50 * inner : 50;
    const a = ((-90 + (180 / points) * k) * Math.PI) / 180;
    pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  return pts;
}

// Zahnrad als Pfad: Zähne außen, Loch in der Mitte (wird über fill-rule evenodd ausgespart).
function gear(teeth = 8) {
  const pts = [];
  for (let k = 0; k < teeth * 4; k++) {
    const r = k % 4 < 2 ? 50 : 38;
    const a = ((360 / (teeth * 4)) * (k + 0.5) * Math.PI) / 180;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(" L")} Z M50,35 A15,15 0 1,0 50,65 A15,15 0 1,0 50,35 Z`;
}

const POLYGONS = {
  triangle: regular(3),
  "right-triangle": [[0, 0], [0, 100], [100, 100]],
  parallelogram: [[25, 0], [100, 0], [75, 100], [0, 100]],
  diamond: regular(4),
  pentagon: regular(5),
  hexagon: regular(6, 30),
  heptagon: regular(7),
  octagon: regular(8, 22.5),
  trapezoid: [[20, 0], [80, 0], [100, 100], [0, 100]],
  star: star(5),
  sparkle: star(4, 0.25),
  burst: star(12, 0.75),
  plus: [[35, 0], [65, 0], [65, 35], [100, 35], [100, 65], [65, 65], [65, 100], [35, 100], [35, 65], [0, 65], [0, 35], [35, 35]],
  arrow: [[0, 30], [62, 30], [62, 5], [100, 50], [62, 95], [62, 70], [0, 70]],
  "arrow-left": [[100, 30], [38, 30], [38, 5], [0, 50], [38, 95], [38, 70], [100, 70]],
  "arrow-both": [[0, 50], [25, 5], [25, 30], [75, 30], [75, 5], [100, 50], [75, 95], [75, 70], [25, 70], [25, 95]],
  "arrow-flag": [[0, 0], [75, 0], [100, 50], [75, 100], [0, 100]],
  chevron: [[0, 0], [70, 0], [100, 50], [70, 100], [0, 100], [30, 50]],
  "line-arrow": [[0, 38], [84, 38], [84, 0], [100, 50], [84, 100], [84, 62], [0, 62]],
  folder: [[0, 12], [38, 12], [46, 0], [100, 0], [100, 100], [0, 100]],
  manual: [[0, 15], [100, 0], [100, 100], [0, 100]],
};

const PATHS = {
  "half-circle": "M0,100 A50,100 0 0,1 100,100 Z",
  cylinder: "M0,12 A50,12 0 0,1 100,12 V88 A50,12 0 0,1 0,88 Z",
  document: "M0,0 H100 V86 C75,72 55,100 30,92 C18,88 8,86 0,90 Z",
  bubble: "M8,0 H92 A8,8 0 0,1 100,8 V64 A8,8 0 0,1 92,72 H40 L18,98 L22,72 H8 A8,8 0 0,1 0,64 V8 A8,8 0 0,1 8,0 Z",
  "bubble-round": "M50,0 C80,0 100,17 100,40 C100,63 80,80 50,80 C42,80 35,79 28,76 L8,96 L14,68 C5,61 0,51 0,40 C0,17 20,0 50,0 Z",
  cloud: "M25,85 C8,85 0,72 3,60 C5,50 13,44 22,45 C20,28 33,16 48,20 C55,8 75,6 84,20 C96,22 102,36 97,48 C104,56 101,72 90,78 C86,84 80,86 74,85 Z",
  heart: "M50,92 C20,70 0,52 0,30 C0,13 13,2 28,2 C38,2 46,8 50,16 C54,8 62,2 72,2 C87,2 100,13 100,30 C100,52 80,70 50,92 Z",
  drop: "M50,0 C50,0 88,44 88,64 C88,85 71,100 50,100 C29,100 12,85 12,64 C12,44 50,0 50,0 Z",
  moon: "M62,2 C38,8 22,28 22,52 C22,76 40,96 64,99 C58,100 52,100 48,100 C21,98 0,76 0,50 C0,22 23,0 50,0 C54,0 58,1 62,2 Z",
  gear: gear(),
  world: WORLD_PATH,
  // Schmaler Ring (Umlaufbahn): äußerer Kreis minus innerer Kreis.
  ring: "M50,0 A50,50 0 1,0 50,100 A50,50 0 1,0 50,0 Z M50,2.5 A47.5,47.5 0 1,1 50,97.5 A47.5,47.5 0 1,1 50,2.5 Z",
  pin: "M50,100 C50,100 12,58 12,36 C12,15 29,0 50,0 C71,0 88,15 88,36 C88,58 50,100 50,100 Z M50,22 A14,14 0 1,0 50,50 A14,14 0 1,0 50,22 Z",
  puzzle: "M0,20 H32 C30,8 36,0 45,0 C54,0 60,8 58,20 H80 V42 C92,40 100,46 100,55 C100,64 92,70 80,68 V100 H0 V72 C10,74 18,68 18,59 C18,50 10,44 0,46 Z",
};

// Gruppen und Beschriftungen in der Seitenleiste; size ist das Seitenverhältnis (w, h) beim Einfügen.
export const SHAPE_GROUPS = [
  {
    title: "Einfach",
    shapes: [
      { id: "rect", label: "Rechteck" },
      { id: "rounded", label: "Abgerundet" },
      { id: "ellipse", label: "Kreis" },
      { id: "half-circle", label: "Halbkreis", size: [1, 0.5] },
      { id: "triangle", label: "Dreieck" },
      { id: "right-triangle", label: "Rechtwinklig" },
      { id: "parallelogram", label: "Parallelogramm", size: [1, 0.6] },
      { id: "trapezoid", label: "Trapez", size: [1, 0.6] },
      { id: "diamond", label: "Raute" },
      { id: "pentagon", label: "Fünfeck" },
      { id: "hexagon", label: "Sechseck" },
      { id: "heptagon", label: "Siebeneck" },
      { id: "octagon", label: "Achteck" },
    ],
  },
  {
    title: "Diagramm",
    shapes: [
      { id: "cylinder", label: "Datenbank", size: [0.8, 1] },
      { id: "document", label: "Dokument", size: [1, 0.75] },
      { id: "folder", label: "Ordner", size: [1, 0.75] },
      { id: "manual", label: "Eingabe", size: [1, 0.6] },
      { id: "puzzle", label: "Puzzleteil" },
      { id: "gear", label: "Zahnrad" },
    ],
  },
  {
    title: "Pfeile",
    shapes: [
      { id: "arrow", label: "Rechts", size: [1, 0.5] },
      { id: "arrow-left", label: "Links", size: [1, 0.5] },
      { id: "arrow-both", label: "Beidseitig", size: [1, 0.5] },
      { id: "arrow-flag", label: "Fahne", size: [1, 0.5] },
      { id: "chevron", label: "Winkel", size: [0.7, 0.5] },
    ],
  },
  {
    title: "Akzente",
    shapes: [
      { id: "ring", label: "Ring" },
      { id: "star", label: "Stern" },
      { id: "sparkle", label: "Funkeln" },
      { id: "burst", label: "Zacken" },
      { id: "heart", label: "Herz" },
      { id: "plus", label: "Plus" },
      { id: "drop", label: "Tropfen", size: [0.8, 1] },
      { id: "moon", label: "Mond", size: [0.8, 1] },
      { id: "cloud", label: "Wolke", size: [1, 0.75] },
      { id: "bubble", label: "Sprechblase", size: [1, 0.8] },
      { id: "bubble-round", label: "Gedanke", size: [1, 0.85] },
    ],
  },
  {
    title: "Karte",
    shapes: [
      { id: "world", label: "Weltkarte", size: [1, 0.4] },
      { id: "pin", label: "Markierung", size: [0.6, 0.8] },
    ],
  },
  {
    title: "Linien",
    shapes: [
      { id: "line", label: "Linie", size: [1, 0.03] },
      { id: "line-arrow", label: "Pfeillinie", size: [1, 0.07] },
    ],
  },
];

export const SHAPES = SHAPE_GROUPS.flatMap((g) => g.shapes);

// points: eigene Eckpunkte im 100×100-Feld (z. B. für die Ebenen einer Pyramide), sonst die feste Form.
// radius (0..50) rundet Ecken ab: die Form wird etwas verkleinert und mit einem gleichfarbigen,
// rund verbundenen Rand gezeichnet, sodass sie wieder ihr Feld füllt, nur mit weichen Ecken.
export function shapeSvg(shape, fill, points = null, radius = 0) {
  const pts = points ?? POLYGONS[shape];
  const open = `<svg class="shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">`;
  const r = Math.max(0, Math.min(50, radius)) / 2;
  const k = 50 / (50 + r);
  const round = r ? ` stroke="${fill}" stroke-width="${2 * r}" stroke-linejoin="round"` : "";
  const wrap = (inner) => (r ? `<g transform="translate(50 50) scale(${k.toFixed(4)}) translate(-50 -50)">${inner}</g>` : inner);
  if (pts) {
    const list = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    return `${open}${wrap(`<polygon points="${list}" fill="${fill}"${round}/>`)}</svg>`;
  }
  // Die Datenbank bekommt einen etwas dunkleren Deckel, damit sie räumlich wirkt.
  const lid = shape === "cylinder" ? `<ellipse cx="50" cy="12" rx="50" ry="12" fill="#000" fill-opacity="0.18"/>` : "";
  if (PATHS[shape]) return `${open}${wrap(`<path d="${PATHS[shape]}" fill="${fill}" fill-rule="evenodd"${round}/>`)}${lid}</svg>`;
  return null;
}
