import { Camera, fitRect } from "./camera.js";
import { demo } from "./demo.js";
import { SHAPES, shapeSvg } from "./shapes.js";
import { DIAGRAMS } from "./diagrams.js";
import { ICON_NODES, ICON_TAGS } from "./vendor/lucide.js";

const ZOOM_STEP = 1.25;
const MIN_W = 20; // stärkster Zoom: 20 Leinwand-Einheiten sichtbar
const MAX_W = 200000;
const FRAME_GRAB_PX = 10; // Rahmen lassen sich nur an ihrer Kante greifen

const viewport = document.getElementById("viewport");
const world = document.getElementById("world");
const pathList = document.getElementById("path-list");
const zoomLabel = document.getElementById("zoom-label");

let doc = structuredClone(demo);
let currentPath = null;
let byId = new Map();
let pathIndex = 0;
let offPath = false; // beim Präsentieren frei zu einem Objekt geflogen
let presenting = false;
let selected = null; // zuletzt gewähltes Objekt: Formatleiste und Anfasser beziehen sich darauf
let selection = []; // alle ausgewählten Objekte
let nextId = 1;

// ---------- Rückgängig und Wiederholen ----------
// Vor jeder Änderung wird der Stand von Objekten und Pfad als Text gemerkt.

const HISTORY_LIMIT = 100;
let undoStack = [];
let redoStack = [];
let savedSnapshot = null;

function snapshot() {
  return JSON.stringify({ objects: doc.objects, path: doc.path });
}

function checkpoint(before = snapshot()) {
  undoStack.push(before);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  showFileName();
}

function restore(snap) {
  const s = JSON.parse(snap);
  doc.objects = s.objects;
  doc.path = s.path;
  selection = [];
  selected = null;
  pathIndex = Math.min(pathIndex, doc.path.length - 1);
  buildWorld();
  buildPathList();
  updateToolbar();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}

function isDirty() {
  return snapshot() !== savedSnapshot;
}

function markSaved() {
  savedSnapshot = snapshot();
  showFileName();
}

// ---------- Medien ----------
// Bilder liegen im Speicher als Base64 (für die Datei) und als Blob-Adresse (für die Anzeige).

const media = new Map();
const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

function extOf(name) {
  return name.split(".").pop().toLowerCase();
}

function addMedia(name, data) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[extOf(name)] ?? "application/octet-stream" }));
  media.set(name, { data, url });
}

function clearMedia() {
  for (const m of media.values()) URL.revokeObjectURL(m.url);
  media.clear();
}

function imageSize(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 4, h: 3 });
    img.src = url;
  });
}

// Bilder von der Festplatte einfügen, um einen Punkt der Leinwand herum (sonst in der Bildmitte).
async function insertImages(paths, at) {
  const files = paths.filter((p) => MIME[extOf(p)]);
  if (!files.length) return;
  checkpoint();
  const placed = [];
  for (const path of files) {
    const file = await tauri.core.invoke("import_media", { path });
    placed.push(await placeImage(extOf(file.name), file.data, at, placed.length));
  }
  setSelection(placed);
}

// Ein Bild (Base64) auf die Leinwand legen. Der Aufrufer legt vorher den Rückgängig-Punkt an.
async function placeImage(ext, data, at = null, index = 0) {
  const id = newId("i");
  const src = `media/${id}.${ext}`;
  addMedia(src, data);
  const size = await imageSize(media.get(src).url);
  const w = camera.w * 0.35;
  const h = (w * size.h) / size.w;
  const c = at ?? { x: camera.cx, y: camera.cy };
  const offset = camera.w * 0.03 * index;
  const o = { id, type: "image", src, x: c.x - w / 2 + offset, y: c.y - h / 2 + offset, w, h };
  doc.objects.push(o);
  byId.set(id, o);
  world.append(makeEl(o));
  select(o);
  return o;
}

async function chooseImages() {
  const paths = await tauri.dialog.open({
    multiple: true,
    filters: [{ name: "Bilder", extensions: Object.keys(MIME) }],
  });
  if (paths) await insertImages([].concat(paths));
}

const camera = new Camera(render);

// ---------- Darstellung ----------

function makeEl(o) {
  const el = document.createElement("div");
  el.className = `obj ${o.type}`;
  el.dataset.id = o.id;
  if (o.type === "frame" && o.hidden) el.classList.add("hidden-frame");
  if (o.type === "shape") el.classList.add(o.shape);
  if (o.type === "icon") el.innerHTML = iconSvg(o.name);
  if (o.type === "text") el.addEventListener("blur", () => finishEditing(el));
  updateEl(o, el);
  return el;
}

function updateEl(o, el = elOf(o)) {
  Object.assign(el.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` });
  if (o.type === "shape") {
    const svg = shapeSvg(o.shape, o.fill, o.points);
    el.style.background = svg ? "" : o.fill;
    el.querySelector(".shape-svg")?.remove();
    if (svg) el.insertAdjacentHTML("afterbegin", svg);
  }
  if (o.type === "icon") el.style.color = o.color || doc.theme.text;
  if (o.type === "frame") el.style.background = o.fill || "";
  if (o.type === "image") {
    const m = media.get(o.src);
    el.style.backgroundImage = m ? `url("${m.url}")` : "";
    el.classList.toggle("missing", !m);
  }
  if (o.type === "text") {
    if (!el.isContentEditable) el.textContent = o.text;
    Object.assign(el.style, {
      fontSize: `${o.size}px`,
      color: o.color || doc.theme.text,
      textAlign: o.align || "left",
      fontWeight: o.weight || 400,
      fontStyle: o.italic ? "italic" : "normal",
      fontFamily: fontStack(o.font),
    });
  }
  el.style.transform = o.rot ? `rotate(${o.rot}deg)` : "";
  el.classList.toggle("selected", selection.includes(o));
  el.querySelectorAll(".handle, .rot-handle").forEach((h) => h.remove());
  // Anfasser nur bei genau einem ausgewählten Objekt.
  if (o === selected && selection.length === 1) {
    for (const cls of ["handle", "rot-handle"]) {
      const h = document.createElement("div");
      h.className = cls;
      el.append(h);
    }
  }
}

function elOf(o) {
  return world.querySelector(`[data-id="${o.id}"]`);
}

function buildWorld() {
  byId = new Map(doc.objects.map((o) => [o.id, o]));
  world.replaceChildren(...doc.objects.map(makeEl));
  showFileName();
  document.body.style.setProperty("--bg", doc.theme.background);
}

function zoom() {
  return viewport.clientWidth / camera.w;
}

function render() {
  const z = zoom();
  const tx = viewport.clientWidth / 2 - camera.cx * z;
  const ty = viewport.clientHeight / 2 - camera.cy * z;
  world.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
  world.style.setProperty("--inv", 1 / z); // für Auswahlrand und Anfasser in Bildschirmgröße
  // Punktraster wandert mit, damit sich Bewegung auch auf leerer Fläche zeigt.
  const grid = 40 * z;
  const size = grid < 12 ? grid * Math.ceil(12 / grid) : grid;
  viewport.style.backgroundSize = `${size}px ${size}px`;
  viewport.style.backgroundPosition = `${tx}px ${ty}px`;
  zoomLabel.textContent = `${Math.round(z * 100)} %`;
}

function screenToWorld(sx, sy) {
  const z = zoom();
  return {
    x: camera.cx + (sx - viewport.clientWidth / 2) / z,
    y: camera.cy + (sy - viewport.clientHeight / 2) / z,
  };
}

function eventToWorld(e) {
  const r = viewport.getBoundingClientRect();
  return screenToWorld(e.clientX - r.left, e.clientY - r.top);
}

// ---------- Pfad ----------

function buildPathList() {
  pathList.replaceChildren();
  doc.path.forEach((id, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="num"></span><span class="label"></span><button class="remove" title="Aus dem Pfad entfernen">×</button>`;
    li.querySelector(".num").textContent = id === doc.path[0] ? "⌂" : i;
    li.querySelector(".label").textContent = isAnim(id) ? animLabel(id) : (stepLabel(byId.get(id)) ?? id);
    li.classList.toggle("anim", isAnim(id));
    li.addEventListener("click", (e) => {
      if (pathDrag?.moved || e.target.isContentEditable) return;
      goTo(i);
      // Im Editor zeigt ein Klick auf einen Animationsschritt, welche Objekte er betrifft.
      if (isAnim(id) && !presenting) setSelection(id.targets.map((t) => byId.get(t)).filter(Boolean));
    });
    // Am Eintrag lauschen, nicht am Namen: die Zeigererfassung fürs Ziehen lenkt den Doppelklick auf den Eintrag um.
    li.addEventListener("dblclick", () => renameStep(li.querySelector(".label"), id));
    const remove = li.querySelector(".remove");
    if (i === 0) remove.remove();
    else li.addEventListener("pointerdown", (e) => startPathDrag(e, i));
    if (i !== 0)
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        checkpoint();
        doc.path.splice(i, 1);
        if (pathIndex >= doc.path.length) pathIndex = doc.path.length - 1;
        buildPathList();
      });
    pathList.append(li);
  });
  markActive();
}

function stepLabel(o) {
  if (!o) return null;
  if (o.title) return o.title;
  if (o.type === "text") return o.text.split("\n")[0].slice(0, 40) || "Text";
  return { image: "Bild", shape: "Form" }[o.type];
}

// ---------- Pfad umsortieren per Ziehen ----------
// Eigene Zeigerlogik statt HTML-Drag-and-drop: Tauri fängt unter Windows
// Drag-and-drop für Dateien ab, dann kommen die HTML-Ereignisse nicht an.

let pathDrag = null;

// Doppelklick auf einen Eintrag: Namen direkt in der Liste ändern, Enter oder Klick daneben übernimmt.
function renameStep(label, id) {
  const o = byId.get(id);
  if (!o) return;
  label.contentEditable = "plaintext-only";
  label.focus();
  document.getSelection().selectAllChildren(label);
  label.addEventListener(
    "blur",
    () => {
      label.contentEditable = "false";
      const title = label.textContent.trim();
      if (title && title !== stepLabel(o)) {
        checkpoint();
        o.title = title;
      }
      buildPathList();
    },
    { once: true },
  );
}

function startPathDrag(e, from) {
  if (e.button !== 0 || e.target.closest(".remove") || e.target.isContentEditable) return;
  pathDrag = { from, y: e.clientY, moved: false, to: from, li: e.currentTarget };
  e.currentTarget.setPointerCapture(e.pointerId);
}

// Einfügeposition: vor welchem Eintrag landet der gezogene? Nie vor dem Überblick.
function dropIndex(clientY) {
  const items = [...pathList.children];
  for (let k = 1; k < items.length; k++) {
    const r = items[k].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return k;
  }
  return items.length;
}

pathList.addEventListener("pointermove", (e) => {
  if (!pathDrag) return;
  if (!pathDrag.moved && Math.abs(e.clientY - pathDrag.y) < 5) return;
  pathDrag.moved = true;
  pathDrag.li.classList.add("dragging");
  pathDrag.to = dropIndex(e.clientY);
  const items = [...pathList.children];
  items.forEach((li, k) => {
    li.classList.toggle("drop-before", k === pathDrag.to);
    li.classList.toggle("drop-after", pathDrag.to === items.length && k === items.length - 1);
  });
});

pathList.addEventListener("pointerup", () => {
  const d = pathDrag;
  if (!d) return;
  // Der Klick nach dem Loslassen soll nicht zum Eintrag fliegen; danach zurücksetzen.
  setTimeout(() => (pathDrag = null));
  if (!d.moved) return;
  let to = d.to > d.from ? d.to - 1 : d.to;
  if (to === d.from) return buildPathList();
  checkpoint();
  // Den aktiven Eintrag mitverfolgen, damit die Markierung bei ihm bleibt.
  const order = doc.path.map((_, k) => k);
  const [id] = doc.path.splice(d.from, 1);
  const [k] = order.splice(d.from, 1);
  doc.path.splice(to, 0, id);
  order.splice(to, 0, k);
  pathIndex = order.indexOf(pathIndex);
  buildPathList();
});

// Ausgewähltes Objekt als weiteren Schritt in den Pfad aufnehmen (auch mehrmals).
function addSelectedToPath() {
  if (!selected) return;
  checkpoint();
  addToPath(selected.id);
}

function markActive() {
  [...pathList.children].forEach((li, i) => li.classList.toggle("active", i === pathIndex));
}

function frameState(id) {
  return fitRect(byId.get(id), viewport.clientWidth, viewport.clientHeight);
}

function goTo(i) {
  pathIndex = Math.max(0, Math.min(doc.path.length - 1, i));
  offPath = false;
  markActive();
  updateProgress();
  if (presenting) applyVisibility(pathIndex);
  camera.flyTo(stepCamera(pathIndex));
}

// ---------- Animationsschritte ----------
// Ein Pfadeintrag ist entweder die id eines Objekts (Kamerafahrt dorthin) oder ein
// Animationsschritt { type: "fade-in" | "fade-out", targets: [ids] }. Bei einem
// Animationsschritt bleibt die Kamera, wo sie ist, und die Objekte werden ein- oder ausgeblendet.

function isAnim(step) {
  return typeof step === "object" && step !== null;
}

function animLabel(step) {
  const names = step.targets.map((t) => stepLabel(byId.get(t)) ?? t).join(", ");
  return `${step.type === "fade-in" ? "Einblenden" : "Ausblenden"}: ${names}`;
}

// Die Kamera eines Schritts ist die des letzten Kamera-Schritts davor (oder er selbst).
function stepCamera(i) {
  let k = i;
  while (k > 0 && isAnim(doc.path[k])) k--;
  return frameState(doc.path[k]);
}

// Welche Objekte sind bei Schritt i unsichtbar? Wer irgendwo eingeblendet wird, ist anfangs versteckt.
function hiddenAt(i) {
  const hidden = new Set();
  for (const s of doc.path) if (isAnim(s) && s.type === "fade-in") s.targets.forEach((t) => hidden.add(t));
  for (let k = 0; k <= i; k++) {
    const s = doc.path[k];
    if (!isAnim(s)) continue;
    for (const t of s.targets) s.type === "fade-in" ? hidden.delete(t) : hidden.add(t);
  }
  return hidden;
}

function applyVisibility(i) {
  const hidden = presenting ? hiddenAt(i) : new Set();
  for (const el of world.children) el.classList.toggle("anim-hidden", hidden.has(el.dataset.id));
}

// Animationsschritt für die Auswahl direkt hinter dem aktuellen Schritt einfügen,
// so ergeben mehrere Klicks nacheinander die richtige Reihenfolge.
function addAnimation(type) {
  const targets = selection.filter((o) => !o.hidden).map((o) => o.id);
  if (!targets.length) return;
  checkpoint();
  doc.path.splice(pathIndex + 1, 0, { type, targets });
  pathIndex += 1;
  buildPathList();
}

// Weiter/zurück. Wer beim Präsentieren frei unterwegs war, kommt mit „zurück“ erst zum aktuellen Schritt.
function step(dir) {
  goTo(offPath && dir < 0 ? pathIndex : pathIndex + dir);
}

// Neuer Rahmen kommt ans Ende des Pfads, aber vor einen abschließenden Überblick.
function addToPath(id) {
  const endsWithOverview = doc.path.length > 1 && doc.path.at(-1) === doc.path[0];
  doc.path.splice(endsWithOverview ? doc.path.length - 1 : doc.path.length, 0, id);
  buildPathList();
}

// ---------- Auswahl und Bearbeiten ----------

// Mit additive (Umschalt) wird ein Objekt zur Auswahl hinzugefügt oder wieder entfernt.
function select(o, additive = false) {
  if (!o) setSelection([]);
  else if (!additive) setSelection([o]);
  else setSelection(selection.includes(o) ? selection.filter((p) => p !== o) : [...selection, o]);
}

function setSelection(list) {
  const prev = selection;
  selection = list;
  selected = list.at(-1) ?? null;
  for (const p of new Set([...prev, ...list])) if (byId.has(p.id)) updateEl(p);
  updateToolbar();
}

function selectAll() {
  setSelection(doc.objects.filter((o) => !o.hidden));
}

// Rahmen nehmen alles mit, was ganz in ihnen liegt (beim Verschieben und Kopieren).
function withContents(list) {
  const result = new Set(list);
  for (const f of list) {
    if (f.type !== "frame") continue;
    for (const p of doc.objects) if (p !== f && !p.hidden && inside(p, f)) result.add(p);
  }
  // In der Reihenfolge der Leinwand, damit Ebenen beim Kopieren erhalten bleiben.
  return doc.objects.filter((o) => result.has(o));
}

function updateToolbar() {
  const isText = selected?.type === "text";
  const colored = colorKey(selected) !== null;
  document.querySelectorAll("[data-needs]").forEach((b) => {
    const need = b.dataset.needs;
    b.disabled = !selected || (need === "text" && !isText) || (need === "color" && !colored);
  });
  // Formatleiste zeigt den Zustand des ausgewählten Objekts.
  formatbar.classList.toggle("visible", !!selected && !presenting);
  if (!selected) return;
  if (colored) colorInput.value = toHex(selected[colorKey(selected)] ?? defaultColor(selected));
  if (isText) {
    ensureFontOption(selected.font ?? "sans");
    fontSelect.value = selected.font ?? "sans";
    document.getElementById("btn-bold").classList.toggle("on", (selected.weight ?? 400) >= 600);
    document.getElementById("btn-italic").classList.toggle("on", !!selected.italic);
    document.getElementById("btn-align").textContent = ALIGN_ICONS[selected.align ?? "left"];
  }
}

// ---------- Farben und Textformat ----------

const FONTS = {
  sans: '"Segoe UI", "Noto Sans", "DejaVu Sans", sans-serif',
  serif: 'Georgia, "Noto Serif", "DejaVu Serif", serif',
  mono: 'Consolas, "DejaVu Sans Mono", monospace',
};
const ALIGNS = ["left", "center", "right"];
const ALIGN_ICONS = { left: "⇤", center: "⇔", right: "⇥" };

const formatbar = document.getElementById("formatbar");
const colorInput = document.getElementById("inp-color");
const fontSelect = document.getElementById("sel-font");

// Welches Feld eines Objekts die Farbe trägt.
function colorKey(o) {
  return { text: "color", icon: "color", shape: "fill", frame: "fill" }[o?.type] ?? null;
}

// Feste Namen (sans/serif/mono) oder der Name einer System- bzw. Google-Schrift.
function fontStack(font) {
  return FONTS[font] ?? `"${String(font).replace(/"/g, "")}", ${FONTS.sans}`;
}

function defaultColor(o) {
  if (o.type === "text" || o.type === "icon") return doc.theme.text;
  return o.type === "frame" ? doc.theme.background : doc.theme.accent;
}

// Farbwähler kennen nur #rrggbb.
function toHex(c) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + [...c.slice(1)].map((x) => x + x).join("");
  return "#ffffff";
}

// Eine Änderung an allen passenden ausgewählten Objekten, als ein Rückgängig-Schritt.
function format(change, applies = () => true) {
  const targets = selection.filter(applies);
  if (!targets.length) return;
  checkpoint();
  for (const o of targets) {
    change(o);
    updateEl(o);
  }
  updateToolbar();
}

const isText = (o) => o.type === "text";

// Beim Ziehen im Farbwähler live anzeigen, aber nur einen Rückgängig-Schritt anlegen.
let colorBefore = null;
colorInput.addEventListener("pointerdown", () => (colorBefore = snapshot()));
colorInput.addEventListener("input", () => {
  const targets = selection.filter((o) => colorKey(o));
  if (!targets.length) return;
  colorBefore ??= snapshot();
  for (const o of targets) {
    o[colorKey(o)] = colorInput.value;
    updateEl(o);
  }
});
colorInput.addEventListener("change", () => {
  if (colorBefore && colorBefore !== snapshot()) checkpoint(colorBefore);
  colorBefore = null;
});

fontSelect.addEventListener("change", () => format((o) => (o.font = fontSelect.value), isText));

// Der neue Zustand richtet sich nach dem zuletzt gewählten Text und gilt dann für alle.
function toggleBold() {
  if (selected?.type !== "text") return;
  const weight = (selected.weight ?? 400) >= 600 ? 400 : 700;
  format((o) => (o.weight = weight), isText);
}

function toggleItalic() {
  if (selected?.type !== "text") return;
  const italic = !selected.italic;
  format((o) => (o.italic = italic), isText);
}

function cycleAlign() {
  if (selected?.type !== "text") return;
  const align = ALIGNS[(ALIGNS.indexOf(selected.align ?? "left") + 1) % ALIGNS.length];
  format((o) => (o.align = align), isText);
}

function startEditing(o) {
  const el = elOf(o);
  el.querySelector(".handle")?.remove(); // sonst landet der Anfasser im Text
  el.contentEditable = "plaintext-only";
  el.focus();
  document.getSelection().selectAllChildren(el);
}

function finishEditing(el) {
  if (!el.isContentEditable) return;
  el.contentEditable = "false";
  const o = byId.get(el.dataset.id);
  if (!o) return;
  if (o.text !== el.innerText) {
    checkpoint();
    o.text = el.innerText;
  }
  updateEl(o, el);
}

function isEditing() {
  return document.activeElement?.isContentEditable;
}

function newId(prefix) {
  let id;
  do id = `${prefix}-${nextId++}`;
  while (byId.has(id));
  return id;
}

// Neues Objekt in der Mitte der aktuellen Ansicht, passend zur Zoomstufe.
function addObject(kind) {
  checkpoint();
  const vw = camera.w;
  const base = { x: 0, y: 0 };
  let o;
  if (kind === "text") {
    o = { ...base, id: newId("t"), type: "text", w: vw * 0.4, h: vw * 0.08, text: "Neuer Text", size: vw * 0.035 };
  } else if (kind === "frame") {
    o = { ...base, id: newId("f"), type: "frame", w: vw * 0.6, h: vw * 0.6 * (9 / 16), title: "Neuer Rahmen" };
  } else {
    const [sw, sh] = SHAPES.find((s) => s.id === kind)?.size ?? [1, 1];
    o = { ...base, id: newId("s"), type: "shape", shape: kind, w: vw * 0.2 * sw, h: vw * 0.2 * sh, fill: doc.theme.accent };
  }
  o.x = camera.cx - o.w / 2;
  o.y = camera.cy - o.h / 2;
  // Rahmen liegen hinter allem anderen, damit ihr Inhalt klickbar bleibt.
  if (o.type === "frame") doc.objects.splice(1, 0, o);
  else doc.objects.push(o);
  buildWorld();
  if (o.type === "frame") addToPath(o.id);
  select(o);
  if (o.type === "text") startEditing(o);
}

function deleteSelected() {
  const ids = new Set(selection.filter((o) => o.id !== doc.path[0]).map((o) => o.id));
  if (!ids.size) return;
  checkpoint();
  doc.objects = doc.objects.filter((o) => !ids.has(o.id));
  // Gelöschte Objekte verschwinden aus dem Pfad und aus Animationsschritten; leere Schritte fallen weg.
  doc.path = doc.path
    .map((p) => (isAnim(p) ? { ...p, targets: p.targets.filter((t) => !ids.has(t)) } : p))
    .filter((p) => (isAnim(p) ? p.targets.length > 0 : !ids.has(p)));
  pathIndex = Math.min(pathIndex, doc.path.length - 1);
  selection = [];
  selected = null;
  buildWorld();
  buildPathList();
  updateToolbar();
}

function changeTextSize(factor) {
  format((o) => (o.size *= factor), isText);
}

// ---------- Kopieren, Ausschneiden, Einfügen, Duplizieren ----------
// Die Objekte liegen in einer internen Ablage; in die Systemablage kommt nur eine Markierung,
// damit Strg+V weiß, ob zuletzt Objekte aus Weitblick oder z. B. ein Bildschirmfoto kopiert wurden.

const CLIP_MARK = "weitblick-objekte:";
let clipboard = null;

function copySelection() {
  if (!selection.length) return false;
  const items = withContents(selection).filter((o) => !o.hidden);
  clipboard = { id: Date.now().toString(36), items: structuredClone(items), pastes: 0 };
  navigator.clipboard?.writeText(CLIP_MARK + clipboard.id).catch(() => {});
  return true;
}

function cutSelection() {
  if (copySelection()) deleteSelected();
}

function pasteObjects(source = clipboard) {
  if (!source?.items.length) return;
  checkpoint();
  source.pastes += 1;
  const shift = camera.w * 0.03 * source.pastes;
  const ids = new Map();
  const copies = source.items.map((o) => {
    const c = structuredClone(o);
    c.id = newId(o.type[0]);
    ids.set(o.id, c.id);
    c.x += shift;
    c.y += shift;
    return c;
  });
  // Rahmen hinter alles andere, der Rest obendrauf; neue Rahmen kommen auch in den Pfad.
  const frames = copies.filter((c) => c.type === "frame");
  doc.objects.splice(1, 0, ...frames);
  doc.objects.push(...copies.filter((c) => c.type !== "frame"));
  buildWorld();
  for (const f of frames) addToPath(f.id);
  const tops = source.items.filter((o) => selectionWasTop(o, source));
  setSelection(tops.map((o) => byId.get(ids.get(o.id))));
}

// Beim Einfügen sind nur die ursprünglich gewählten Objekte ausgewählt, nicht der mitkopierte Rahmeninhalt.
function selectionWasTop(o, source) {
  return !source.items.some((f) => f !== o && f.type === "frame" && inside(o, f));
}

function duplicateSelection() {
  if (!selection.length) return;
  const items = structuredClone(withContents(selection).filter((o) => !o.hidden));
  pasteObjects({ items, pastes: 0 });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

document.addEventListener("paste", async (e) => {
  if (isEditing() || presenting) return;
  const text = e.clipboardData?.getData("text/plain") ?? "";
  const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
  e.preventDefault();
  if (clipboard && text === CLIP_MARK + clipboard.id) pasteObjects();
  else if (image) {
    const ext = { "image/jpeg": "jpg", "image/svg+xml": "svg" }[image.type] ?? image.type.split("/")[1];
    checkpoint();
    await placeImage(ext, await blobToBase64(image));
  } else if (clipboard) pasteObjects();
});

function inside(a, b) {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

// Welches Objekt liegt unter dem Zeiger? Rahmen nur an der Kante.
function hitObject(e) {
  const el = e.target.closest?.(".obj");
  if (!el || el.classList.contains("hidden-frame")) return null;
  const o = byId.get(el.dataset.id);
  if (o.type !== "frame") return o;
  const p = eventToWorld(e);
  const band = FRAME_GRAB_PX / zoom();
  const nearEdge =
    p.x - o.x < band || o.x + o.w - p.x < band || p.y - o.y < band || o.y + o.h - p.y < band;
  return nearEdge ? o : null;
}

// ---------- Zeigergesten: verschieben, Objekt bewegen, Größe ändern ----------

let gesture = null;

viewport.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  // Leisten über der Leinwand bekommen ihre Klicks selbst, sonst würde die Zeigererfassung sie schlucken.
  if (e.target.closest(".formatbar, .present-controls")) return;
  if (presenting) {
    // Beim Präsentieren wird nichts bearbeitet: ziehen verschiebt, ein Klick fliegt zum Objekt.
    camera.stop();
    const target = e.target.closest?.(".obj:not(.hidden-frame)");
    gesture = { kind: "pan", x: e.clientX, y: e.clientY, cx: camera.cx, cy: camera.cy, target };
    viewport.setPointerCapture(e.pointerId);
    return;
  }
  if (e.target.isContentEditable) return;
  if (isEditing()) document.activeElement.blur();
  camera.stop();
  const start = eventToWorld(e);

  if (e.button === 0 && e.target.classList.contains("handle") && selected) {
    gesture = { kind: "resize", start, o: selected, w: selected.w, h: selected.h, before: snapshot() };
  } else if (e.button === 0 && e.target.classList.contains("rot-handle") && selected) {
    const o = selected;
    gesture = { kind: "rotate", o, center: { x: o.x + o.w / 2, y: o.y + o.h / 2 }, before: snapshot() };
  } else {
    const o = e.button === 0 ? hitObject(e) : null;
    if (o && e.shiftKey) {
      select(o, true); // Umschalt+Klick: zur Auswahl hinzufügen oder entfernen
      return;
    }
    if (o) {
      if (!selection.includes(o)) select(o);
      // Alle ausgewählten Objekte bewegen sich gemeinsam, Rahmen mit ihrem Inhalt.
      const items = withContents(selection).map((p) => ({ p, x: p.x, y: p.y }));
      gesture = { kind: "move", start, items, before: snapshot() };
    } else if (e.button === 0 && e.shiftKey) {
      // Umschalt+Ziehen auf leerer Fläche: Auswahlrechteck.
      const box = document.createElement("div");
      box.className = "marquee";
      viewport.append(box);
      const r = viewport.getBoundingClientRect();
      gesture = { kind: "marquee", start, box, sx: e.clientX - r.left, sy: e.clientY - r.top };
    } else {
      select(null);
      gesture = { kind: "pan", x: e.clientX, y: e.clientY, cx: camera.cx, cy: camera.cy };
      viewport.classList.add("dragging");
    }
  }
  viewport.setPointerCapture(e.pointerId);
});

const ROTATE_SNAP = 15;

function rotationAt(g, p, snap) {
  // 0° zeigt nach oben, wo der Drehanfasser sitzt.
  let deg = (Math.atan2(p.y - g.center.y, p.x - g.center.x) * 180) / Math.PI + 90;
  if (snap) deg = Math.round(deg / ROTATE_SNAP) * ROTATE_SNAP;
  deg = ((deg % 360) + 360) % 360;
  return deg === 0 ? 0 : deg;
}

viewport.addEventListener("pointermove", (e) => {
  if (!gesture) return;
  if (gesture.kind === "pan") {
    const z = zoom();
    camera.set({ w: camera.w, cx: gesture.cx - (e.clientX - gesture.x) / z, cy: gesture.cy - (e.clientY - gesture.y) / z });
    return;
  }
  const p = eventToWorld(e);
  if (gesture.kind === "rotate") {
    gesture.o.rot = rotationAt(gesture, p, e.shiftKey);
    updateEl(gesture.o);
    return;
  }
  if (gesture.kind === "marquee") {
    const r = viewport.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    Object.assign(gesture.box.style, {
      left: `${Math.min(x, gesture.sx)}px`,
      top: `${Math.min(y, gesture.sy)}px`,
      width: `${Math.abs(x - gesture.sx)}px`,
      height: `${Math.abs(y - gesture.sy)}px`,
    });
    gesture.end = p;
    return;
  }
  const dx = p.x - gesture.start.x;
  const dy = p.y - gesture.start.y;
  if (gesture.kind === "move") {
    for (const it of gesture.items) {
      it.p.x = it.x + dx;
      it.p.y = it.y + dy;
      updateEl(it.p);
    }
  } else {
    const o = gesture.o;
    const minSize = 4 / zoom();
    // Bei gedrehten Objekten zählt die Bewegung entlang ihrer eigenen Achsen.
    const a = (-(o.rot ?? 0) * Math.PI) / 180;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    o.w = Math.max(minSize, gesture.w + lx);
    // Bilder behalten ihr Seitenverhältnis, andere Objekte nur mit gedrückter Umschalttaste.
    const keepAspect = o.type === "image" ? !e.shiftKey : e.shiftKey;
    o.h = keepAspect ? o.w * (gesture.h / gesture.w) : Math.max(minSize, gesture.h + ly);
    updateEl(o);
  }
});

const endGesture = (e) => {
  const g = gesture;
  gesture = null;
  viewport.classList.remove("dragging");
  if (g?.before && snapshot() !== g.before) checkpoint(g.before);
  if (g?.kind === "marquee") {
    g.box.remove();
    if (g.end) {
      const box = {
        x: Math.min(g.start.x, g.end.x),
        y: Math.min(g.start.y, g.end.y),
        w: Math.abs(g.end.x - g.start.x),
        h: Math.abs(g.end.y - g.start.y),
      };
      const hits = doc.objects.filter((o) => !o.hidden && inside(o, box));
      setSelection([...selection, ...hits.filter((o) => !selection.includes(o))]);
    }
  }
  const isClick = g?.kind === "pan" && e?.type === "pointerup" && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4;
  if (presenting && isClick && g.target) flyToObject(byId.get(g.target.dataset.id));
};
viewport.addEventListener("pointerup", endGesture);
viewport.addEventListener("pointercancel", endGesture);

viewport.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    // Touchpads liefern viele kleine Schritte, Mausräder wenige große.
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);

function zoomAt(factor, sx, sy) {
  camera.stop();
  const before = screenToWorld(sx, sy);
  const w = Math.min(MAX_W, Math.max(MIN_W, camera.w / factor));
  const z = viewport.clientWidth / w;
  camera.set({
    w,
    cx: before.x - (sx - viewport.clientWidth / 2) / z,
    cy: before.y - (sy - viewport.clientHeight / 2) / z,
  });
}

// Doppelklick: Text bearbeiten, sonst zum kleinsten Rahmen unter dem Zeiger fliegen.
viewport.addEventListener("dblclick", (e) => {
  if (presenting || e.target.closest(".formatbar")) return;
  // Wegen der Zeigererfassung ist e.target hier der Viewport, also selbst nachsehen.
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".obj.text");
  if (el) {
    startEditing(byId.get(el.dataset.id));
    return;
  }
  const p = eventToWorld(e);
  const hit = doc.objects
    .filter((o) => o.type === "frame" && !o.hidden && inside({ x: p.x, y: p.y, w: 0, h: 0 }, o))
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
  if (!hit) return;
  const i = doc.path.indexOf(hit.id);
  if (i >= 0) goTo(i);
  else camera.flyTo(frameState(hit.id));
});

// ---------- Speichern und Öffnen (.weitblick) ----------

// Version 2: Pfadeinträge können Animationsschritte sein (Objekte statt nur ids).
const FORMAT_VERSION = 2;
const FILTERS = [{ name: "Weitblick-Präsentation", extensions: ["weitblick"] }];
const tauri = window.__TAURI__;

function showFileName() {
  const name = currentPath ? currentPath.split(/[\\/]/).pop() : "nicht gespeichert";
  const dirty = savedSnapshot !== null && isDirty() ? " •" : "";
  document.getElementById("doc-title").textContent = `${doc.title} · ${name}${dirty}`;
}

// Nur Bilder mitspeichern, die noch auf der Leinwand liegen.
function usedMedia() {
  const names = new Set(doc.objects.filter((o) => o.type === "image").map((o) => o.src));
  for (const f of doc.fonts ?? []) for (const face of f.faces) names.add(face.src);
  return [...names].filter((n) => media.has(n)).map((name) => ({ name, data: media.get(name).data }));
}

async function confirmDiscard() {
  if (!isDirty()) return true;
  return tauri.dialog.ask("Es gibt ungespeicherte Änderungen. Trotzdem fortfahren?", {
    title: "Weitblick",
    kind: "warning",
    okLabel: "Verwerfen",
    cancelLabel: "Abbrechen",
  });
}

async function saveAs() {
  const path = await tauri.dialog.save({ filters: FILTERS, defaultPath: `${doc.title}.weitblick` });
  if (!path) return;
  currentPath = path.endsWith(".weitblick") ? path : `${path}.weitblick`;
  // Eine neue Präsentation heißt danach wie ihre Datei.
  if (doc.title === "Neue Präsentation") doc.title = currentPath.split(/[\\/]/).pop().replace(/\.weitblick$/i, "");
  await save();
}

async function save() {
  if (!currentPath) return saveAs();
  if (isEditing()) document.activeElement.blur();
  try {
    await tauri.core.invoke("save_presentation", {
      path: currentPath,
      json: JSON.stringify({ ...doc, version: FORMAT_VERSION }, null, 2),
      media: usedMedia(),
    });
    markSaved();
  } catch (err) {
    await tauri.dialog.message(String(err), { title: "Speichern fehlgeschlagen", kind: "error" });
  }
}

async function openFile() {
  if (!(await confirmDiscard())) return;
  const path = await tauri.dialog.open({ filters: FILTERS, multiple: false });
  if (path) await openPath(path);
}

async function openPath(path) {
  try {
    const result = await tauri.core.invoke("open_presentation", { path });
    const loaded = JSON.parse(result.json);
    if (loaded.format !== "weitblick") throw new Error("Das ist keine Weitblick-Präsentation.");
    if (loaded.version > FORMAT_VERSION) throw new Error("Die Datei stammt aus einer neueren Weitblick-Version.");
    loadDocument(loaded, path, result.media);
  } catch (err) {
    await tauri.dialog.message(String(err.message ?? err), { title: "Öffnen fehlgeschlagen", kind: "error" });
  }
}

// Ein Dokument anzeigen: Medien und Schriften laden, Verlauf und Auswahl zurücksetzen.
function loadDocument(loaded, path, mediaList = []) {
  clearMedia();
  for (const m of mediaList) addMedia(m.name, m.data);
  doc = loaded;
  doc.fonts ??= [];
  registerDocFonts();
  currentPath = path;
  undoStack = [];
  redoStack = [];
  selection = [];
  selected = null;
  pathIndex = 0;
  buildWorld();
  buildPathList();
  updateToolbar();
  markSaved();
  camera.set(frameState(doc.path[0]));
}

async function newDocument() {
  if (!(await confirmDiscard())) return;
  if (presenting) await stopPresentation();
  loadDocument({
    format: "weitblick",
    version: FORMAT_VERSION,
    title: "Neue Präsentation",
    theme: structuredClone(demo.theme),
    fonts: [],
    objects: [{ id: "f-overview", type: "frame", x: -800, y: -450, w: 1600, h: 900, hidden: true, title: "Überblick" }],
    path: ["f-overview"],
  }, null);
}

// ---------- Symbole (Lucide) ----------

function iconSvg(name) {
  const nodes = ICON_NODES[name] ?? ICON_NODES["circle-help"] ?? [];
  const inner = nodes
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// Fertige Objekte (ohne id) um die Bildmitte herum einfügen und auswählen, als ein Rückgängig-Schritt.
function insertObjects(items) {
  checkpoint();
  const added = items.map((o) => ({ ...o, id: newId(o.type[0]), x: o.x + camera.cx, y: o.y + camera.cy }));
  doc.objects.push(...added);
  buildWorld();
  setSelection(added);
}

function insertIcon(name) {
  const s = camera.w * 0.1;
  insertObjects([{ type: "icon", name, x: -s / 2, y: -s / 2, w: s, h: s, color: doc.theme.accent }]);
}

function insertDiagram(id) {
  const d = DIAGRAMS.find((x) => x.id === id);
  if (d) insertObjects(d.build(camera.w / 16, doc.theme));
}

// ---------- Schriften ----------
// Eingebettete Google-Schriften stehen in doc.fonts und liegen als woff2 unter media/fonts/.

const GOOGLE_FONTS = [
  "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Inter", "Raleway", "Nunito", "Source Sans 3",
  "Work Sans", "Rubik", "Oswald", "Bebas Neue", "Anton", "Archivo Black", "Playfair Display", "Merriweather",
  "Lora", "PT Serif", "Libre Baskerville", "EB Garamond", "Cormorant Garamond", "Roboto Slab", "Zilla Slab",
  "Fira Code", "JetBrains Mono", "Space Mono", "Caveat", "Dancing Script", "Pacifico", "Permanent Marker",
  "Indie Flower", "Comfortaa", "Quicksand", "Exo 2", "Orbitron", "Audiowide", "Righteous", "Lobster", "Abril Fatface",
];

let registeredFonts = [];
let systemFonts = null;

function registerDocFonts() {
  for (const f of registeredFonts) document.fonts.delete(f);
  registeredFonts = [];
  for (const fam of doc.fonts ?? []) {
    for (const face of fam.faces) {
      const m = media.get(face.src);
      if (!m) continue;
      const ff = new FontFace(fam.family, `url(${m.url})`, {
        weight: face.weight,
        style: face.style,
        ...(face.range ? { unicodeRange: face.range } : {}),
      });
      document.fonts.add(ff);
      registeredFonts.push(ff);
    }
  }
  fillFontSelect();
}

async function addGoogleFont(family, status) {
  family = family.trim();
  if (!family) return;
  if (doc.fonts.some((f) => f.family.toLowerCase() === family.toLowerCase())) {
    applyFont(doc.fonts.find((f) => f.family.toLowerCase() === family.toLowerCase()).family);
    return;
  }
  status.textContent = `Lade „${family}“ …`;
  try {
    const faces = await tauri.core.invoke("google_font", { family });
    const slug = family.toLowerCase().replace(/\s+/g, "-");
    checkpoint();
    doc.fonts.push({
      family,
      faces: faces.map((f, i) => {
        const src = `media/fonts/${slug}-${i}.woff2`;
        addMedia(src, f.data);
        return { src, weight: f.weight, style: f.style, range: f.range };
      }),
    });
    registerDocFonts();
    status.textContent = `„${family}“ ist in dieser Präsentation eingebettet.`;
    applyFont(family);
  } catch (err) {
    status.textContent = String(err);
  }
}

// Schrift auf die ausgewählten Texte anwenden, falls welche ausgewählt sind.
function applyFont(family) {
  format((o) => (o.font = family), isText);
}

function fillFontSelect() {
  const groups = [
    ["Standard", [["sans", "Serifenlos"], ["serif", "Serif"], ["mono", "Schreibmaschine"]]],
    ["In dieser Präsentation", (doc.fonts ?? []).map((f) => [f.family, f.family])],
    ["Systemschriften", (systemFonts ?? []).map((f) => [f, f])],
  ];
  fontSelect.replaceChildren(
    ...groups
      .filter(([, items]) => items.length)
      .map(([title, items]) => {
        const g = document.createElement("optgroup");
        g.label = title;
        for (const [value, text] of items) g.append(new Option(text, value));
        return g;
      }),
  );
  if (selected?.type === "text") fontSelect.value = selected.font ?? "sans";
}

// Eine Schrift, die die Liste nicht kennt (z. B. aus einer Datei von einem anderen Rechner), trotzdem anzeigen.
function ensureFontOption(value) {
  if ([...fontSelect.options].some((o) => o.value === value)) return;
  fontSelect.append(new Option(`${value} (fehlt hier)`, value));
}

async function loadSystemFonts() {
  try {
    systemFonts = await tauri.core.invoke("system_fonts");
    fillFontSelect();
  } catch {
    // Ohne Tauri (z. B. im Browser) gibt es nur die Standardschriften.
  }
}

// ---------- Seitenleiste rechts: Formen, Symbole, Diagramme, Schriften ----------

const sidebar = document.getElementById("insertbar");

function showTab(tab) {
  sidebar.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  sidebar.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
}

function buildSidebar() {
  const shapes = sidebar.querySelector('[data-panel="shapes"]');
  for (const s of SHAPES) {
    const b = document.createElement("button");
    b.className = "tile";
    b.title = s.label;
    const preview = shapeSvg(s.id, "currentColor") ?? `<span class="css-shape ${s.id}"></span>`;
    b.innerHTML = `${preview}<span>${s.label}</span>`;
    b.addEventListener("click", () => addObject(s.id));
    shapes.append(b);
  }

  const diagrams = sidebar.querySelector('[data-panel="diagrams"]');
  for (const d of DIAGRAMS) {
    const b = document.createElement("button");
    b.className = "row";
    b.textContent = d.label;
    b.addEventListener("click", () => insertDiagram(d.id));
    diagrams.append(b);
  }

  const iconGrid = sidebar.querySelector(".icon-grid");
  const search = sidebar.querySelector("#icon-search");
  const names = Object.keys(ICON_NODES);
  const showIcons = () => {
    const q = search.value.trim().toLowerCase();
    const hits = q
      ? names.filter((n) => n.includes(q) || (ICON_TAGS[n] ?? []).some((t) => t.includes(q)))
      : names;
    iconGrid.replaceChildren(
      ...hits.slice(0, 240).map((n) => {
        const b = document.createElement("button");
        b.title = n;
        b.innerHTML = iconSvg(n);
        b.addEventListener("click", () => insertIcon(n));
        return b;
      }),
    );
    sidebar.querySelector(".icon-count").textContent =
      hits.length > 240 ? `240 von ${hits.length} – Suche verfeinern` : `${hits.length} Symbole`;
  };
  search.addEventListener("input", showIcons);
  showIcons();

  const fontList = sidebar.querySelector(".font-list");
  const status = sidebar.querySelector(".font-status");
  for (const f of GOOGLE_FONTS) {
    const b = document.createElement("button");
    b.className = "row";
    b.textContent = f;
    b.addEventListener("click", () => addGoogleFont(f, status));
    fontList.append(b);
  }
  const custom = sidebar.querySelector("#font-custom");
  custom.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addGoogleFont(custom.value, status);
  });

  sidebar.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  showTab("shapes");
}

function toggleSidebar() {
  document.body.classList.toggle("insertbar-open");
  render();
}

// ---------- Präsentieren ----------

const appWindow = tauri?.window?.getCurrentWindow();
const progressBar = document.getElementById("progress-bar");
const stepCounter = document.getElementById("step-label");
let controlsTimer = null;

function flyToObject(o) {
  if (!o) return;
  const i = o.type === "frame" ? doc.path.indexOf(o.id) : -1;
  if (i >= 0) return goTo(i);
  offPath = true;
  camera.flyTo(fitRect(o, viewport.clientWidth, viewport.clientHeight, o.type === "frame" ? 0.08 : 0.15));
}

function updateProgress() {
  const last = Math.max(1, doc.path.length - 1);
  progressBar.style.width = `${(pathIndex / last) * 100}%`;
  stepCounter.textContent = `${pathIndex + 1} / ${doc.path.length}`;
}

async function setFullscreen(on) {
  try {
    await appWindow?.setFullscreen(on);
  } catch {
    // Ohne Vollbild-Recht bleibt das Fenster einfach, wie es ist.
  }
}

async function startPresentation(fromCurrent) {
  if (presenting) return;
  if (isEditing()) document.activeElement.blur();
  select(null);
  presenting = true;
  document.body.classList.add("presenting");
  await setFullscreen(true);
  // Erst wenn das Fenster seine neue Größe hat, passt der Ausschnitt.
  requestAnimationFrame(() => {
    goTo(fromCurrent ? pathIndex : 0);
    showControls();
  });
}

async function stopPresentation() {
  if (!presenting) return;
  presenting = false;
  document.body.classList.remove("presenting", "show-controls");
  applyVisibility(pathIndex); // im Editor ist alles sichtbar
  await setFullscreen(false);
}

// Die Steuerleiste erscheint bei Mausbewegung und verschwindet nach zwei Sekunden Ruhe.
function showControls() {
  document.body.classList.add("show-controls");
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => document.body.classList.remove("show-controls"), 2000);
}

document.addEventListener("mousemove", () => {
  if (presenting) showControls();
});

// ---------- Tasten und Knöpfe ----------

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    if (e.shiftKey) saveAs();
    else save();
    return;
  }
  if (e.ctrlKey && (e.key === "n" || e.key === "N")) {
    e.preventDefault();
    newDocument();
    return;
  }
  if (e.ctrlKey && (e.key === "o" || e.key === "O")) {
    e.preventDefault();
    openFile();
    return;
  }
  if (e.ctrlKey && !presenting && selected?.type === "text" && ["b", "B", "i", "I"].includes(e.key)) {
    e.preventDefault();
    if (e.key.toLowerCase() === "b") toggleBold();
    else toggleItalic();
    return;
  }
  if (isEditing()) {
    if (e.key === "Escape" || (e.key === "Enter" && e.target.closest?.("#path-list"))) {
      e.preventDefault();
      document.activeElement.blur();
    }
    return;
  }
  if (e.ctrlKey && !presenting && ["c", "x", "d", "a"].includes(e.key.toLowerCase())) {
    e.preventDefault();
    ({ c: copySelection, x: cutSelection, d: duplicateSelection, a: selectAll })[e.key.toLowerCase()]();
    return;
  }
  if (e.ctrlKey && !presenting && ["z", "Z", "y", "Y"].includes(e.key)) {
    e.preventDefault();
    if (e.key.toLowerCase() === "y" || e.shiftKey) redo();
    else undo();
    return;
  }
  if (e.key === "F5") startPresentation(e.shiftKey);
  else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) step(1);
  else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) step(-1);
  else if (e.key === "Home") goTo(0);
  else if (e.key === "Escape") presenting ? stopPresentation() : select(null);
  else if (presenting) return;
  else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
  else return;
  e.preventDefault();
});

const on = (id, fn) => document.getElementById(id).addEventListener("click", fn);
const center = () => [viewport.clientWidth / 2, viewport.clientHeight / 2];
on("btn-next", () => step(1));
on("btn-prev", () => step(-1));
on("btn-home", () => goTo(0));
on("btn-present", () => startPresentation(false));
on("pc-next", () => step(1));
on("pc-prev", () => step(-1));
on("pc-home", () => goTo(0));
on("pc-exit", stopPresentation);
on("btn-zoom-in", () => zoomAt(ZOOM_STEP, ...center()));
on("btn-zoom-out", () => zoomAt(1 / ZOOM_STEP, ...center()));
on("btn-add-text", () => addObject("text"));
on("btn-add-frame", () => addObject("frame"));
on("btn-new", newDocument);
on("btn-insert", toggleSidebar);
on("btn-text-smaller", () => changeTextSize(1 / 1.15));
on("btn-text-bigger", () => changeTextSize(1.15));
on("btn-delete", deleteSelected);
on("btn-open", openFile);
on("btn-save", save);
on("btn-add-image", chooseImages);
on("btn-add-to-path", addSelectedToPath);
on("btn-fade-in", () => addAnimation("fade-in"));
on("btn-fade-out", () => addAnimation("fade-out"));
on("btn-bold", toggleBold);
on("btn-italic", toggleItalic);
on("btn-align", cycleAlign);
on("btn-undo", undo);
on("btn-redo", redo);

// Vor dem Schließen nachfragen, wenn noch etwas ungespeichert ist.
appWindow?.onCloseRequested(async (event) => {
  if (!(await confirmDiscard())) event.preventDefault();
});

// Bilddateien aus dem Explorer auf die Leinwand ziehen.
tauri?.webview?.getCurrentWebview().onDragDropEvent(async (event) => {
  if (event.payload.type !== "drop" || presenting) return;
  const r = viewport.getBoundingClientRect();
  const { x, y } = event.payload.position; // in Gerätepixeln
  const at = screenToWorld(x / devicePixelRatio - r.left, y / devicePixelRatio - r.top);
  await insertImages(event.payload.paths, at);
});

new ResizeObserver(() => {
  // Beim Präsentieren bleibt der aktuelle Rahmen eingepasst, auch wenn sich die Fenstergröße ändert.
  if (presenting && !offPath && !camera.anim) camera.set(stepCamera(pathIndex));
  else render();
}).observe(viewport);

// ---------- Start ----------

doc.fonts ??= [];
buildSidebar();
fillFontSelect();
loadSystemFonts();
buildWorld();
buildPathList();
updateToolbar();
markSaved();
camera.set(frameState(doc.path[0]));

// Per Doppelklick auf eine .weitblick-Datei gestartet? Dann gleich diese öffnen.
tauri?.core
  .invoke("startup_file")
  .then((path) => path && openPath(path))
  .catch(() => {});
