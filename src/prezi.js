// Import einer Offline-Prezi („Portable Prezi“ als .zip). contents.portable/prezi.xml beschreibt die ganze
// Leinwand: Objekte mit Mittelpunkt, Maßstab und Drehung, Rahmen mit ihrem Inhalt, Stile, Schriften und den Pfad.
// Prezi Next und aus Prezi Classic umgewandelte Präsentationen („converted-from-core“) teilen das Format,
// nutzen aber teils eigene Objektarten (Classic: zText, zCircleFrame …; Next: zRichText, zSmartObject …).

import { swfToSvg } from "./swf.js";

const parseXml = (t) => new DOMParser().parseFromString(t, "application/xml");
const kids = (el) => [...(el?.children ?? [])];

// Prezi Classic speichert keine Schriftgröße: Text steht in einer festen Grundgröße, größer wird er nur über den
// Maßstab. Geschätzt aus Textfeldbreiten (Vorlagen-Platzhalter passen in eine Zeile).
// shortcut: Schätzwert, mit einer Bildschirmansicht aus Prezi abgleichen, sobald es eine gibt.
const CLASSIC_FONT_SIZE = 22;

// Prezi schreibt Felder auf zwei Arten: <width><double value/></width> oder
// <xField name="width"><xDouble value/></xField>, optionale Werte zusätzlich in <xJust>.
function field(el, name) {
  const f = kids(el).find((c) => c.localName === name || (c.localName === "xField" && c.getAttribute("name") === name));
  let v = f?.firstElementChild ?? null;
  while (v?.localName === "xJust") v = v.firstElementChild;
  return v;
}
const val = (el, name) => field(el, name)?.getAttribute("value") ?? null;
const num = (el, name, d = 0) => {
  const v = parseFloat(val(el, name));
  return Number.isFinite(v) ? v : d;
};
const kindOf = (el) => (el.localName === "xConstructor" ? el.getAttribute("name") : el.localName);
const refs = (el) => [...(el?.getElementsByTagName("*") ?? [])].filter((e) => e.localName === "ref" || e.localName === "xRef").map((e) => e.getAttribute("value"));
const hexOf = (n) => `#${(+n >>> 0).toString(16).padStart(6, "0").slice(-6)}`;

// Prezi-Schriften (.keg) sind OpenType/TrueType mit einem kurzen Vorspann davor.
function stripKeg(b64) {
  const bin = atob(b64);
  const head = bin.slice(0, 256);
  const at = ["OTTO", "\0\x01\0\0", "wOFF", "wOF2", "true"].map((m) => head.indexOf(m)).filter((i) => i >= 0);
  if (!at.length) return null;
  const start = Math.min(...at);
  return { data: btoa(bin.slice(start)), ext: bin.startsWith("OTTO", start) ? "otf" : bin.startsWith("wOF2", start) ? "woff2" : bin.startsWith("wOFF", start) ? "woff" : "ttf" };
}

// Eigene Prezi-Form (SVG-Pfad) als Eckpunkte im 100×100-Feld; nur gerade Linien (M L H V Z), sonst null.
function pathPoints(d, w, h) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts = [];
  let x = 0;
  let y = 0;
  let cmd = "";
  for (let i = 0; i < tokens.length; ) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const n = () => parseFloat(tokens[i++]);
    if (cmd === "Z" || cmd === "z") continue;
    if ("MLml".includes(cmd)) {
      const [a, b] = [n(), n()];
      [x, y] = cmd === cmd.toUpperCase() ? [a, b] : [x + a, y + b];
    } else if (cmd === "H") x = n();
    else if (cmd === "h") x += n();
    else if (cmd === "V") y = n();
    else if (cmd === "v") y += n();
    else return null;
    pts.push([(x / w) * 100, (y / h) * 100]);
  }
  return pts.length >= 3 ? pts : null;
}

export async function importPrezi(entries, title, baseTheme) {
  const xmlEntry = entries.find((e) => e.name.endsWith("contents.portable/prezi.xml"));
  if (!xmlEntry?.text) throw new Error("Das ist keine Offline-Prezi: contents.portable/prezi.xml fehlt im Archiv.");
  const base = xmlEntry.name.slice(0, -"prezi.xml".length);
  const files = new Map(entries.map((e) => [e.name.slice(base.length), e]));
  const root = parseXml(xmlEntry.text).documentElement;
  if (root.localName !== "prezi") throw new Error("prezi.xml lässt sich nicht lesen.");
  if (root.getAttribute("version") !== "2") throw new Error(`Prezi-Format Version ${root.getAttribute("version")} wird noch nicht unterstützt.`);

  // Stile: Selektor („zRichText.title“, „*.poly2“, „zCircleFrame“, „#ID“, „background“) → Eigenschaften.
  const styles = new Map();
  for (const decl of root.getElementsByTagName("styleDeclaration")) {
    const sel = decl.getElementsByTagName("simpleSelector")[0]?.getAttribute("value");
    const block = kids(kids(decl).find((c) => c.localName === "styleBlock")).find((c) => c.localName === "styleBlock");
    if (!sel || !block) continue;
    const props = {};
    for (const p of kids(block)) {
      const v = p.firstElementChild?.getAttribute("value");
      if (v != null) props[p.localName] = v;
    }
    // Farbfilter für Grafiken: „solidColorBlend“ mischt jede Farbe zu blendAlpha auf blendColor.
    const cf = decl.querySelector('xField[name="colorFilter"] xConstructor[name="solidColorBlend"]');
    if (cf) props.tint = { color: val(cf, "blendColor") ?? "#000000", alpha: num(cf, "blendAlpha", 1) };
    styles.set(sel, { ...styles.get(sel), ...props });
  }
  const styleOf = (kind, classes, id) =>
    Object.assign({}, styles.get(kind), ...classes.flatMap((c) => [styles.get(`*.${c}`), styles.get(`${kind}.${c}`)]), styles.get(`#${id}`));
  const fillOf = (st) => st.color ?? st.gradStartColor ?? st.gradEndColor;

  // Schriften: Klasse (title, body_2, head …) → Familie; Familien mit ihren Schnitten werden eingebettet.
  const classFont = {};
  for (const fc of root.getElementsByTagName("fontClass")) {
    classFont[val(fc, "name")] = { family: val(fc, "fontFamily"), bold: val(fc, "fontWeight") === "bold", italic: val(fc, "fontStyle") === "italic" };
  }
  const media = [];
  const skipped = new Set();
  const fonts = [];
  const usedFamilies = new Set(Object.values(classFont).map((f) => f.family));
  for (const fam of root.getElementsByTagName("fontFamily")) {
    const family = val(fam, "name");
    if (!family || !usedFamilies.has(family) || fonts.some((f) => f.family === family)) continue;
    const faces = [];
    for (const face of fam.getElementsByTagName("fontFace")) {
      const srcName = val(face, "fontSrc");
      const raw = files.get(`fonts/${srcName}`)?.data;
      const font = raw && stripKeg(raw);
      if (!font) continue;
      const src = `media/fonts/${srcName.replace(/\.keg$/i, "")}.${font.ext}`;
      media.push({ name: src, data: font.data });
      faces.push({ src, weight: val(face, "fontWeight") === "bold" ? "700" : "400", style: val(face, "fontStyle") === "italic" ? "italic" : "normal" });
    }
    if (faces.length) fonts.push({ family, faces });
    else skipped.add(`Schrift ${family}`);
  }

  // Bilddateien heißen nach der Online- oder der Offline-Kennung, gefolgt von „-Prüfsumme“.
  const assetFile = (el) => {
    const ids = [val(el, "offlineAssetId"), val(el, "onlineAssetId")].filter(Boolean);
    return [...files.keys()].find((n) => n.startsWith("images/") && ids.some((a) => n.startsWith(`images/${a}-`) || n.startsWith(`images/${a}.`)));
  };
  // Flash-Dateien ebenso; PDF-Seiten enden auf „_page_1.swf“.
  const swfFile = (el, pdf) => {
    const ids = [val(el, "onlineAssetId"), val(el, "offlineAssetId")].filter(Boolean);
    return [...files.keys()].find((n) => n.startsWith("swfs/") && ids.some((a) => n.startsWith(`swfs/${a}-`)) && n.endsWith(pdf ? "_page_1.swf" : ".swf"));
  };

  const objects = [];
  const byId = new Map();
  const childOf = new Map(); // Objekt-id → Rahmen, die es als Inhalt nennen
  const topics = []; // Prezi-Next-Themen: unsichtbare Klammer um ihre Kinder, Ziel von Pfadschritten
  const groups = [];
  const textColor = styles.get("zRichText.title")?.color ?? styles.get("zText.title")?.color ?? baseTheme.text;
  const add = (o) => {
    objects.push(o);
    byId.set(o.id, o);
    return o;
  };
  const own = (child, frame) => childOf.set(child, [...(childOf.get(child) ?? []), frame]);

  for (const el of kids(field(root, "zObjects"))) {
    const kind = kindOf(el);
    const id = val(el, "id");
    if (!id) continue;
    if (kind === "zTopicContainer") {
      // Kapitel (Planet, Stapel): Kinder mit Rolle – visual (die Form), cover (von außen sichtbar), content (innen).
      const tc = field(el, "topic");
      const recs = kids(field(tc, "topicChildren"));
      const children = recs.length
        ? recs.map((r) => ({ role: field(r, "behaviour")?.getAttribute("name"), id: val(r, "child") }))
        : refs(field(tc, "children")).map((c) => ({ role: null, id: c }));
      topics.push({ id, children });
      continue;
    }
    if (kind === "zGroup") {
      groups.push({ id, children: refs(el) });
      continue;
    }
    const t = field(el, "localToWorld");
    if (!t) continue;
    const s = +t.getAttribute("scale");
    const cx = +t.getAttribute("x");
    const cy = +t.getAttribute("y");
    const rad = +t.getAttribute("rotation") || 0;
    const rot = Math.round((rad * 180) / Math.PI * 10) / 10;
    // Prezi legt Objekte über ihren Mittelpunkt; Breite und Höhe sind lokal und werden mit dem Maßstab multipliziert.
    const box = (w, h) => ({ x: cx - (w * s) / 2, y: cy - (h * s) / 2, w: w * s, h: h * s, ...(rot % 360 ? { rot } : {}) });
    const classes = kids(field(el, "styleClasses")).map((c) => c.getAttribute("value"));
    const st = styleOf(kind, classes, id);
    const W = num(el, "width");
    const H = num(el, "height");

    if (kind === "zSmartObject") {
      const desc = field(el, "description");
      if (desc?.getAttribute("name") !== "frame") {
        skipped.add(`Prezi-Objekte vom Typ ${desc?.getAttribute("name") ?? "unbekannt"}`);
        continue;
      }
      const content = refs(field(desc, "contentChildren") ?? desc);
      for (const c of content) own(c, id);
      // Rahmen ohne Inhalt sind in Prezi reine Zoom-Ziele: in Weitblick versteckte Rahmen.
      add({ id, type: "frame", title: "", ...box(W, H), ...(content.length ? {} : { hidden: true }) });
    } else if (kind === "zZoomArea") {
      add({ id, type: "frame", title: "", hidden: true, ...box(W, H) });
    } else if (["zInvisibleFrame", "zCircleFrame", "zRectangleFrame", "zBracketFrame"].includes(kind)) {
      // Classic-Rahmen: Kreis und Rechteck sind sichtbar gefüllt, Weitblick-Rahmen nicht; die Füllung wird eine Form.
      const r = box(W, H);
      if (kind !== "zInvisibleFrame" && kind !== "zBracketFrame") {
        const a0 = parseFloat(st.gradStartAlpha ?? st.alpha ?? "1");
        const a1 = parseFloat(st.gradEndAlpha ?? st.alpha ?? "1");
        const fill = fillOf(st) ?? "#808080";
        const shape = kind === "zCircleFrame" ? { shape: "ellipse", ...((a0 + a1) / 2 < 1 ? { opacity: (a0 + a1) / 2 } : {}) } : { shape: "rect", ...(a0 !== a1 ? { fade: [a0, a1] } : a0 < 1 ? { opacity: a0 } : {}) };
        if (a0 + a1 > 0) own(add({ id: `${id}-fill`, type: "shape", fill, ...shape, ...r }).id, id);
      }
      if (kind === "zBracketFrame") skipped.add("Klammer-Rahmen (ohne Klammern)");
      add({ id, type: "frame", title: "", ...r });
    } else if (kind === "zShape") {
      const type = val(el, "shapeType");
      let shape = { rectangle: "rect", oval: "ellipse", triangle: "triangle" }[type];
      let points = null;
      if (type === "custom") points = pathPoints(val(field(el, "customShape"), "d") ?? "", W, H);
      if (!shape && !points) skipped.add(`Formen vom Typ ${type} (als Rechteck)`);
      // Linearer Verlauf: in Prezi von oben (gradStart) nach unten (gradEnd), meist dieselbe Farbe mit abnehmender Deckkraft.
      const linear = st.fillType === "linear" && st.gradStartAlpha !== st.gradEndAlpha;
      if (st.fillType && !["solid", "linear"].includes(st.fillType)) skipped.add("Farbverläufe in Formen (als Vollfarbe)");
      const alpha = parseFloat(st.alpha ?? "1");
      add({
        id,
        type: "shape",
        shape: points ? "polygon" : (shape ?? "rect"),
        ...(points ? { points } : {}),
        fill: (st.fillType === "linear" ? st.gradStartColor : st.color) ?? fillOf(st) ?? "#808080",
        ...box(W, H),
        ...(linear && (shape ?? "rect") === "rect" && !points ? { fade: [parseFloat(st.gradStartAlpha ?? "1"), parseFloat(st.gradEndAlpha ?? "0")] } : {}),
        ...(alpha < 1 ? { opacity: alpha } : {}),
      });
    } else if (kind === "zLine" || kind === "zArrow") {
      // Linie von ihrem Anfang (Ursprung) um startEndDistance entlang der gedrehten x-Achse.
      const d = num(el, "startEndDistance") * s;
      const th = Math.max(parseFloat(st.thickness ?? "4") * s, 1);
      const len = Math.abs(d);
      const mx = cx + (Math.cos(rad) * d) / 2;
      const my = cy + (Math.sin(rad) * d) / 2;
      const deg = Math.round(((rad * 180) / Math.PI + (d < 0 ? 180 : 0)) * 10) / 10;
      const arrow = kind === "zArrow";
      const h = arrow ? th / 0.24 : th; // die Pfeillinie hat ihren Schaft in der Mitte (38–62 % der Höhe)
      add({ id, type: "shape", shape: arrow ? "line-arrow" : "rect", fill: fillOf(st) ?? textColor, x: mx - len / 2, y: my - h / 2, w: len, h, ...(deg % 360 ? { rot: deg } : {}) });
    } else if (kind === "zImage") {
      const file = assetFile(el);
      if (!file) {
        skipped.add("Bilder, die nicht im Archiv liegen");
        continue;
      }
      const src = `media/${id}.${file.split(".").pop().toLowerCase()}`;
      media.push({ name: src, data: files.get(file).data });
      // Zuschnitt (mask, in Bildpixeln): nur der Ausschnitt ist sichtbar, sein Mittelpunkt liegt neben der Bildmitte.
      const m = field(el, "mask");
      const [mx, my, mw, mh] = m ? ["x", "y", "w", "h"].map((a) => +m.getAttribute(a)) : [0, 0, W, H];
      const dx = (mx + mw / 2 - W / 2) * s;
      const dy = (my + mh / 2 - H / 2) * s;
      const r = box(mw, mh);
      r.x += dx * Math.cos(rad) - dy * Math.sin(rad);
      r.y += dx * Math.sin(rad) + dy * Math.cos(rad);
      add({ id, type: "image", src, ...r, ...(m ? { crop: { x: mx / W, y: my / H, w: mw / W, h: mh / H } } : {}) });
    } else if (kind === "zPdf" || kind === "zSwfGraphics") {
      // Offline liegen PDF-Seiten und Grafiken als Flash-Vektorbild bei: als SVG übernehmen, eingefärbt wie in Prezi.
      const file = swfFile(el, kind === "zPdf");
      const view = kind === "zSwfGraphics" ? { x: num(el, "swfBoundsLeft"), y: num(el, "swfBoundsTop"), w: W, h: H } : null;
      const svg = file && (await swfToSvg(files.get(file).data, { tint: st.tint, view }).catch(() => null));
      if (svg) {
        const src = `media/${id}.svg`;
        media.push({ name: src, data: btoa(svg) });
        add({ id, type: "image", src, ...box(W || 200, H || 200) });
      } else {
        skipped.add("Grafiken, die sich nicht umwandeln ließen (als Platzhalter-Symbol)");
        add({ id, type: "icon", name: "shapes", color: textColor, ...box(W || 200, H || 200) });
      }
    } else if (kind === "zVideo") {
      skipped.add("Videos (als Platzhalter-Symbol)");
      add({ id, type: "icon", name: "video", color: textColor, ...box(640, 360) });
    } else if (kind === "zRichText") {
      const rec = field(el, "text");
      const width = num(rec, "width", -1);
      if (width <= 0) continue; // leerer Platzhaltertext ohne Breite
      let size = 0;
      let bold = false;
      let italic = false;
      let color = null;
      let align = null;
      const lines = kids(field(rec, "paragraphs")).map((p) => {
        const ps = field(p, "paragraphStyle");
        align ??= val(ps, "alignment");
        const bullet = val(ps, "listType") ? `${"   ".repeat(Math.max(0, num(ps, "indent", 1) - 1))}• ` : "";
        return (
          bullet +
          kids(field(p, "spans"))
            .map((span) => {
              const ss = field(span, "style");
              size ||= num(ss, "fontSize");
              bold ||= val(ss, "fontWeight") === "bold";
              italic ||= val(ss, "fontStyle") === "italic";
              color ??= val(ss, "color");
              return val(span, "text") ?? "";
            })
            .join("")
        );
      });
      const text = lines.join("\n");
      if (!text.trim()) continue;
      // Autofit: „wrap“ ist die natürliche Zeilenbreite bei fontSize. Ist sie breiter als das Feld („width“),
      // verkleinert Prezi die Schrift entsprechend; „height“ ist die Feldhöhe. Ohne Autofit misst Weitblick nach.
      const fit = field(rec, "autofit");
      size = (size || 20) * Math.min(1, width / num(fit, "wrap", width));
      const cls = classes.find((c) => classFont[c]) ?? "body";
      const role = cls.replace(/_\d+$/, "");
      const bg = st.displayBackground === "true" ? { bg: st.backgroundColor ?? "#666666", bgPad: parseFloat(st.backgroundPadding ?? "0") * s } : {};
      add({
        id,
        type: "text",
        text,
        size: size * s,
        color: color ?? st.color ?? textColor,
        align: align ?? "left",
        role: ["title", "subtitle", "body"].includes(role) ? role : "body",
        ...(cls !== role ? { font: classFont[cls].family } : {}),
        ...(bold || (cls !== role && classFont[cls].bold) ? { weight: 700 } : {}),
        ...(italic ? { italic: true } : {}),
        ...(fit ? {} : { fitH: true }),
        ...bg,
        ...box(width, fit ? num(fit, "height") : size * 1.3 * lines.length),
      });
    } else if (kind === "zText") {
      // Classic-Text: <text><width/><p align listType indent><span color>…</span></p></text>
      const inner = field(el, "text");
      const width = Math.abs(parseFloat(kids(inner).find((c) => c.localName === "width")?.textContent));
      const paras = kids(inner).filter((c) => c.localName === "p");
      const text = paras
        .map((p) => (p.getAttribute("listType") ? `${"   ".repeat(Math.max(0, +(p.getAttribute("indent") ?? 1) - 1))}• ` : "") + p.textContent.trim())
        .join("\n");
      if (!text.trim() || !width) continue;
      const span = el.querySelector("span[color]");
      const tok = classes[0] ?? "body";
      const role = ["title", "subtitle"].includes(tok) ? tok : "body";
      const cf = classFont[st.fontClass] ?? classFont.body ?? {};
      add({
        id,
        type: "text",
        text,
        size: CLASSIC_FONT_SIZE * s,
        color: span ? hexOf(span.getAttribute("color")) : (st.color ?? textColor),
        align: paras.find((p) => p.getAttribute("align"))?.getAttribute("align") ?? "left",
        role,
        ...(cf.family ? { font: cf.family } : {}),
        ...(cf.bold ? { weight: 700 } : {}),
        ...(cf.italic ? { italic: true } : {}),
        fitH: true,
        ...box(width, CLASSIC_FONT_SIZE * 1.3 * paras.length),
      });
    } else {
      skipped.add(`Prezi-Objekte vom Typ ${kind}`);
    }
  }

  // Kapitel (Next): ein versteckter Rahmen um ihre Form (sonst um alle Kinder). Wie in Prezi ist das Cover nur
  // von außen sichtbar und der Inhalt nur von innen (cover/inside, ausgewertet beim Zeichnen).
  const topicOf = new Map(topics.map((tp) => [tp.id, tp]));
  const bounds = (id, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const tp = topicOf.get(id);
    if (!tp) return byId.has(id) ? [byId.get(id)] : [];
    return tp.children.flatMap((c) => bounds(c.id, seen));
  };
  for (const tp of topics) {
    const visual = byId.get(tp.children.find((c) => c.role === "visual")?.id);
    const all = bounds(tp.id).filter((o) => !o.hidden);
    if (!all.length) continue;
    const rect = (parts) => {
      const x0 = Math.min(...parts.map((o) => o.x));
      const y0 = Math.min(...parts.map((o) => o.y));
      return { x: x0, y: y0, w: Math.max(...parts.map((o) => o.x + o.w)) - x0, h: Math.max(...parts.map((o) => o.y + o.h)) - y0 };
    };
    // Die Kamera zielt auf die Form; „drinnen“ ist man im ganzen Bereich aller Kinder (zone, relativ zum Rahmen,
    // damit sie beim Verschieben mitwandert).
    const f = rect(visual ? [visual] : all);
    const z = rect(all);
    add({ id: tp.id, type: "frame", title: "", hidden: true, ...f, zone: { x: z.x - f.x, y: z.y - f.y, w: z.w, h: z.h } });
    for (const c of tp.children) {
      own(c.id, tp.id);
      const o = byId.get(c.id);
      if (!o || topicOf.has(c.id)) continue;
      if (c.role === "cover") o.cover = tp.id;
      if (c.role === "content") o.inside = tp.id;
    }
  }
  // Unterkapitel im Inhalt eines Kapitels sind von außen ebenfalls verborgen (ihre Form und ihr Cover).
  for (const tp of topics) {
    for (const c of tp.children.filter((c) => c.role === "content" && topicOf.has(c.id))) {
      for (const g of topicOf.get(c.id).children) {
        const o = byId.get(g.id);
        if (o && (g.role === "visual" || g.role === "cover")) o.inside ??= tp.id;
      }
    }
  }
  for (const g of groups) for (const c of g.children) if (byId.has(c)) byId.get(c).group = g.id;

  // Rahmenzugehörigkeit: nennen mehrere Rahmen ein Objekt, gilt der kleinste.
  for (const o of objects) {
    const owners = (childOf.get(o.id) ?? []).map((f) => byId.get(f)).filter((f) => f && f !== o);
    owners.sort((a, b) => a.w * a.h - b.w * b.h);
    if (owners[0]) o.frame = owners[0].id;
  }
  // Rahmentitel: der erste Titeltext (sonst irgendein Text), der darin liegt.
  let n = 0;
  const within = (o, f) => o.x + o.w / 2 > f.x && o.x + o.w / 2 < f.x + f.w && o.y + o.h / 2 > f.y && o.y + o.h / 2 < f.y + f.h;
  for (const f of objects.filter((o) => o.type === "frame")) {
    const texts = objects.filter((o) => o.type === "text" && within(o, f));
    const named = texts.find((o) => o.role === "title") ?? texts.find((o) => o.role === "subtitle") ?? texts[0];
    f.title = named?.text.replace(/^[\s•]+/, "").split("\n")[0].slice(0, 60) || `Rahmen ${++n}`;
  }

  // Überblick: alles Sichtbare im Seitenverhältnis der Präsentation, mit etwas Rand.
  const [aw, ah] = val(root, "aspectRatio")?.split(":").map(Number) ?? [16, 9];
  const vis = objects.filter((o) => !o.hidden);
  if (!vis.length) throw new Error("In dieser Prezi wurden keine Objekte gefunden.");
  let x0 = Math.min(...vis.map((o) => o.x));
  let y0 = Math.min(...vis.map((o) => o.y));
  let x1 = Math.max(...vis.map((o) => o.x + o.w));
  let y1 = Math.max(...vis.map((o) => o.y + o.h));
  const grow = (x1 - x0) / (y1 - y0) > aw / ah ? [0, ((x1 - x0) * ah) / aw - (y1 - y0)] : [((y1 - y0) * aw) / ah - (x1 - x0), 0];
  x0 -= grow[0] / 2;
  x1 += grow[0] / 2;
  y0 -= grow[1] / 2;
  y1 += grow[1] / 2;
  const pad = (x1 - x0) * 0.04;
  const overview = { id: "f-overview", type: "frame", hidden: true, title: "Überblick", x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };

  // Pfad: Schritte (flyTo…) und darin verschachtelte Aktionen (zoomTo…, Einblendungen); Start im Überblick.
  const path = ["f-overview"];
  const step = (action) => {
    const kind = kindOf(action);
    const targets = refs(kids(action).find((c) => c.localName === "target" || (c.localName === "xField" && /^targets?$/.test(c.getAttribute("name")))) ?? null).filter((r) => byId.has(r));
    if (kind === "flyToOverview" || kind === "zoomToOverview") path.push("f-overview");
    else if (kind === "flyToObject" || kind === "zoomToObject") {
      if (targets[0]) path.push(targets[0]);
      else skipped.add("Pfadschritte zu nicht übernommenen Objekten");
    } else if (/^fade(In|Out)Objects?$/.test(kind)) {
      if (targets.length) path.push({ type: kind.startsWith("fadeIn") ? "fade-in" : "fade-out", targets });
    } else skipped.add(`Pfadschritte vom Typ ${kind}`);
    for (const sub of kids(field(action, "actions"))) step(sub);
  };
  for (const s of kids(field(root, "path"))) step(s);
  const cleanPath = path.filter((p, i) => typeof p !== "string" || p !== path[i - 1]);
  // Pfadziele, die keine Rahmen sind (Kreise, Bilder), heißen in der Pfadliste nach dem Text darin.
  for (const id of new Set(cleanPath.filter((p) => typeof p === "string"))) {
    const o = byId.get(id);
    if (!o || o.type === "frame" || o.type === "text" || o.title) continue;
    const t = objects.find((x) => x.type === "text" && x !== o && within(x, o));
    if (t) o.title = t.text.replace(/^[\s•]+/, "").split("\n")[0].slice(0, 60);
  }

  // Hintergrund: Farbe aus dem Stil, Bild aus der ersten Hintergrundebene (in Prezi mit Tiefenwirkung → Parallaxe).
  const bgStyle = styles.get("background") ?? {};
  if (bgStyle.fillType && bgStyle.fillType !== "solid" && bgStyle.gradStartColor !== bgStyle.gradEndColor) skipped.add("Hintergrundverlauf (als Vollfarbe)");
  let background;
  for (const layer of kids(field(field(root, "background"), "layers"))) {
    if (background) break;
    if (layer.localName === "backgroundSwfGraphics") {
      const file = swfFile(layer, false);
      const svg = file && (await swfToSvg(files.get(file).data).catch(() => null));
      if (!svg) continue;
      media.push({ name: "media/background.svg", data: btoa(svg) });
      background = { src: "media/background.svg", fit: "cover", parallax: true };
      continue;
    }
    const file = assetFile(layer);
    if (!file) continue;
    const src = `media/background.${file.split(".").pop().toLowerCase()}`;
    media.push({ name: src, data: files.get(file).data });
    background = { src, fit: "cover", parallax: true };
  }

  // Classic nennt die Klassen head/strong statt title/subtitle.
  const fontOf = (c) => classFont[c] ?? classFont[{ title: "head", subtitle: "strong" }[c]] ?? {};
  const fontFor = (c) => fontOf(c).family ?? "sans";
  return {
    doc: {
      format: "weitblick",
      version: 2,
      title,
      aspect: `${aw}:${ah}`,
      theme: {
        ...baseTheme,
        id: "prezi",
        background: fillOf(bgStyle) ?? baseTheme.background,
        text: textColor,
        accent: textColor,
        fonts: { title: fontFor("title"), subtitle: fontFor("subtitle"), body: fontFor("body") },
        bold: { title: !!fontOf("title").bold, subtitle: !!fontOf("subtitle").bold, body: !!fontOf("body").bold },
      },
      ...(background ? { background } : {}),
      fonts,
      objects: [overview, ...objects],
      path: cleanPath,
    },
    media,
    skipped: [...skipped],
    count: objects.length,
    steps: cleanPath.length,
  };
}
