// Formen der Seitenleiste. Rechteck und Kreis zeichnet CSS, alle anderen ein SVG-Polygon
// in einem 100×100-Feld, das auf die Objektgröße gestreckt wird.

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

const POLYGONS = {
  triangle: regular(3),
  diamond: regular(4),
  pentagon: regular(5),
  hexagon: regular(6, 30),
  heptagon: regular(7),
  octagon: regular(8, 22.5),
  star: star(5),
  arrow: [[0, 30], [62, 30], [62, 5], [100, 50], [62, 95], [62, 70], [0, 70]],
  chevron: [[0, 0], [70, 0], [100, 50], [70, 100], [0, 100], [30, 50]],
  trapezoid: [[20, 0], [80, 0], [100, 100], [0, 100]],
};

// Reihenfolge und Beschriftung in der Seitenleiste; size ist das Seitenverhältnis (w, h) beim Einfügen.
export const SHAPES = [
  { id: "rect", label: "Rechteck" },
  { id: "ellipse", label: "Kreis" },
  { id: "line", label: "Linie", size: [1, 0.03] },
  { id: "triangle", label: "Dreieck" },
  { id: "diamond", label: "Raute" },
  { id: "pentagon", label: "Fünfeck" },
  { id: "hexagon", label: "Sechseck" },
  { id: "heptagon", label: "Siebeneck" },
  { id: "octagon", label: "Achteck" },
  { id: "star", label: "Stern" },
  { id: "arrow", label: "Pfeil", size: [1, 0.5] },
  { id: "chevron", label: "Winkel", size: [0.7, 0.5] },
  { id: "trapezoid", label: "Trapez", size: [1, 0.6] },
];

// points: eigene Eckpunkte im 100×100-Feld (z. B. für die Ebenen einer Pyramide), sonst die feste Form.
export function shapeSvg(shape, fill, points = null) {
  const pts = points ?? POLYGONS[shape];
  if (!pts) return null;
  const list = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return `<svg class="shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="${list}" fill="${fill}"/></svg>`;
}
