// Vorgefertigte Stile: Farbpalette plus Schriftkombination für Titel, Untertitel und Text.
// Schriftnamen außer sans/serif/mono sind Google-Schriften und werden beim Anwenden eingebettet.

export const THEMES = [
  {
    id: "weitblick",
    name: "Weitblick",
    background: "#1f3d3a",
    text: "#f5efe8",
    accent: "#f28c38",
    accent2: "#6fb3aa",
    fonts: { title: "Weitblick Brand", subtitle: "Nunito", body: "Nunito" },
  },
  {
    id: "nacht",
    name: "Nacht",
    background: "#15161a",
    text: "#f2f2f2",
    accent: "#f5c518",
    accent2: "#4fc38a",
    fonts: { title: "Orbitron", subtitle: "Playfair Display", body: "Playfair Display" },
  },
  {
    id: "papier",
    name: "Papier",
    background: "#fbf6ee",
    text: "#2b2622",
    accent: "#c8553d",
    accent2: "#3c7a73",
    fonts: { title: "Playfair Display", subtitle: "Lora", body: "Lora" },
  },
  {
    id: "klar",
    name: "Klar",
    background: "#ffffff",
    text: "#1d1f24",
    accent: "#3c7a73",
    accent2: "#f28c38",
    fonts: { title: "Montserrat", subtitle: "Inter", body: "Inter" },
  },
  {
    id: "wald",
    name: "Wald",
    background: "#1e2a22",
    text: "#eef3ea",
    accent: "#9bc53d",
    accent2: "#e9c46a",
    fonts: { title: "Bebas Neue", subtitle: "Work Sans", body: "Work Sans" },
  },
  {
    id: "ozean",
    name: "Ozean",
    background: "#0b2545",
    text: "#eef4ed",
    accent: "#13c4a3",
    accent2: "#8da9c4",
    fonts: { title: "Poppins", subtitle: "Nunito", body: "Nunito" },
  },
  {
    id: "abendrot",
    name: "Abendrot",
    background: "#2d1e2f",
    text: "#fbe9d7",
    accent: "#ff7f50",
    accent2: "#f6c177",
    fonts: { title: "Abril Fatface", subtitle: "Lato", body: "Lato" },
  },
  {
    id: "technik",
    name: "Technik",
    background: "#0d1117",
    text: "#c9d1d9",
    accent: "#58a6ff",
    accent2: "#3fb950",
    fonts: { title: "Space Mono", subtitle: "JetBrains Mono", body: "Inter" },
  },
];

export const ROLES = [
  ["title", "Titel"],
  ["subtitle", "Untertitel"],
  ["body", "Text"],
];
