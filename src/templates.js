// Vorlagen: fertige Präsentationen mit Stil, Rahmen, Pfad und Platzhaltertexten.
// Jede Vorlage baut ihre Objekte aus den Farben ihres Stils, damit sie zu ihm passt.
import { THEMES } from "./themes.js";

const theme = (id) => structuredClone(THEMES.find((t) => t.id === id));

// Kleine Bausteine. Maße in Leinwand-Einheiten; ein Rahmen ist 1600 × 900 (16:9).
function kit(th) {
  let n = 0;
  const id = (p) => `${p}-${++n}`;
  return {
    frame: (x, y, w, h, title, extra = {}) => ({ id: id("f"), type: "frame", x, y, w, h, title, ...extra }),
    text: (x, y, w, h, text, size, role = "body", extra = {}) => ({ id: id("t"), type: "text", role, x, y, w, h, text, size, ...extra }),
    shape: (shape, x, y, w, h, fill, extra = {}) => ({ id: id("s"), type: "shape", shape, x, y, w, h, fill, ...extra }),
    icon: (name, x, y, s, color = th.accent) => ({ id: id("i"), type: "icon", name, x, y, w: s, h: s, color }),
  };
}

// Ein Inhaltsrahmen: Überschrift, Text und optional ein Symbol oben rechts.
function slide(k, th, x, y, title, body, icon, scale = 1) {
  const s = scale;
  const f = k.frame(x, y, 1600 * s, 900 * s, title);
  const items = [
    f,
    k.text(x + 110 * s, y + 90 * s, 1150 * s, 130 * s, title, 96 * s, "title", { color: th.accent }),
    k.text(x + 110 * s, y + 280 * s, 1250 * s, 520 * s, body, 44 * s),
  ];
  if (icon) items.push(k.icon(icon, x + 1310 * s, y + 90 * s, 180 * s));
  return { frame: f, items };
}

function finish(title, th, parts, order, extra = []) {
  const objects = [...extra, ...parts.flatMap((p) => p.items)];
  const shown = objects.filter((o) => !o.hidden);
  const x = Math.min(...shown.map((o) => o.x));
  const y = Math.min(...shown.map((o) => o.y));
  const w = Math.max(...shown.map((o) => o.x + o.w)) - x;
  const h = Math.max(...shown.map((o) => o.y + o.h)) - y;
  const pad = Math.max(w, h) * 0.05;
  const overview = { id: "f-overview", type: "frame", x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad, hidden: true, title: "Überblick" };
  return {
    format: "weitblick",
    version: 2,
    title,
    theme: th,
    fonts: [],
    objects: [overview, ...objects],
    path: ["f-overview", ...order.map((p) => p.frame.id), "f-overview"],
  };
}

const PH = "Hier steht dein Text.\n• Erster Punkt\n• Zweiter Punkt";

export const TEMPLATES = [
  {
    id: "vortrag",
    name: "Vortrag",
    note: "Titel in der Mitte, drei Kapitel im Kreis darum, Fazit",
    theme: "weitblick",
    build(th) {
      const k = kit(th);
      const hub = k.shape("ellipse", -700, -700, 1400, 1400, th.accent);
      const titleF = { frame: k.frame(-800, -450, 1600, 900, "Titel"), items: [] };
      titleF.items.push(titleF.frame, k.text(-560, -170, 1120, 200, "Dein Vortragstitel", 120, "title", { color: th.background, align: "center" }), k.text(-560, 70, 1120, 100, "Untertitel · Name · Datum", 48, "subtitle", { color: th.background, align: "center" }));
      const pos = [[-2300, -1500], [1100, -1500], [-600, 1100]];
      const names = ["Kapitel 1", "Kapitel 2", "Kapitel 3"];
      const icons = ["lightbulb", "compass", "rocket"];
      const ch = pos.map(([x, y], i) => slide(k, th, x, y, names[i], PH, icons[i], 0.75));
      const ring = (f, d) => k.shape("ellipse", f.x + f.w / 2 - d / 2, f.y + f.h / 2 - d / 2, d, d, th.accent2, { fillOpacity: 0.15 });
      const rings = ch.map((c) => ring(c.frame, c.frame.w + 200));
      const fazit = slide(k, th, 2600, 600, "Fazit", "Das Wichtigste in drei Sätzen.", "flag", 0.6);
      return finish("Vortrag", th, [titleF, ...ch, fazit], [titleF, ...ch, fazit], [hub, ...rings]);
    },
  },
  {
    id: "sport",
    name: "Training & Sport",
    note: "Eine Laufbahn mit vier Phasen vom Aufwärmen bis zum Cool-down",
    theme: "abendrot",
    build(th) {
      const k = kit(th);
      const track = k.shape("rounded", -3600, -150, 7200, 300, th.accent2, { fillOpacity: 0.25, radius: 50 });
      const titleF = { frame: k.frame(-1600, -2300, 3200, 1800, "Titel"), items: [] };
      titleF.items.push(titleF.frame, k.text(-1400, -1800, 2800, 300, "Trainingseinheit", 220, "title", { color: th.accent, align: "center" }), k.text(-1400, -1450, 2800, 140, "Ziel · Dauer · Gruppe", 80, "subtitle", { align: "center" }));
      const phases = [["Aufwärmen", "flame"], ["Hauptteil", "dumbbell"], ["Technik", "target"], ["Cool-down", "heart"]];
      const parts = phases.map(([name, ic], i) => {
        const cx = -2700 + i * 1800;
        const dot = k.shape("ellipse", cx - 300, -300, 600, 600, th.accent);
        const label = k.icon(ic, cx - 150, -150, 300, th.background);
        const s = slide(k, th, cx - 600, 450, name, "Übungen, Wiederholungen, Pausen.", null, 0.75);
        s.items.unshift(dot, label);
        return s;
      });
      return finish("Training & Sport", th, [titleF, ...parts], [titleF, ...parts], [track]);
    },
  },
  {
    id: "wissenschaft",
    name: "Wissenschaft",
    note: "Einleitung, Methoden, Ergebnisse, Diskussion, Fazit, Quellen",
    theme: "klar",
    build(th) {
      const k = kit(th);
      const titleF = { frame: k.frame(-800, -1500, 1600, 900, "Titel"), items: [] };
      titleF.items.push(titleF.frame, k.text(-700, -1300, 1400, 260, "Titel der Arbeit", 104, "title", { color: th.accent, align: "center" }), k.text(-700, -980, 1400, 140, "Autorinnen und Autoren · Institut · Datum", 44, "subtitle", { align: "center" }));
      const cells = [["Einleitung", "lightbulb"], ["Methoden", "flask-conical"], ["Ergebnisse", "chart-column"], ["Diskussion", "messages-square"], ["Fazit", "circle-check"], ["Quellen", "book-open"]];
      const parts = cells.map(([name, ic], i) => slide(k, th, -2550 + (i % 3) * 1750, -300 + Math.floor(i / 3) * 1050, name, PH, ic));
      const panels = parts.map((p) => k.shape("rounded", p.frame.x, p.frame.y, p.frame.w, p.frame.h, th.accent, { fillOpacity: 0.07, radius: 6 }));
      return finish("Wissenschaft", th, [titleF, ...parts], [titleF, ...parts], panels);
    },
  },
  {
    id: "zeitstrahl",
    name: "Zeitstrahl",
    note: "Fünf Meilensteine auf einer Linie, jeder mit eigenem Rahmen",
    theme: "papier",
    build(th) {
      const k = kit(th);
      const line = k.shape("rect", -4200, -12, 8400, 24, th.text);
      const titleF = { frame: k.frame(-1500, -2800, 3000, 1690, "Titel"), items: [] };
      titleF.items.push(titleF.frame, k.text(-1300, -2150, 2600, 300, "Unsere Geschichte", 200, "title", { color: th.accent, align: "center" }));
      const parts = [0, 1, 2, 3, 4].map((i) => {
        const cx = -3600 + i * 1800;
        const up = i % 2 === 0;
        const dot = k.shape("ellipse", cx - 70, -70, 140, 140, th.accent);
        const year = k.text(cx - 300, up ? 120 : -260, 600, 120, `${2020 + i}`, 96, "subtitle", { align: "center", color: th.accent2 });
        const s = slide(k, th, cx - 560, up ? 320 : -900, `Meilenstein ${i + 1}`, "Was ist passiert? Warum war es wichtig?", null, 0.7);
        s.items.unshift(dot, year);
        return s;
      });
      return finish("Zeitstrahl", th, [titleF, ...parts], [titleF, ...parts], [line]);
    },
  },
  {
    id: "mindmap",
    name: "Mindmap",
    note: "Ein zentrales Thema mit sechs Ästen",
    theme: "wald",
    build(th) {
      const k = kit(th);
      const center = k.shape("ellipse", -600, -600, 1200, 1200, th.accent);
      const titleF = { frame: k.frame(-800, -450, 1600, 900, "Thema"), items: [] };
      titleF.items.push(titleF.frame, k.text(-500, -110, 1000, 220, "Thema", 180, "title", { color: th.background, align: "center" }));
      const extra = [];
      const parts = [0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const r = 2600;
        const cx = Math.cos(a) * r;
        const cy = Math.sin(a) * r;
        // Linie vom Rand des Mittelkreises (Radius 600) bis zum Rand des Astkreises (Radius 650).
        const len = r - 650 - 600;
        const mid = 600 + len / 2;
        extra.push(k.shape("rect", Math.cos(a) * mid - len / 2, Math.sin(a) * mid - 15, len, 30, th.accent2, { rot: (a * 180) / Math.PI }));
        extra.push(k.shape("ellipse", cx - 650, cy - 650, 1300, 1300, th.accent2, { fillOpacity: 0.2 }));
        return slide(k, th, cx - 480, cy - 270, `Ast ${i + 1}`, "Stichworte", null, 0.6);
      });
      return finish("Mindmap", th, [titleF, ...parts], [titleF, ...parts], [...extra, center]);
    },
  },
  {
    id: "workshop",
    name: "Workshop",
    note: "Agenda, drei Übungen, Pause und Feedback",
    theme: "ozean",
    build(th) {
      const k = kit(th);
      const agenda = slide(k, th, -800, -1700, "Agenda", "1. Einstieg\n2. Übung A\n3. Pause\n4. Übung B und C\n5. Feedback", "list-checks");
      const ex = ["Übung A", "Übung B", "Übung C"].map((n, i) => slide(k, th, -2700 + i * 1900, -450, n, "Aufgabe · Material · Zeit", ["users", "pencil", "puzzle"][i], 1));
      const pause = slide(k, th, -1750, 750, "Pause", "Zurück um …", "coffee", 0.9);
      const fb = slide(k, th, 250, 750, "Feedback", "Was nehmt ihr mit?", "message-circle", 0.9);
      const cards = [agenda, ...ex, pause, fb].map((p) => k.shape("rounded", p.frame.x, p.frame.y, p.frame.w, p.frame.h, th.accent2, { fillOpacity: 0.12, radius: 8 }));
      return finish("Workshop", th, [agenda, ...ex, pause, fb], [agenda, ex[0], pause, ex[1], ex[2], fb], cards);
    },
  },
  {
    id: "projekt",
    name: "Projektbericht",
    note: "Ziel, Stand mit Fortschrittsbalken, Ergebnisse, Risiken, nächste Schritte",
    theme: "nacht",
    build(th) {
      const k = kit(th);
      const goal = slide(k, th, -800, -1500, "Ziel", "Was wollen wir bis wann erreichen?", "target");
      const state = slide(k, th, -2600, -400, "Stand", "Fortschritt", "gauge");
      const sx = state.frame.x + 110;
      state.items.push(
        k.shape("rounded", sx, state.frame.y + 450, 1380, 90, th.text, { fillOpacity: 0.15, radius: 50 }),
        k.shape("rounded", sx, state.frame.y + 450, 1380 * 0.6, 90, th.accent2, { radius: 50 }),
        k.text(sx, state.frame.y + 580, 1380, 80, "60 % erledigt", 48, "subtitle"),
      );
      const res = slide(k, th, -800, -400, "Ergebnisse", PH, "trophy");
      const risk = slide(k, th, 1000, -400, "Risiken", "Was könnte schiefgehen?", "triangle-alert");
      const next = slide(k, th, -800, 700, "Nächste Schritte", "Wer macht was bis wann?", "arrow-right");
      return finish("Projektbericht", th, [goal, state, res, risk, next], [goal, state, res, risk, next]);
    },
  },
  {
    id: "pitch",
    name: "Idee & Pitch",
    note: "Zoom ins Detail: Problem, Lösung, Markt, Team ineinander verschachtelt",
    theme: "technik",
    build(th) {
      const k = kit(th);
      const big = { frame: k.frame(-3200, -1800, 6400, 3600, "Die Idee"), items: [] };
      big.items.push(big.frame, k.text(-2900, -1600, 4000, 500, "Deine Idee", 380, "title", { color: th.accent }), k.text(-2900, -1000, 4000, 200, "In einem Satz: was, für wen, warum jetzt.", 120, "subtitle"));
      const parts = [["Problem", "circle-alert"], ["Lösung", "sparkles"], ["Markt", "chart-pie"], ["Team", "users"]].map(([n, ic], i) => slide(k, th, -2900 + (i % 2) * 2950, -500 + Math.floor(i / 2) * 1150, n, PH, ic, 0.95));
      const ask = slide(k, th, 3500, 700, "Unser Wunsch", "Was brauchen wir von euch?", "handshake", 0.6);
      return finish("Idee & Pitch", th, [big, ...parts, ask], [big, ...parts, ask]);
    },
  },
  {
    id: "vorstellung",
    name: "Über mich",
    note: "Vorstellung oder Lebenslauf: dein Name in der Mitte, vier Themen ringsum",
    theme: "papier",
    build(th) {
      const k = kit(th);
      const disc = k.shape("ellipse", -650, -650, 1300, 1300, th.accent);
      const me = { frame: k.frame(-800, -450, 1600, 900, "Ich"), items: [] };
      me.items.push(me.frame, k.icon("user-round", -110, -380, 220, th.background), k.text(-560, -110, 1120, 200, "Dein Name", 140, "title", { color: th.background, align: "center" }), k.text(-560, 120, 1120, 100, "Beruf · Ort", 56, "subtitle", { color: th.background, align: "center" }));
      const topics = [["Woher ich komme", "map-pin", -2900, -1500], ["Stationen", "briefcase", 1300, -1500], ["Was ich kann", "star", -2900, 650], ["Kontakt", "mail", 1300, 650]];
      const parts = topics.map(([n, ic, x, y]) => slide(k, th, x, y, n, PH, ic, 0.85));
      return finish("Über mich", th, [me, ...parts], [me, ...parts], [disc]);
    },
  },
  {
    id: "unterricht",
    name: "Unterrichtsstunde",
    note: "Eine Treppe: Einstieg, Erarbeitung, Sicherung, Hausaufgabe",
    theme: "klar",
    build(th) {
      const k = kit(th);
      const steps = [["Einstieg", "Frage oder Bild, das neugierig macht.", "sparkles"], ["Erarbeitung", "Aufgabe · Material · Sozialform", "book-open"], ["Sicherung", "Was haben wir gelernt?", "circle-check"], ["Hausaufgabe", "Bis wann, wo abgeben?", "notebook-pen"]];
      const parts = steps.map(([n, body, ic], i) => slide(k, th, -3200 + i * 1700, 900 - i * 700, n, body, ic, 0.9));
      const stairs = parts.map((p) => k.shape("rect", p.frame.x, p.frame.y + p.frame.h + 40, p.frame.w, 2600 - (p.frame.y + p.frame.h + 40), th.accent2, { fillOpacity: 0.12 }));
      const titleF = { frame: k.frame(-3200, -2400, 3200, 1800, "Thema"), items: [] };
      titleF.items.push(titleF.frame, k.text(-3000, -1900, 2800, 300, "Thema der Stunde", 220, "title", { color: th.accent }), k.text(-3000, -1500, 2800, 140, "Klasse · Fach · Datum", 90, "subtitle"));
      return finish("Unterrichtsstunde", th, [titleF, ...parts], [titleF, ...parts], stairs);
    },
  },
  {
    id: "poster",
    name: "Forschungs-Poster",
    note: "Ein großes Poster als Überblick, die Kamera zoomt in jedes Feld",
    theme: "ozean",
    build(th) {
      const k = kit(th);
      const sheet = k.shape("rounded", -2500, -1600, 5000, 3200, th.text, { fillOpacity: 0.06, radius: 2 });
      const head = { frame: k.frame(-2400, -1550, 4800, 700, "Titel"), items: [] };
      head.items.push(head.frame, k.text(-2300, -1450, 4600, 300, "Titel des Posters", 230, "title", { color: th.accent, align: "center" }), k.text(-2300, -1100, 4600, 150, "Autorinnen und Autoren · Institut", 90, "subtitle", { align: "center" }));
      const cells = [["Hintergrund", "lightbulb"], ["Methode", "flask-conical"], ["Ergebnis", "chart-line"], ["Abbildung", "image"], ["Fazit", "circle-check"], ["Quellen", "book-open"]];
      const parts = cells.map(([n, ic], i) => slide(k, th, -2400 + (i % 3) * 1630, -750 + Math.floor(i / 3) * 1150, n, PH, ic, 0.95));
      return finish("Forschungs-Poster", th, [head, ...parts], [head, ...parts], [sheet]);
    },
  },
  {
    id: "vergleich",
    name: "Vergleich A gegen B",
    note: "Zwei Seiten, drei Kriterien, am Ende das Urteil",
    theme: "nacht",
    build(th) {
      const k = kit(th);
      const left = k.shape("rounded", -3400, -1900, 3300, 3800, th.accent, { fillOpacity: 0.15, radius: 4 });
      const right = k.shape("rounded", 100, -1900, 3300, 3800, th.accent2, { fillOpacity: 0.15, radius: 4 });
      const vs = k.shape("ellipse", -350, -350, 700, 700, th.text);
      const vsText = k.text(-300, -110, 600, 220, "vs.", 180, "title", { color: th.background, align: "center" });
      const titleF = { frame: k.frame(-3500, -2500, 7000, 3940, "Vergleich"), items: [] };
      titleF.items.push(titleF.frame, k.text(-3300, -1700, 3100, 300, "Option A", 260, "title", { color: th.accent, align: "center" }), k.text(200, -1700, 3100, 300, "Option B", 260, "title", { color: th.accent2, align: "center" }));
      const crit = ["Kosten", "Aufwand", "Wirkung"];
      const parts = crit.flatMap((c, i) => [slide(k, th, -3200, -1200 + i * 1000, `A: ${c}`, "Stichworte", null, 0.55), slide(k, th, 300, -1200 + i * 1000, `B: ${c}`, "Stichworte", null, 0.55)]);
      const verdict = slide(k, th, -800, 2200, "Unser Urteil", "Darum entscheiden wir uns für …", "scale");
      return finish("Vergleich A gegen B", th, [titleF, ...parts, verdict], [titleF, ...parts, verdict], [left, right, vs, vsText]);
    },
  },
  {
    id: "jahr",
    name: "Jahresrückblick",
    note: "Vier Quartale mit Höhepunkten, dazu Zahlen und ein Ausblick",
    theme: "abendrot",
    build(th) {
      const k = kit(th);
      const year = new Date().getFullYear();
      const titleF = { frame: k.frame(-1600, -2300, 3200, 1800, "Titel"), items: [] };
      titleF.items.push(titleF.frame, k.text(-1400, -2050, 2800, 560, String(year), 440, "title", { color: th.accent, align: "center" }), k.text(-1400, -1400, 2800, 170, "Unser Jahr im Rückblick", 120, "subtitle", { align: "center" }));
      const q = ["Januar – März", "April – Juni", "Juli – September", "Oktober – Dezember"].map((n, i) => slide(k, th, -3400 + i * 1720, -200, n, "Der Höhepunkt des Quartals.", ["snowflake", "flower", "sun", "leaf"][i], 0.95));
      const nums = slide(k, th, -2000, 900, "In Zahlen", "123 Kunden · 45 Projekte · 6 neue Kolleginnen", "chart-column", 1);
      const next = slide(k, th, 300, 900, `Ausblick ${year + 1}`, "Was wir uns vornehmen.", "telescope", 1);
      return finish("Jahresrückblick", th, [titleF, ...q, nums, next], [titleF, ...q, nums, next]);
    },
  },
  {
    id: "quiz",
    name: "Quiz",
    note: "Fragen mit Antworten, die erst beim nächsten Klick erscheinen",
    theme: "technik",
    build(th) {
      const k = kit(th);
      const titleF = { frame: k.frame(-800, -1700, 1600, 900, "Quiz"), items: [] };
      titleF.items.push(titleF.frame, k.icon("circle-question-mark", -150, -1620, 300), k.text(-700, -1250, 1400, 220, "Das große Quiz", 150, "title", { color: th.accent, align: "center" }));
      const answers = [];
      const parts = [0, 1, 2, 3].map((i) => {
        const s = slide(k, th, -1700 + (i % 2) * 1800, -500 + Math.floor(i / 2) * 1100, `Frage ${i + 1}`, "Wie lautet die Frage?", null, 0.95);
        const a = k.shape("rounded", s.frame.x + 110, s.frame.y + 560, 1300, 220, th.accent2, { radius: 30 });
        const t = k.text(s.frame.x + 150, s.frame.y + 600, 1220, 140, "Antwort: …", 70, "subtitle", { color: th.background, group: `g-${i}` });
        a.group = `g-${i}`;
        s.items.push(a, t);
        answers.push([s.frame.id, [a.id, t.id]]);
        return s;
      });
      const d = finish("Quiz", th, [titleF, ...parts], [titleF, ...parts]);
      // Nach jeder Frage ein Einblende-Schritt für die Antwort.
      for (const [frameId, targets] of answers) d.path.splice(d.path.indexOf(frameId) + 1, 0, { type: "fade-in", targets });
      return d;
    },
  },
].map((t) => ({ ...t, doc: () => t.build(theme(t.theme)) }));
