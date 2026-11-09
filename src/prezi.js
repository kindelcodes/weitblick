// Import einer Offline-Prezi („Portable Prezi“ als .zip). contents.portable/prezi.xml beschreibt die ganze
// Leinwand: Objekte mit Mittelpunkt, Maßstab und Drehung, Rahmen mit ihrem Inhalt, Stile, Schriften und den Pfad.

const parseXml = (t) => new DOMParser().parseFromString(t, "application/xml");
const kids = (el) => [...(el?.children ?? [])];

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
const refs = (el) => [...el.getElementsByTagName("*")].filter((e) => e.localName === "ref" || e.localName === "xRef").map((e) => e.getAttribute("value"));

// Prezi-Schriften (.keg) sind OpenType/TrueType mit einem kurzen Vorspann davor.
function stripKeg(b64) {
  const bin = atob(b64);
  const head = bin.slice(0, 256);
  const at = ["OTTO", "\0\x01\0\0", "wOFF", "wOF2", "true"].map((m) => head.indexOf(m)).filter((i) => i >= 0);
  if (!at.length) return null;
  const start = Math.min(...at);
  return { data: btoa(bin.slice(start)), ext: bin.startsWith("OTTO", start) ? "otf" : bin.startsWith("wOF2", start) ? "woff2" : bin.startsWith("wOFF", start) ? "woff" : "ttf" };
}

export function importPrezi(entries, title, baseTheme) {
  const xmlEntry = entries.find((e) => e.name.endsWith("contents.portable/prezi.xml"));
  if (!xmlEntry?.text) throw new Error("Das ist keine Offline-Prezi: contents.portable/prezi.xml fehlt im Archiv.");
  const base = xmlEntry.name.slice(0, -"prezi.xml".length);
  const files = new Map(entries.map((e) => [e.name.slice(base.length), e]));
  const root = parseXml(xmlEntry.text).documentElement;
  if (root.localName !== "prezi") throw new Error("prezi.xml lässt sich nicht lesen.");
  if (root.getAttribute("version") !== "2") throw new Error(`Prezi-Format Version ${root.getAttribute("version")} wird noch nicht unterstützt.`);

  // Stile: Selektor („zRichText.title“, „*.poly2“, „#ID“, „background“) → Eigenschaften.
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
    styles.set(sel, { ...styles.get(sel), ...props });
  }
  const styleOf = (kind, classes, id) =>
    Object.assign({}, ...classes.flatMap((c) => [styles.get(`*.${c}`), styles.get(`${kind}.${c}`)]), styles.get(`#${id}`));

  // Schriften: Klasse (title, body_2 …) → Familie; Familien mit ihren Schnitten werden eingebettet.
  const classFont = {};
  for (const fc of root.getElementsByTagName("fontClass")) {
    classFont[val(fc, "name")] = { family: val(fc, "fontFamily"), bold: val(fc, "fontWeight") === "bold" };
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

  const objects = [];
  const byId = new Map();
  const childOf = new Map(); // Objekt-id → Liste der Rahmen, die es als Inhalt nennen
  const textColor = styles.get("zRichText.title")?.color ?? baseTheme.text;
  const zObjects = kids(field(root, "zObjects"));

  for (const el of zObjects) {
    const kind = kindOf(el);
    const id = val(el, "id");
    const t = field(el, "localToWorld");
    if (!id || !t) continue;
    const s = +t.getAttribute("scale");
    const cx = +t.getAttribute("x");
    const cy = +t.getAttribute("y");
    const rot = Math.round((+t.getAttribute("rotation") * 180) / Math.PI);
    // Prezi legt Objekte über ihren Mittelpunkt; Breite und Höhe sind lokal und werden mit dem Maßstab multipliziert.
    const box = (w, h) => ({ x: cx - (w * s) / 2, y: cy - (h * s) / 2, w: w * s, h: h * s, ...(rot % 360 ? { rot } : {}) });
    const classes = kids(field(el, "styleClasses")).map((c) => c.getAttribute("value"));
    const st = styleOf(kind, classes, id);
    const add = (o) => {
      objects.push(o);
      byId.set(o.id, o);
    };

    if (kind === "zSmartObject") {
      const desc = field(el, "description");
      if (desc?.getAttribute("name") !== "frame") {
        skipped.add(`Prezi-Objekte vom Typ ${desc?.getAttribute("name") ?? "unbekannt"}`);
        continue;
      }
      const content = refs(field(desc, "contentChildren") ?? desc);
      for (const c of content) childOf.set(c, [...(childOf.get(c) ?? []), id]);
      // Rahmen ohne Inhalt sind in Prezi reine Zoom-Ziele: in Weitblick versteckte Rahmen.
      add({ id, type: "frame", title: "", ...box(num(el, "width"), num(el, "height")), ...(content.length ? {} : { hidden: true }) });
    } else if (kind === "zShape") {
      const type = val(el, "shapeType");
      const shape = { rectangle: "rect", oval: "ellipse" }[type];
      if (!shape) skipped.add(`Formen vom Typ ${type}`);
      // Linearer Verlauf: in Prezi von oben (gradStart) nach unten (gradEnd), meist dieselbe Farbe mit abnehmender Deckkraft.
      const linear = st.fillType === "linear";
      if (st.fillType && !["solid", "linear"].includes(st.fillType)) skipped.add("Farbverläufe in Formen (als Vollfarbe)");
      const alpha = parseFloat(st.alpha ?? "1");
      add({
        id,
        type: "shape",
        shape: shape ?? "rect",
        fill: (linear ? st.gradStartColor : st.color) ?? "#808080",
        ...box(num(el, "width"), num(el, "height")),
        ...(linear ? { fade: [parseFloat(st.gradStartAlpha ?? "1"), parseFloat(st.gradEndAlpha ?? "0")] } : {}),
        ...(alpha < 1 ? { opacity: alpha } : {}),
      });
    } else if (kind === "zImage") {
      // Die Bilddateien heißen nach der Online- oder der Offline-Kennung, gefolgt von „-Prüfsumme“.
      const assets = [val(el, "offlineAssetId"), val(el, "onlineAssetId")].filter(Boolean);
      const file = [...files.keys()].find((n) => assets.some((a) => n.startsWith(`images/${a}-`) || n.startsWith(`images/${a}.`)));
      if (!file) {
        skipped.add("Bilder, die nicht im Archiv liegen");
        continue;
      }
      const src = `media/${id}.${file.split(".").pop().toLowerCase()}`;
      media.push({ name: src, data: files.get(file).data });
      const W = num(el, "width");
      const H = num(el, "height");
      // Zuschnitt (mask, in Bildpixeln): nur der Ausschnitt ist sichtbar, sein Mittelpunkt liegt neben der Bildmitte.
      const m = field(el, "mask");
      const [mx, my, mw, mh] = m ? ["x", "y", "w", "h"].map((a) => +m.getAttribute(a)) : [0, 0, W, H];
      const a = (rot * Math.PI) / 180;
      const dx = (mx + mw / 2 - W / 2) * s;
      const dy = (my + mh / 2 - H / 2) * s;
      const r = box(mw, mh);
      r.x += dx * Math.cos(a) - dy * Math.sin(a);
      r.y += dx * Math.sin(a) + dy * Math.cos(a);
      add({ id, type: "image", src, ...r, ...(m ? { crop: { x: mx / W, y: my / H, w: mw / W, h: mh / H } } : {}) });
    } else if (kind === "zPdf") {
      // Liegt offline nur als Flash-Datei bei: ein Symbol hält den Platz frei.
      skipped.add("eingebettete PDF-Dateien (als Platzhalter-Symbol)");
      add({ id, type: "icon", name: "file-text", color: textColor, ...box(num(el, "width"), num(el, "height")) });
    } else if (kind === "zRichText") {
      const rec = field(el, "text");
      const width = num(rec, "width", -1);
      if (width <= 0) continue; // leerer Platzhaltertext ohne Breite
      let size = 0;
      let bold = false;
      let align = null;
      const lines = kids(field(rec, "paragraphs")).map((p) => {
        align ??= val(field(p, "paragraphStyle"), "alignment");
        return kids(field(p, "spans"))
          .map((span) => {
            const ss = field(span, "style");
            size ||= num(ss, "fontSize");
            bold ||= val(ss, "fontWeight") === "bold";
            return val(span, "text") ?? "";
          })
          .join("");
      });
      const text = lines.join("\n");
      if (!text.trim()) continue;
      // Autofit: „wrap“ ist die natürliche Zeilenbreite bei fontSize. Ist sie breiter als das Feld („width“),
      // verkleinert Prezi die Schrift entsprechend; „height“ ist die Feldhöhe.
      const fit = field(rec, "autofit");
      size = (size || 20) * Math.min(1, width / num(fit, "wrap", width));
      const h = num(fit, "height", size * 1.3 * lines.length);
      const cls = classes.find((c) => classFont[c]) ?? "body";
      const role = cls.replace(/_\d+$/, "");
      const r = box(width, h);
      if (st.displayBackground === "true") {
        const pad = parseFloat(st.backgroundPadding ?? "0") * s;
        add({ id: `${id}-bg`, type: "shape", shape: "rect", fill: st.backgroundColor ?? "#666666", x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad, ...(r.rot ? { rot: r.rot } : {}) });
        childOf.set(`${id}-bg`, childOf.get(id) ?? []);
      }
      // Kein „fit“: Größe und Umbruch stimmen schon; Weitblicks etwas höhere Zeilen dürfen das Feld unten überragen.
      add({
        id,
        type: "text",
        text,
        size: size * s,
        color: st.color ?? textColor,
        align: align ?? "left",
        role: ["title", "subtitle", "body"].includes(role) ? role : "body",
        ...(cls !== role ? { font: classFont[cls].family } : {}),
        ...(bold || (cls !== role && classFont[cls].bold) ? { weight: 700 } : {}),
        ...r,
      });
    } else {
      skipped.add(`Prezi-Objekte vom Typ ${kind}`);
    }
  }

  // Rahmenzugehörigkeit: nennen mehrere Rahmen ein Objekt, gilt der kleinste.
  for (const o of objects) {
    const owners = (childOf.get(o.id) ?? []).map((f) => byId.get(f)).filter(Boolean);
    owners.sort((a, b) => a.w * a.h - b.w * b.h);
    if (owners[0]) o.frame = owners[0].id;
  }
  // Rahmentitel: der erste Titeltext, der darin liegt.
  let n = 0;
  for (const f of objects.filter((o) => o.type === "frame")) {
    const inside = objects.find((o) => o.role === "title" && o.x + o.w / 2 > f.x && o.x + o.w / 2 < f.x + f.w && o.y + o.h / 2 > f.y && o.y + o.h / 2 < f.y + f.h);
    f.title = inside?.text.split("\n")[0].slice(0, 60) || `Rahmen ${++n}`;
  }

  // Überblick: alles Sichtbare im Seitenverhältnis der Präsentation, mit etwas Rand.
  const [aw, ah] = val(root, "aspectRatio")?.split(":").map(Number) ?? [16, 9];
  const vis = objects.filter((o) => !o.hidden);
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

  // Pfad: Zoom-Schritte auf Objekte und Einblendungen; Prezi beginnt immer im Überblick.
  const path = ["f-overview"];
  for (const step of kids(field(root, "path"))) {
    for (const action of kids(field(step, "actions"))) {
      const kind = kindOf(action);
      const targets = refs(action).filter((r) => byId.has(r));
      if (kind === "zoomToOverview") path.push("f-overview");
      else if (kind === "zoomToObject" && targets[0]) path.push(targets[0]);
      else if (/^fade(In|Out)Objects?$/.test(kind) && targets.length) path.push({ type: kind.startsWith("fadeIn") ? "fade-in" : "fade-out", targets });
      else skipped.add(`Pfadschritte vom Typ ${kind}`);
    }
  }

  const bg = styles.get("background") ?? {};
  if (bg.fillType && bg.fillType !== "solid") skipped.add("Hintergrundverlauf (als Vollfarbe)");
  const fontFor = (c) => classFont[c]?.family ?? "sans";
  return {
    doc: {
      format: "weitblick",
      version: 2,
      title,
      aspect: `${aw}:${ah}`,
      theme: {
        ...baseTheme,
        id: "prezi",
        background: bg.color ?? baseTheme.background,
        text: textColor,
        accent: textColor,
        fonts: { title: fontFor("title"), subtitle: fontFor("subtitle"), body: fontFor("body") },
        bold: { title: !!classFont.title?.bold, subtitle: !!classFont.subtitle?.bold, body: !!classFont.body?.bold },
      },
      fonts,
      objects: [overview, ...objects],
      path,
    },
    media,
    skipped: [...skipped],
    count: objects.length,
    steps: path.length,
  };
}
