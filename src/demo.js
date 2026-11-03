// Beispielpräsentation im geplanten Format von presentation.json (Version 1).
// Alle Maße in Leinwand-Einheiten.

export const demo = {
  format: "weitblick",
  version: 1,
  title: "Willkommen bei Weitblick",
  theme: { background: "#1f3d3a", text: "#f5efe8", accent: "#f28c38", accent2: "#6fb3aa", fonts: { title: "Weitblick Brand", subtitle: "sans", body: "sans" }, id: "weitblick" },
  objects: [
    { id: "f-overview", type: "frame", x: -100, y: -100, w: 3400, h: 2000, hidden: true, title: "Überblick" },

    { id: "s-sun", type: "shape", shape: "ellipse", x: 1150, y: 550, w: 700, h: 700, fill: "#f28c38" },
    { id: "t-title", type: "text", role: "title", x: 1210, y: 820, w: 580, h: 160, text: "Weitblick", size: 120, color: "#1f3d3a", align: "center", weight: 700 },

    { id: "f-idea", type: "frame", x: 100, y: 100, w: 900, h: 560, title: "Die Idee" },
    { id: "t-idea-h", type: "text", role: "title", x: 160, y: 150, w: 780, h: 90, text: "Die Idee", size: 72, color: "#f28c38" },
    { id: "t-idea-b", type: "text", role: "body", x: 160, y: 270, w: 780, h: 300, text: "Alles liegt auf einer großen Leinwand.\nDie Kamera fliegt von Gedanke zu Gedanke.", size: 36 },

    { id: "f-detail", type: "frame", x: 700, y: 520, w: 260, h: 110, title: "Ein Detail" },
    { id: "t-detail", type: "text", role: "subtitle", x: 712, y: 545, w: 236, h: 60, text: "…sogar ganz klein versteckt.", size: 16, color: "#6fb3aa" },

    { id: "f-path", type: "frame", x: 2100, y: 150, w: 900, h: 560, title: "Der Pfad" },
    { id: "t-path-h", type: "text", role: "title", x: 2160, y: 200, w: 780, h: 90, text: "Der Pfad", size: 72, color: "#f28c38" },
    { id: "t-path-b", type: "text", role: "body", x: 2160, y: 320, w: 780, h: 300, text: "Pfeiltasten: weiter und zurück.\nPos1: Überblick.\nMausrad: zoomen. Ziehen: verschieben.", size: 36 },

    { id: "f-free", type: "frame", x: 1100, y: 1400, w: 900, h: 420, title: "Frei erkunden" },
    { id: "t-free-h", type: "text", role: "title", x: 1160, y: 1440, w: 780, h: 90, text: "Frei erkunden", size: 72, color: "#f28c38" },
    { id: "t-free-b", type: "text", role: "body", x: 1160, y: 1560, w: 780, h: 200, text: "Doppelklick auf einen Rahmen fliegt direkt dorthin.", size: 36 },
  ],
  path: ["f-overview", "f-idea", "f-detail", "f-path", "f-free", "f-overview"],
};
