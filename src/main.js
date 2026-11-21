import { Camera, fitRect } from "./camera.js";
import { demo } from "./demo.js";
import { SHAPES, SHAPE_GROUPS, shapeSvg } from "./shapes.js";
import { DIAGRAMS } from "./diagrams.js";
import { THEMES, ROLES } from "./themes.js";
import { buildPptx, importPptx } from "./pptx.js";
import { importPrezi } from "./prezi.js";
import { TEMPLATES } from "./templates.js";
import { MOTIONS } from "./motion.js";
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

// Stil (Farben, Schriften) gehört mit zum Stand, damit auch ein Stilwechsel rückgängig gemacht werden kann.
function snapshot() {
  return JSON.stringify({
    objects: doc.objects,
    path: doc.path,
    theme: doc.theme,
    fonts: doc.fonts,
    background: doc.background,
    aspect: doc.aspect,
  });
}

function checkpoint(before = snapshot()) {
  undoStack.push(before);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  showFileName();
  staleMinimap();
}

function restore(snap) {
  const s = JSON.parse(snap);
  doc.objects = s.objects;
  doc.path = s.path;
  if (s.theme) doc.theme = s.theme;
  if (s.fonts) doc.fonts = s.fonts;
  doc.background = s.background;
  doc.aspect = s.aspect;
  registerDocFonts();
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
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};
const isVideo = (name) => MIME[extOf(name)]?.startsWith("video/");

function extOf(name) {
  return name.split(".").pop().toLowerCase();
}

// Ein Medium liegt nur als Blob im Speicher; Base64 entsteht erst beim Speichern oder Exportieren.
// Eine eigene verkleinerte Anzeigefassung großer Fotos lohnt nicht: Edge entpackt JPEGs ohnehin passend
// verkleinert, eine Kopie kostete in der Messung mehr Speicher und Rechenzeit, als sie sparte.
function addMedia(name, data) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: MIME[extOf(name)] ?? "application/octet-stream" });
  const old = media.get(name);
  if (old) URL.revokeObjectURL(old.url);
  media.set(name, { blob, url: URL.createObjectURL(blob) });
}

function clearMedia() {
  for (const m of media.values()) URL.revokeObjectURL(m.url);
  media.clear();
  writtenMedia.clear();
}

const mediaData = (name) => blobToBase64(media.get(name).blob);

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

// Ein Bild oder Video (Base64) auf die Leinwand legen. Der Aufrufer legt vorher den Rückgängig-Punkt an.
async function placeImage(ext, data, at = null, index = 0) {
  const id = newId("i");
  const src = `media/${id}.${ext}`;
  addMedia(src, data);
  const video = isVideo(src);
  const size = video ? { w: 16, h: 9 } : await imageSize(media.get(src).url);
  const w = camera.w * 0.35;
  const h = (w * size.h) / size.w;
  const c = at ?? { x: camera.cx, y: camera.cy };
  const offset = camera.w * 0.03 * index;
  const o = { id, type: video ? "video" : "image", src, x: c.x - w / 2 + offset, y: c.y - h / 2 + offset, w, h };
  doc.objects.push(o);
  byId.set(id, o);
  world.append(makeEl(o));
  select(o);
  return o;
}

async function chooseImages() {
  const paths = await tauri.dialog.open({
    multiple: true,
    filters: [{ name: "Bilder und Videos", extensions: Object.keys(MIME) }],
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
  if (o.type === "video") el.innerHTML = '<video preload="metadata" playsinline controls></video>';
  if (o.type === "text") {
    el.addEventListener("blur", () => finishEditing(el));
    // In Aufzählungen: Enter beginnt den nächsten Punkt, Tab rückt eine Ebene ein (drei Leerzeichen).
    el.addEventListener("keydown", (e) => {
      if (!el.isContentEditable) return;
      const insert = (t) => {
        e.preventDefault();
        document.execCommand("insertText", false, t);
      };
      if (e.key === "Tab" && !e.shiftKey) insert("   ");
      else if (e.key === "Enter" && !e.shiftKey && /^ *• /m.test(el.innerText)) insert("\n• ");
      // Unterstreichen kennt das Textmodell nicht; der Browser würde es sonst einfügen und es ginge verloren.
      else if (e.ctrlKey && e.key.toLowerCase() === "u") e.preventDefault();
    });
    // Eingefügt wird nur reiner Text, nicht das Format der Quelle.
    el.addEventListener("paste", (e) => {
      if (!el.isContentEditable) return;
      e.preventDefault();
      document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
    });
  }
  updateEl(o, el);
  return el;
}

// Textinhalt zeichnen. Aufzählungen („• …“, je drei Leerzeichen davor = eine Ebene tiefer) wie in Prezi: pro
// Ebene 0,75 em eingerückt, Folgezeilen beginnen unter dem Text statt unter dem Punkt. Formatierte Abschnitte
// (o.spans) als <span>.
function renderText(o, el) {
  el.querySelectorAll(".handle, .rot-handle").forEach((h) => h.remove());
  if (/^\s*• /m.test(o.text)) {
    let at = 0;
    el.replaceChildren(
      ...o.text.split("\n").map((line) => {
        const div = document.createElement("div");
        const m = line.match(/^( *)• /);
        if (m) {
          // Die Leerzeichen bleiben im Text (beim Bearbeiten bleibt die Ebene erhalten), je etwa 0,25 em breit.
          const lead = 0.6 + m[1].length * 0.25;
          Object.assign(div.style, { paddingLeft: `${0.75 + lead}em`, textIndent: `-${lead}em` });
        }
        if (line) appendRich(div, line, o.spans, at);
        else div.textContent = "​";
        at += line.length + 1;
        return div;
      }),
    );
  } else {
    el.replaceChildren();
    appendRich(el, o.text, o.spans, 0);
  }
}

function updateEl(o, el = elOf(o)) {
  Object.assign(el.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` });
  if (o.type === "shape") {
    // stroke = { color, width } (Umrandung aus dem Prezi-Import): Rechteck und Ellipse zeichnet dann CSS.
    const outlined = o.stroke && ["rect", "ellipse"].includes(o.shape);
    const svg = outlined ? null : shapeSvg(o.shape, o.fill, o.points, hasCorners(o) ? cornerRadius(o) : 0);
    // fade: Deckkraft oben und unten (Verlauf aus dem Prezi-Import), nur bei CSS-Formen wie dem Rechteck.
    // fillOpacity: nur die Füllung durchscheinend (die Umrandung bleibt deckend).
    const mix = (a) => `color-mix(in srgb, ${o.fill} ${a * 100}%, transparent)`;
    el.style.background = svg ? "" : o.fade ? `linear-gradient(${mix(o.fade[0])}, ${mix(o.fade[1])})` : o.fillOpacity != null ? mix(o.fillOpacity) : o.fill;
    el.style.border = outlined ? `${o.stroke.width}px solid ${o.stroke.color}` : "";
    el.style.borderRadius = outlined && o.shape === "ellipse" ? "50%" : "";
    el.querySelector(".shape-svg")?.remove();
    if (svg) el.insertAdjacentHTML("afterbegin", svg);
  }
  if (o.type === "icon") el.style.color = o.color || doc.theme.text;
  if (o.type === "frame") el.style.background = o.fill || "";
  if (o.type === "image") {
    const m = media.get(o.src);
    el.style.backgroundImage = m ? `url("${m.url}")` : "";
    el.classList.toggle("missing", !m);
    // Zuschnitt: crop = sichtbarer Ausschnitt in Anteilen des Originalbilds (aus dem Prezi-Import).
    const c = o.crop;
    el.style.backgroundSize = c ? `${100 / c.w}% ${100 / c.h}%` : "";
    el.style.backgroundPosition = c ? `${c.w < 1 ? (c.x / (1 - c.w)) * 100 : 0}% ${c.h < 1 ? (c.y / (1 - c.h)) * 100 : 0}%` : "";
  }
  if (o.type === "video") {
    const m = media.get(o.src);
    const v = el.querySelector("video");
    if (m && v.src !== m.url) v.src = m.url;
    el.classList.toggle("missing", !m);
  }
  if (o.type === "text") {
    if (!el.isContentEditable) renderText(o, el);
    Object.assign(el.style, {
      fontSize: `${o.size}px`,
      color: o.color || doc.theme.text,
      textAlign: o.align || "left",
      fontWeight: textWeight(o),
      fontStyle: textItalic(o) ? "italic" : "normal",
      fontFamily: fontStack(textFont(o)),
      lineHeight: o.lh ?? "", // eigener Zeilenabstand (Prezi-Import), sonst 1,25 aus dem Stylesheet
      // Hinterlegter Text (aus dem Prezi-Import): Farbfläche mit Rand bgPad, ohne das Feld zu vergrößern.
      backgroundColor: o.bg ?? "",
      boxShadow: o.bg ? `0 0 0 ${o.bgPad ?? 0}px ${o.bg}` : "",
    });
  }
  el.style.transform = o.rot ? `rotate(${o.rot}deg)` : "";
  el.style.setProperty("--alpha", o.opacity ?? 1);
  // Rechteckige Objekte runden per CSS ab (SVG-Formen erledigt shapeSvg).
  const cssCorners = o.type === "frame" || o.type === "image" || (o.type === "shape" && ["rect", "rounded"].includes(o.shape));
  if (cssCorners) {
    const r = cornerRadius(o);
    el.style.borderRadius = r ? `${(r / 100) * Math.min(o.w, o.h)}px` : "";
  }
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
  applyBackground();
  updatePathBadges();
  staleMinimap();
}

function zoom() {
  return viewport.clientWidth / camera.w;
}

// Bildschirmrichtung → Leinwandrichtung bei gedrehter Kamera.
function unrotate(dx, dy) {
  const a = (camera.rot * Math.PI) / 180;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

// Mausrad, Ziehen und Minikarte gelten wie eine Kamerafahrt als Bewegung: --inv und die Formatleiste ruhen
// (beides zwingt den Browser, alle Objekte neu zu berechnen); erst wenn die Ansicht 150 ms ruht, wird nachgezogen.
// will-change: transform wäre noch flüssiger, kostete in der echten App aber über 1 GB Grafikspeicher.
let settling = false;
let settleTimer = 0;
function cameraBusy() {
  settling = true;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settling = false;
    render();
  }, 150);
}

function render() {
  const z = zoom();
  const tx = viewport.clientWidth / 2 - camera.cx * z;
  const ty = viewport.clientHeight / 2 - camera.cy * z;
  world.style.transform = camera.rot
    ? `translate(${viewport.clientWidth / 2}px, ${viewport.clientHeight / 2}px) rotate(${-camera.rot}deg) scale(${z}) translate(${-camera.cx}px, ${-camera.cy}px)`
    : `translate(${tx}px, ${ty}px) scale(${z})`;
  // Für Auswahlrand und Anfasser in Bildschirmgröße. Während einer Kamerafahrt nicht: jede Änderung lässt den
  // Browser alle Objekte neu berechnen und zeichnen; das macht die Fahrt auf langsamen Rechnern ruckelig.
  const moving = !!camera.anim || settling;
  if (!moving) world.style.setProperty("--inv", 1 / z);
  world.classList.toggle("flying", moving);
  motionLayer.classList.toggle("paused", moving);
  // Punktraster wandert mit, damit sich Bewegung auch auf leerer Fläche zeigt.
  const grid = 40 * z;
  const size = grid < 12 ? grid * Math.ceil(12 / grid) : grid;
  viewport.style.backgroundSize = `${size}px ${size}px`;
  viewport.style.backgroundPosition = `${tx}px ${ty}px`;
  zoomLabel.textContent = `${Math.round(z * 100)} %`;
  updateParallax();
  updateCovers();
  positionContextBar();
  queueMinimap();
}

// ---------- Kontextleiste ----------
// Die Leiste schwebt über der Auswahl (oder darunter, wenn oben kein Platz ist) und folgt ihr beim
// Verschieben und Zoomen. Ist die Auswahl ganz außer Sicht, bleibt sie am Rand stehen.

function positionContextBar() {
  // Während Verschieben, Größe ändern oder Kamerabewegung ausblenden statt vermessen: getBoundingClientRect
  // zwingt den Browser dabei jedes Mal, alle Objekte neu zu berechnen (die größte Last auf langsamen Rechnern).
  const busy = !!(gesture?.live || (gesture && gesture.kind !== "pan" && gesture.kind !== "move") || camera.anim || settling);
  formatbar.classList.toggle("in-motion", busy);
  if (busy || !formatbar.classList.contains("visible") || !selection.length) return;
  const vr = viewport.getBoundingClientRect();
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const o of selection) {
    const r = elOf(o)?.getBoundingClientRect();
    if (!r) continue;
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  if (top === Infinity) return;
  const bw = formatbar.offsetWidth;
  const bh = formatbar.offsetHeight;
  const gap = 14;
  // Platz für den Drehanfasser über dem Objekt lassen.
  let y = top - vr.top - bh - gap - 24;
  if (y < 8) y = bottom - vr.top + gap;
  y = clamp(y, 8, vr.height - bh - 64);
  const x = clamp((left + right) / 2 - vr.left - bw / 2, 8, vr.width - bw - 8);
  formatbar.style.left = `${x}px`;
  formatbar.style.top = `${y}px`;
}

// Beim Verschieben, Drehen oder Größeändern mitwandern (nach dem eigentlichen Zeiger-Handler).
viewport.addEventListener("pointermove", () =>
  requestAnimationFrame(() => {
    updateGroupBox();
    positionContextBar();
  }),
);

// ---------- Hintergrund ----------
// doc.background = { src, fit: "cover" | "contain" | "tile", parallax }; das Bild liegt unter media/.

const bgLayer = document.getElementById("bg-layer");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function applyBackground() {
  const bg = doc.background ?? {};
  const m = bg.src ? media.get(bg.src) : null;
  // gradient = { type: "linear" | "radial", from, to } (aus dem Prezi-Import), liegt unter dem Bild.
  const g = bg.gradient;
  const grad = g ? `${g.type === "radial" ? "radial-gradient(circle" : "linear-gradient(180deg"}, ${g.from}, ${g.to})` : "";
  bgLayer.style.backgroundImage = [m && `url("${m.url}")`, grad].filter(Boolean).join(", ");
  bgLayer.className = `bg-layer fit-${bg.fit ?? "cover"}${bg.parallax ? " parallax" : ""}`;
  viewport.classList.toggle("has-bg-image", !!(m || g));
  updateParallax();
  applyMotion();
}

// Bewegter Hintergrund: doc.background.motion = { kind, strength }. Liegt bildschirmfest zwischen Hintergrund
// und Leinwand; während Kamerabewegungen ruht er (render setzt .paused).
const motionLayer = document.getElementById("motion-layer");
let motionKey = "";
function applyMotion() {
  const mo = doc.background?.motion;
  const fx = mo && MOTIONS.find((x) => x.id === mo.kind);
  // Die Effekte erwarten #rrggbb; importierte Stile können auch rgb() oder #rgb enthalten.
  const hex = (c) => toHex(String(c ?? "").startsWith("rgb") ? rgbHex(c) : c);
  const t = { background: hex(doc.theme.background), text: hex(doc.theme.text), accent: hex(doc.theme.accent), accent2: hex(doc.theme.accent2) };
  const key = fx ? JSON.stringify([fx.id, mo.strength, t]) : "";
  if (key === motionKey) return; // buildWorld läuft oft; nur bei einer Änderung neu aufbauen (sonst springen die Animationen)
  motionKey = key;
  motionLayer.replaceChildren();
  if (fx) fx.build(motionLayer, t, mo.strength ?? 0.5);
}

// Parallaxe: Das Bild wandert langsamer als die Leinwand mit und zoomt nur leicht, bezogen auf den Überblick.
// Kapitel wie in Prezi Next: o.cover ist nur von außen sichtbar, o.inside nur von innen. Dazwischen wird
// überblendet, je nachdem wie weit die Kamera in den Rahmen hineingezoomt ist.
// Sichtbarkeit (0..1) eines Kapitel-Objekts bei Kamera cam und Bildseitenverhältnis aspect (Breite/Höhe).
function zoomFade(o, cam, aspect) {
  const insideness = (id) => {
    const fr = byId.get(id);
    // zone: Bereich aller Kinder eines Prezi-Kapitels, relativ zum Rahmen
    const f = fr?.zone ? { x: fr.x + fr.zone.x, y: fr.y + fr.zone.y, w: fr.zone.w, h: fr.zone.h } : fr;
    if (!f || cam.cx < f.x || cam.cx > f.x + f.w || cam.cy < f.y || cam.cy > f.y + f.h) return 0;
    // Wie stark füllt der Bereich das Bild? Maßgeblich ist die knappere Kante (Breite oder Höhe).
    const r = Math.min(cam.w / f.w, cam.w / aspect / f.h);
    return clamp((3 - r) / 1.5, 0, 1); // ganz drinnen ab 1,5-facher, draußen ab 3-facher Größe
  };
  return (o.cover ? 1 - insideness(o.cover) : 1) * (o.inside ? insideness(o.inside) : 1);
}

function updateCovers() {
  for (const o of doc.objects) {
    if (!o.cover && !o.inside) continue;
    const k = zoomFade(o, camera, viewport.clientWidth / viewport.clientHeight);
    const el = elOf(o);
    el?.style.setProperty("--zoomfade", k);
    el?.classList.toggle("zoom-hidden", k === 0);
  }
}

function updateParallax() {
  if (!doc.background?.parallax || !doc.background.src) {
    bgLayer.style.transform = "";
    return;
  }
  const ov = byId.get(doc.path[0]);
  if (!ov) return;
  const dx = clamp((camera.cx - (ov.x + ov.w / 2)) / ov.w, -0.5, 0.5) * viewport.clientWidth * 0.2;
  const dy = clamp((camera.cy - (ov.y + ov.h / 2)) / ov.h, -0.5, 0.5) * viewport.clientHeight * 0.2;
  const s = clamp(1 + 0.08 * Math.log2(ov.w / camera.w), 1, 1.3);
  bgLayer.style.transform = `translate(${-dx}px, ${-dy}px) scale(${s})`;
}

async function chooseBackground() {
  const path = await tauri.dialog.open({ multiple: false, filters: [{ name: "Bilder", extensions: Object.keys(MIME) }] });
  if (!path) return;
  const file = await tauri.core.invoke("import_media", { path });
  checkpoint();
  const src = `media/bg-${Date.now().toString(36)}.${extOf(file.name)}`;
  addMedia(src, file.data);
  doc.background = { fit: "cover", parallax: false, ...doc.background, src };
  applyBackground();
  updateStylePanel();
}

// Ein Bild auf der Leinwand wird zum Hintergrund: es verschwindet als Objekt und füllt dahinter alles aus.
function imageToBackground() {
  const img = selected?.type === "image" ? selected : null;
  if (!img) return;
  checkpoint();
  doc.background = { fit: "cover", parallax: false, ...doc.background, src: img.src };
  doc.objects = doc.objects.filter((o) => o !== img);
  doc.path = doc.path.filter((p) => p !== img.id);
  selection = [];
  selected = null;
  buildWorld();
  buildPathList();
  updateToolbar();
  updateStylePanel();
}

function setBackground(change) {
  checkpoint();
  doc.background = { fit: "cover", parallax: false, ...doc.background, ...change };
  applyBackground();
  updateStylePanel();
}

// Seitenverhältnis der Präsentation (für neue Rahmen), z. B. "16:9" → 16/9.
function aspectRatio() {
  const [w, h] = (doc.aspect ?? "16:9").split(":").map(Number);
  return w / h || 16 / 9;
}

function screenToWorld(sx, sy) {
  const z = zoom();
  const d = unrotate((sx - viewport.clientWidth / 2) / z, (sy - viewport.clientHeight / 2) / z);
  return { x: camera.cx + d.x, y: camera.cy + d.y };
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
    li.classList.toggle("sub", !isAnim(id) && !!byId.get(id)?.sub);
    li.addEventListener("mouseenter", () => showPathPreview(li, i));
    li.addEventListener("mouseleave", hidePathPreview);
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
  updatePathBadges();
}

function stepLabel(o) {
  if (!o) return null;
  if (o.title) return o.title;
  if (o.type === "text") return o.text.split("\n")[0].slice(0, 40) || "Text";
  return { image: "Bild", shape: "Form", video: "Video" }[o.type];
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
  hidePathPreview();
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

// ---------- Vorschau beim Überfahren der Pfadliste ----------
// Eine verkleinerte Kopie der Leinwand, so gezeigt, wie die Kamera bei diesem Schritt steht.

const PREVIEW_W = 240;
const pathPreview = document.createElement("div");
pathPreview.className = "path-preview";
document.body.append(pathPreview);

function showPathPreview(li, i) {
  if (pathDrag?.moved || presenting) return;
  const cam = stepCamera(i);
  const ratio = viewport.clientWidth > 0 ? viewport.clientHeight / viewport.clientWidth : 9 / 16;
  const w = PREVIEW_W;
  const h = Math.round(w * ratio);
  const stage = document.createElement("div");
  stage.className = "pp-stage";
  const bg = doc.background?.src ? media.get(doc.background.src) : null;
  Object.assign(stage.style, {
    width: `${w}px`,
    height: `${h}px`,
    backgroundColor: doc.theme.background,
    backgroundImage: bg ? `url("${bg.url}")` : "",
  });
  const copy = world.cloneNode(true);
  copy.removeAttribute("id");
  copy.querySelectorAll(".handle, .rot-handle").forEach((x) => x.remove());
  copy.querySelectorAll(".selected").forEach((x) => x.classList.remove("selected"));
  // Wie beim Präsentieren: Rahmen ohne Rand, eingeblendete Objekte erst ab ihrem Schritt.
  const hidden = hiddenAt(i);
  copy.querySelectorAll(".obj").forEach((x) => {
    x.style.transition = "none";
    if (x.classList.contains("frame")) x.style.borderColor = "transparent";
    if (hidden.has(x.dataset.id)) x.style.opacity = "0";
  });
  const z = w / cam.w;
  copy.style.transform = `translate(${w / 2 - cam.cx * z}px, ${h / 2 - cam.cy * z}px) scale(${z})`;
  stage.append(copy);
  pathPreview.replaceChildren(stage);
  const r = li.getBoundingClientRect();
  pathPreview.style.left = `${r.right + 10}px`;
  pathPreview.style.top = `${Math.max(8, Math.min(r.top + r.height / 2 - h / 2, innerHeight - h - 16))}px`;
  pathPreview.classList.add("visible");
}

function hidePathPreview() {
  pathPreview.classList.remove("visible");
  pathPreview.replaceChildren();
}

function markActive() {
  [...pathList.children].forEach((li, i) => li.classList.toggle("active", i === pathIndex));
  if (document.activeElement !== notesBox) notesBox.value = noteHolder(pathIndex)?.notes ?? "";
  notesBox.disabled = !doc.path.length;
  // Animationsschritte bewegen die Kamera nicht, also gibt es dort keinen Übergang.
  transitionSelect.value = noteHolder(pathIndex)?.transition ?? "";
  transitionSelect.disabled = !doc.path.length || isAnim(doc.path[pathIndex]);
  sendPresenter();
}

// ---------- Übergänge ----------
// „fade“: Leinwand ausblenden, Kamera umsetzen, einblenden; „cut“: sofort umsetzen; sonst fliegen.
const FADE_MS = 250;
let fadeTimer = 0;
function moveCamera(target, kind) {
  clearTimeout(fadeTimer);
  const layers = [world, bgLayer];
  layers.forEach((el) => (el.style.opacity = ""));
  if (kind === "cut" || kind === "fade") camera.stop();
  if (kind === "cut") return camera.set(target);
  if (kind !== "fade") return camera.flyTo(target);
  layers.forEach((el) => {
    el.style.transition = `opacity ${FADE_MS}ms`;
    el.style.opacity = "0";
  });
  fadeTimer = setTimeout(() => {
    camera.set(target);
    layers.forEach((el) => (el.style.opacity = ""));
  }, FADE_MS);
}

const transitionSelect = document.getElementById("step-transition");
transitionSelect.addEventListener("change", () => {
  const h = noteHolder(pathIndex);
  if (!h || isAnim(doc.path[pathIndex])) return;
  checkpoint();
  if (transitionSelect.value) h.transition = transitionSelect.value;
  else delete h.transition;
});

// ---------- Notizen ----------
// Notizen hängen am Objekt eines Kamera-Schritts bzw. am Animationsschritt selbst – so wandern sie beim
// Umsortieren mit und sind Teil von Rückgängig.
const notesBox = document.getElementById("step-notes");
let notesBefore = null;

function noteHolder(i) {
  const s = doc.path[i];
  return isAnim(s) ? s : byId.get(s);
}

notesBox.addEventListener("focus", () => (notesBefore = snapshot()));
notesBox.addEventListener("input", () => {
  const h = noteHolder(pathIndex);
  if (!h) return;
  if (notesBox.value.trim()) h.notes = notesBox.value;
  else delete h.notes;
});
notesBox.addEventListener("blur", () => {
  if (notesBefore && snapshot() !== notesBefore) checkpoint(notesBefore);
  notesBefore = null;
});
// Tippen in den Notizen darf keine Tastenkürzel der Leinwand auslösen.
notesBox.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey && e.key.toLowerCase() === "s")) e.stopPropagation(); // Strg+S speichert auch von hier
  if (e.key === "Escape") notesBox.blur();
});

// ---------- Referentenansicht ----------
// Ein zweites Fenster auf dem eigenen Bildschirm: Notizen, aktueller und nächster Schritt, Zeit.
// Es bekommt den Stand per Ereignis und schickt Weiter/Zurück/Beenden zurück.
let presenterOpen = false;

function stepName(i) {
  const s = doc.path[i];
  if (s === undefined) return "";
  return isAnim(s) ? animLabel(s) : (stepLabel(byId.get(s)) ?? s);
}

function sendPresenter() {
  if (!presenterOpen) return;
  tauri.event
    .emitTo("presenter", "presenter-state", {
      index: pathIndex,
      total: doc.path.length,
      title: stepName(pathIndex),
      notes: noteHolder(pathIndex)?.notes ?? "",
      next: stepName(pathIndex + 1),
    })
    .catch(() => {});
  sendPresenterThumbs(pathIndex);
}

// Vorschaubilder des aktuellen und nächsten Schritts; während des Präsentierens ändert sich nichts, also zwischenspeichern.
const thumbCache = new Map();
async function stepThumb(i) {
  if (!thumbCache.has(i)) {
    const w = 640;
    thumbCache.set(i, thumbnail(i, w, Math.round(w / aspectRatio())).catch(() => null));
  }
  return thumbCache.get(i);
}

async function sendPresenterThumbs(i) {
  const [cur, next] = await Promise.all([stepThumb(i), stepThumb(i + 1)]);
  if (!presenterOpen || i !== pathIndex) return; // inzwischen weitergeblättert
  tauri.event.emitTo("presenter", "presenter-thumbs", { cur, next }).catch(() => {});
}

async function openPresenter(monitor) {
  thumbCache.clear();
  const s = monitor.scaleFactor || 1;
  try {
    new tauri.webviewWindow.WebviewWindow("presenter", {
      url: "presenter.html",
      title: "Weitblick – Referentenansicht",
      x: monitor.position.x / s + 40,
      y: monitor.position.y / s + 40,
      width: 1000,
      height: 650,
      maximized: true,
    });
    presenterOpen = true;
  } catch (err) {
    window.__screenError = String(err?.message ?? err);
  }
}

async function closePresenter() {
  if (!presenterOpen) return;
  presenterOpen = false;
  (await tauri.webviewWindow.WebviewWindow.getByLabel("presenter"))?.destroy().catch(() => {});
}

// Ein gedrehter Rahmen wird aufrecht angeflogen: die Kamera dreht sich mit.
function frameState(id) {
  const o = byId.get(id);
  return { ...fitRect(o, viewport.clientWidth, viewport.clientHeight), rot: o.rot ?? 0 };
}

function goTo(i) {
  pathIndex = Math.max(0, Math.min(doc.path.length - 1, i));
  offPath = false;
  markActive();
  updateProgress();
  if (presenting) applyVisibility(pathIndex);
  // Übergang gilt beim Präsentieren; im Editor fliegt die Kamera immer.
  moveCamera(stepCamera(pathIndex), presenting ? noteHolder(pathIndex)?.transition : null);
  // Ein Video, auf das der Pfad zoomt, startet; alle anderen halten an.
  for (const o of doc.objects) {
    if (o.type !== "video") continue;
    const v = elOf(o)?.querySelector("video");
    if (presenting && doc.path[pathIndex] === o.id) v?.play().catch(() => {});
    else v?.pause();
  }
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
// Gehört es zu einer Gruppe, gilt das für die ganze Gruppe.
function select(o, additive = false) {
  if (!o) return setSelection([]);
  const group = groupOf(o);
  if (!additive) setSelection(group);
  else if (selection.includes(o)) setSelection(selection.filter((p) => !group.includes(p)));
  else setSelection([...selection, ...group.filter((p) => !selection.includes(p))]);
}

// ---------- Gruppen ----------
// Objekte mit gleichem „group“ werden gemeinsam ausgewählt, bewegt, kopiert und gelöscht.

function groupOf(o) {
  return o.group ? doc.objects.filter((p) => p.group === o.group) : [o];
}

// Ist genau eine ganze Gruppe ausgewählt? Dann zeigt ein gestrichelter Kasten sie als einen Block,
// mit einem Anfasser zum gemeinsamen Skalieren.
function selectedGroup() {
  const g = selection[0]?.group;
  if (!g || !selection.every((o) => o.group === g)) return null;
  return groupOf(selection[0]).length === selection.length ? g : null;
}

function selectionBox() {
  // Unsichtbare Unterschritt-Rahmen nicht mitzählen, sonst wirkt der Kasten zu groß.
  const shown = selection.filter((o) => !o.hidden);
  const list = shown.length ? shown : selection;
  const x1 = Math.min(...list.map((o) => o.x));
  const y1 = Math.min(...list.map((o) => o.y));
  const x2 = Math.max(...list.map((o) => o.x + o.w));
  const y2 = Math.max(...list.map((o) => o.y + o.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const groupBox = document.createElement("div");
groupBox.className = "group-box";
groupBox.innerHTML = `<div class="handle group-handle"></div>`;

function updateGroupBox() {
  const on = !!selectedGroup() && !presenting;
  // Bei einer ganzen Gruppe nur den gemeinsamen Kasten zeigen, nicht jeden Teil einzeln umranden.
  world.classList.toggle("group-mode", on);
  if (!on) return groupBox.remove();
  const b = selectionBox();
  Object.assign(groupBox.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
  if (groupBox.parentNode !== world) world.append(groupBox);
}

function groupSelection() {
  const items = selection.filter((o) => !o.hidden);
  if (items.length < 2) return;
  checkpoint();
  const id = `g-${Date.now().toString(36)}`;
  for (const o of items) o.group = id;
  setSelection(items);
}

function ungroupSelection() {
  const items = selection.filter((o) => o.group);
  if (!items.length) return;
  checkpoint();
  for (const o of items) delete o.group;
  setSelection(items);
}

function setSelection(list) {
  const prev = selection;
  selection = list;
  selected = list.at(-1) ?? null;
  for (const p of new Set([...prev, ...list])) if (byId.has(p.id)) updateEl(p);
  markFrameMembers();
  updateGroupBox();
  updateToolbar();
}

function selectAll() {
  setSelection(doc.objects.filter((o) => !o.hidden && !o.locked));
}

// Was gehört zu einem Rahmen? Ein Objekt mit Eintrag „frame“ gehört fest zu diesem Rahmen
// (null: ausdrücklich zu keinem); ohne Eintrag zählt, ob es ganz im Rahmen liegt.
function membersOf(f) {
  // Unsichtbare Unterschritt-Rahmen zählen mit, wenn sie fest zugeordnet sind; der Überblick nie.
  return doc.objects.filter((p) => p !== f && (p.frame !== undefined ? p.frame === f.id : !p.hidden && inside(p, f)));
}

// Rahmen nehmen ihren Inhalt mit (beim Verschieben und Kopieren).
function withContents(list) {
  const result = new Set(list);
  for (const f of list) if (f.type === "frame") membersOf(f).forEach((p) => result.add(p));
  // In der Reihenfolge der Leinwand, damit Ebenen beim Kopieren erhalten bleiben.
  return doc.objects.filter((o) => result.has(o));
}

// Bei einem ausgewählten Rahmen ist sein Inhalt gestrichelt markiert.
function markFrameMembers() {
  world.querySelectorAll(".frame-member").forEach((e) => e.classList.remove("frame-member"));
  if (selection.length !== 1 || selected?.type !== "frame") return;
  for (const p of membersOf(selected)) elOf(p)?.classList.add("frame-member");
}

// ---------- Maße, Ausrichten, Angleichen ----------
// Eine Gruppe zählt als eine Einheit; Rahmen nehmen beim Verschieben ihren Inhalt mit.

function boxOf(list) {
  const x = Math.min(...list.map((o) => o.x));
  const y = Math.min(...list.map((o) => o.y));
  return { x, y, w: Math.max(...list.map((o) => o.x + o.w)) - x, h: Math.max(...list.map((o) => o.y + o.h)) - y };
}

function arrangeUnits() {
  const map = new Map();
  for (const o of selection) {
    if (o.hidden) continue;
    const k = o.group ?? o.id;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(o);
  }
  return [...map.values()].map((items) => ({ items, ...boxOf(items) }));
}

function moveUnit(u, dx, dy) {
  for (const p of withContents(u.items)) {
    p.x += dx;
    p.y += dy;
    updateEl(p);
  }
  u.x += dx;
  u.y += dy;
}

// Skaliert eine Einheit um ihre linke obere Ecke. Schriften wachsen nur bei Gruppen und nur gleichmäßig mit.
function scaleUnit(u, w, h) {
  const fx = w / u.w;
  const fy = h / u.h;
  for (const p of u.items) {
    p.x = u.x + (p.x - u.x) * fx;
    p.y = u.y + (p.y - u.y) * fy;
    p.w *= fx;
    p.h *= fy;
    if (p.size && u.items.length > 1 && Math.abs(fx - fy) < 1e-9) p.size *= fx;
    updateEl(p);
  }
  u.w = w;
  u.h = h;
}

function arrange(op) {
  const units = arrangeUnits();
  if (units.length < 2) return;
  checkpoint();
  const all = boxOf(units);
  const ref = units[0]; // zuerst ausgewählt
  for (const u of units) {
    if (op === "left") moveUnit(u, all.x - u.x, 0);
    if (op === "hcenter") moveUnit(u, all.x + all.w / 2 - (u.x + u.w / 2), 0);
    if (op === "right") moveUnit(u, all.x + all.w - (u.x + u.w), 0);
    if (op === "top") moveUnit(u, 0, all.y - u.y);
    if (op === "vcenter") moveUnit(u, 0, all.y + all.h / 2 - (u.y + u.h / 2));
    if (op === "bottom") moveUnit(u, 0, all.y + all.h - (u.y + u.h));
    if (op === "same-w") scaleUnit(u, ref.w, u.h);
    if (op === "same-h") scaleUnit(u, u.w, ref.h);
    if (op === "same-size") scaleUnit(u, ref.w, ref.h);
  }
  // Verteilen: gleiche Abstände zwischen den Einheiten, die äußeren bleiben stehen.
  if (op === "dist-h" || op === "dist-v") {
    const [p, s] = op === "dist-h" ? ["x", "w"] : ["y", "h"];
    const sorted = [...units].sort((a, b) => a[p] - b[p]);
    const gap = (all[s] - sorted.reduce((t, u) => t + u[s], 0)) / (sorted.length - 1);
    let at = all[p];
    for (const u of sorted) {
      const d = at - u[p];
      moveUnit(u, p === "x" ? d : 0, p === "y" ? d : 0);
      at += u[s] + gap;
    }
  }
  updateGroupBox();
  updateToolbar();
}

// Mehrere Tastendrücke kurz hintereinander sind ein Rückgängig-Schritt.
let nudgeAt = 0;
function nudge([dx, dy], px) {
  if (Date.now() - nudgeAt > 700) checkpoint();
  nudgeAt = Date.now();
  const d = px / zoom();
  for (const u of arrangeUnits()) moveUnit(u, dx * d, dy * d);
  updateGroupBox();
  positionContextBar();
  updateGeomFields();
}

// ---------- Format übertragen (Pinsel) ----------
// Gleicher Typ: alle Formatangaben; anderer Typ: nur die Farbe. Der Pinsel wirkt auf den nächsten Klick.
const FORMAT_KEYS = ["color", "fill", "stroke", "fillOpacity", "fade", "radius", "font", "size", "weight", "italic", "align", "lh", "bg", "bgPad", "role"];
let formatClip = null;
let painting = false;

function copyFormat() {
  if (!selected) return;
  formatClip = { type: selected.type, keys: Object.fromEntries(FORMAT_KEYS.filter((k) => k in selected).map((k) => [k, structuredClone(selected[k])])) };
}

function pasteFormat(list = selection) {
  if (!formatClip || !list.length) return;
  checkpoint();
  for (const o of list) {
    if (o.type === formatClip.type) {
      for (const k of FORMAT_KEYS) {
        if (k in formatClip.keys) o[k] = structuredClone(formatClip.keys[k]);
        else delete o[k];
      }
    } else {
      const c = formatClip.keys.color ?? formatClip.keys.fill;
      if (c && colorKey(o)) o[colorKey(o)] = c;
    }
    updateEl(o);
  }
  updateToolbar();
}

function setPainting(on) {
  painting = on;
  document.body.classList.toggle("painting", on);
  document.getElementById("btn-format").classList.toggle("on", on);
}

document.getElementById("btn-format").addEventListener("click", () => {
  if (painting) return setPainting(false);
  copyFormat();
  setPainting(!!formatClip);
});

// ---------- Bild ersetzen ----------
// Lage, Breite und Zuschnitt bleiben; ohne Zuschnitt passt sich die Höhe dem neuen Bild an (Mitte bleibt).
async function replaceImage(o) {
  const path = await tauri.dialog.open({ multiple: false, filters: [{ name: "Bilder", extensions: Object.keys(MIME).filter((x) => !isVideo(`x.${x}`)) }] });
  if (!path) return;
  try {
    const file = await tauri.core.invoke("import_media", { path });
    const src = `media/${newId("i")}.${extOf(file.name)}`;
    addMedia(src, file.data);
    const size = await imageSize(media.get(src).url);
    checkpoint();
    if (!o.crop) {
      const mid = o.y + o.h / 2;
      o.h = (o.w * size.h) / size.w;
      o.y = mid - o.h / 2;
    }
    o.src = src;
    delete o.link; // eine verknüpfte Grafik zeigt nun ein anderes Bild
    delete o.source;
    updateEl(o);
    updateToolbar();
  } catch (err) {
    await tauri.dialog.message(String(err?.message ?? err), { title: "Bild ersetzen", kind: "error" });
  }
}

// Fixierte Objekte lassen sich nicht anklicken, verschieben oder per Rechteck auswählen.
function lockSelection() {
  const items = selection.filter((o) => !o.hidden);
  if (!items.length) return;
  checkpoint();
  for (const o of items) o.locked = true;
  select(null);
}

function unlock(list) {
  if (!list.length) return;
  checkpoint();
  for (const o of list) delete o.locked;
  setSelection(list);
}

function lockedAt(e) {
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    const o = byId.get(el.closest?.(".obj")?.dataset.id);
    if (o?.locked) return o;
  }
  return null;
}

function arrangeMenuItems() {
  const n = arrangeUnits().length;
  return [
    { label: "Links ausrichten", run: () => arrange("left") },
    { label: "Horizontal zentrieren", run: () => arrange("hcenter") },
    { label: "Rechts ausrichten", run: () => arrange("right") },
    { label: "Oben ausrichten", run: () => arrange("top") },
    { label: "Vertikal zentrieren", run: () => arrange("vcenter") },
    { label: "Unten ausrichten", run: () => arrange("bottom") },
    "-",
    n > 2 && { label: "Horizontal verteilen", run: () => arrange("dist-h") },
    n > 2 && { label: "Vertikal verteilen", run: () => arrange("dist-v") },
    "-",
    { label: "Gleiche Breite (wie zuerst gewählt)", run: () => arrange("same-w") },
    { label: "Gleiche Höhe (wie zuerst gewählt)", run: () => arrange("same-h") },
    { label: "Gleiche Größe (wie zuerst gewählt)", run: () => arrange("same-size") },
  ].filter(Boolean);
}

document.getElementById("btn-arrange").addEventListener("click", (e) => {
  e.stopPropagation();
  const b = e.currentTarget.getBoundingClientRect();
  buildMenu(arrangeMenuItems(), ctxMenu);
  ctxMenu.classList.add("open");
  ctxMenu.style.left = `${b.left}px`;
  ctxMenu.style.top = `${b.bottom + 4}px`;
});

// Maße-Feld: bei einer Einheit deren Kasten, bei mehreren gilt Breite/Höhe/Drehung für jede, X/Y verschiebt alle.
const geoPop = document.getElementById("geo-pop");
const geo = Object.fromEntries(["w", "h", "x", "y", "r", "lock"].map((k) => [k, document.getElementById(`geo-${k}`)]));
const round = (v) => Math.round(v * 10) / 10;

function updateGeomFields() {
  if (geoPop.hidden) return;
  const units = arrangeUnits();
  if (!units.length) {
    geoPop.hidden = true;
    return;
  }
  const all = boxOf(units);
  const one = units.length === 1;
  for (const k of ["w", "h", "x", "y", "r"]) if (document.activeElement !== geo[k]) geo[k].value = "";
  if (document.activeElement !== geo.x) geo.x.value = round(all.x);
  if (document.activeElement !== geo.y) geo.y.value = round(all.y);
  if (one && document.activeElement !== geo.w) geo.w.value = round(all.w);
  if (one && document.activeElement !== geo.h) geo.h.value = round(all.h);
  const rots = new Set(selection.filter((o) => !o.hidden).map((o) => o.rot ?? 0));
  if (rots.size === 1 && document.activeElement !== geo.r) geo.r.value = round([...rots][0]);
  geo.lock.checked ||= selected?.type === "image" && one;
  document.getElementById("geo-note").textContent = one ? "" : `${units.length} Objekte: Breite, Höhe und Drehung gelten für jedes.`;
}

function applyGeom(key) {
  const v = Number(geo[key].value);
  if (geo[key].value === "" || !Number.isFinite(v) || ((key === "w" || key === "h") && v <= 0)) return;
  const units = arrangeUnits();
  if (!units.length) return;
  checkpoint();
  if (key === "x" || key === "y") {
    const all = boxOf(units);
    for (const u of units) moveUnit(u, key === "x" ? v - all.x : 0, key === "y" ? v - all.y : 0);
  } else if (key === "w" || key === "h") {
    for (const u of units) {
      const w = key === "w" ? v : geo.lock.checked ? (v * u.w) / u.h : u.w;
      const h = key === "h" ? v : geo.lock.checked ? (v * u.h) / u.w : u.h;
      scaleUnit(u, w, h);
    }
  } else if (key === "r") {
    for (const o of selection.filter((o) => !o.hidden)) {
      o.rot = ((v % 360) + 360) % 360 || 0;
      updateEl(o);
    }
  }
  updateGroupBox();
  updateToolbar();
}

for (const k of ["w", "h", "x", "y", "r"]) {
  geo[k].addEventListener("change", () => applyGeom(k));
  geo[k].addEventListener("keydown", (e) => {
    if (!(e.ctrlKey && e.key.toLowerCase() === "s")) e.stopPropagation(); // Ziffern, Entf, Pfeile gehören dem Feld; Strg+S speichert
    if (e.key === "Enter") geo[k].blur();
    if (e.key === "Escape") geoPop.hidden = true;
  });
}

// Klicks und Mausrad im Feld gehören nicht der Leinwand darunter.
for (const ev of ["pointerdown", "wheel", "dblclick", "contextmenu"]) geoPop.addEventListener(ev, (e) => e.stopPropagation());

document.getElementById("btn-geometry").addEventListener("click", (e) => {
  e.stopPropagation();
  geoPop.hidden = !geoPop.hidden;
  const b = e.currentTarget.getBoundingClientRect();
  const v = viewport.getBoundingClientRect();
  geoPop.style.left = `${Math.min(b.left - v.left, v.width - 260)}px`;
  geoPop.style.top = `${b.bottom - v.top + 6}px`;
  updateGeomFields();
});

// ---------- Ebenen: nach vorn und nach hinten ----------
// Die Reihenfolge in doc.objects ist die Zeichenreihenfolge; der unsichtbare Überblick bleibt immer ganz hinten.

function reorder(mode) {
  const sel = new Set(selection.filter((o) => !o.hidden));
  if (!sel.size) return;
  checkpoint();
  const fixed = doc.objects.filter((o) => o.hidden);
  let rest = doc.objects.filter((o) => !o.hidden);
  if (mode === "front" || mode === "back") {
    const moved = rest.filter((o) => sel.has(o));
    const others = rest.filter((o) => !sel.has(o));
    rest = mode === "front" ? [...others, ...moved] : [...moved, ...others];
  } else {
    // Einen Schritt: an jedem nicht gewählten Nachbarn vorbei, der in dieser Richtung liegt.
    const order = mode === "forward" ? [...rest].reverse() : [...rest];
    for (let i = 1; i < order.length; i++) {
      if (sel.has(order[i]) && !sel.has(order[i - 1])) [order[i - 1], order[i]] = [order[i], order[i - 1]];
    }
    rest = mode === "forward" ? order.reverse() : order;
  }
  doc.objects = [...fixed, ...rest];
  const keep = [...selection];
  buildWorld();
  setSelection(keep);
}

// ---------- Rahmen: Objekte hinzufügen und herauslösen ----------

// Gewählter Rahmen plus andere Objekte: die Objekte gehören danach fest zum Rahmen;
// er wächst bei Bedarf, damit sie hineinpassen, und rückt hinter seinen Inhalt.
function frameTarget() {
  const frames = selection.filter((o) => o.type === "frame" && !o.hidden);
  return frames.length === 1 && selection.length > 1 ? frames[0] : null;
}

function addToFrame() {
  const f = frameTarget();
  if (!f) return;
  checkpoint();
  const items = selection.filter((o) => o !== f);
  for (const o of items) o.frame = f.id;
  const pad = Math.min(f.w, f.h) * 0.04;
  const x1 = Math.min(f.x, ...items.map((o) => o.x - pad));
  const y1 = Math.min(f.y, ...items.map((o) => o.y - pad));
  const x2 = Math.max(f.x + f.w, ...items.map((o) => o.x + o.w + pad));
  const y2 = Math.max(f.y + f.h, ...items.map((o) => o.y + o.h + pad));
  Object.assign(f, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  const first = Math.min(...items.map((o) => doc.objects.indexOf(o)));
  if (doc.objects.indexOf(f) > first) {
    doc.objects = doc.objects.filter((o) => o !== f);
    doc.objects.splice(first, 0, f);
  }
  buildWorld();
  setSelection([f]);
}

// Gewählte Objekte gehören zu keinem Rahmen mehr (auch wenn sie darin liegen).
function removeFromFrame() {
  const items = selection.filter((o) => o.type !== "frame" || selection.length > 1).filter((o) => inAnyFrame(o));
  if (!items.length) return;
  checkpoint();
  for (const o of items) o.frame = null;
  setSelection(items);
}

function inAnyFrame(o) {
  return doc.objects.some((f) => f.type === "frame" && !f.hidden && f !== o && membersOf(f).includes(o));
}

// ---------- Abgerundete Ecken ----------
// radius: 0..50 (Prozent der kürzeren Seite). Das abgerundete Rechteck startet bei 12.

const NO_CORNERS = new Set(["ellipse", "half-circle", "cylinder", "ring", "cloud", "heart", "drop", "moon", "bubble-round", "world", "pin"]);

function cornerRadius(o) {
  return o.radius ?? (o.shape === "rounded" ? 12 : 0);
}

function hasCorners(o) {
  if (!o || o.hidden) return false;
  if (o.type === "frame" || o.type === "image") return true;
  return o.type === "shape" && !NO_CORNERS.has(o.shape);
}

const radiusInput = document.getElementById("inp-radius");
let radiusBefore = null;
radiusInput.addEventListener("pointerdown", () => (radiusBefore = snapshot()));
radiusInput.addEventListener("input", () => {
  radiusBefore ??= snapshot();
  for (const o of selection.filter(hasCorners)) {
    o.radius = Number(radiusInput.value);
    updateEl(o);
  }
});
radiusInput.addEventListener("change", () => {
  if (radiusBefore && radiusBefore !== snapshot()) checkpoint(radiusBefore);
  radiusBefore = null;
});

function updateToolbar() {
  const isText = selected?.type === "text";
  const colored = colorKey(selected) !== null;
  document.querySelectorAll("[data-needs]").forEach((b) => {
    const need = b.dataset.needs;
    b.disabled =
      !selected ||
      (need === "text" && !isText) ||
      (need === "color" && !colored) ||
      (need === "image" && selected.type !== "image") ||
      (need === "frame-add" && !frameTarget()) ||
      (need === "frame-remove" && !selection.some((o) => o.type !== "frame" && inAnyFrame(o))) ||
      (need === "multi" && arrangeUnits().length < 2) ||
      (need === "radius" && !selection.some(hasCorners));
    // In der Kontextleiste steht nur, was zum ausgewählten Objekt passt.
    if (formatbar.contains(b)) (b.closest("label") ?? b).hidden = b.disabled;
  });
  document.querySelector(".radius-ctl").hidden = !selection.some(hasCorners);
  let first = true;
  for (const g of formatbar.querySelectorAll(".fb-group")) {
    g.hidden = ![...g.children].some((c) => !c.hidden);
    g.classList.toggle("first", !g.hidden && first);
    if (!g.hidden) first = false;
  }
  if (selected && hasCorners(selected)) radiusInput.value = cornerRadius(selected);
  // Formatleiste zeigt den Zustand des ausgewählten Objekts.
  formatbar.classList.toggle("visible", !!selected && !presenting);
  positionContextBar();
  if (!selected || presenting) geoPop.hidden = true;
  updateGeomFields();
  if (!selected) return;
  if (colored) colorInput.value = toHex(selected[colorKey(selected)] ?? defaultColor(selected));
  if (isText) {
    ensureFontOption(textFont(selected));
    fontSelect.value = textFont(selected);
    roleSelect.value = selected.role ?? "body";
    document.getElementById("btn-bold").classList.toggle("on", textWeight(selected) >= 600);
    document.getElementById("btn-italic").classList.toggle("on", textItalic(selected));
    document.getElementById("btn-list").classList.toggle("on", isBulleted(selected));
    document.getElementById("btn-align").textContent = ALIGN_ICONS[selected.align ?? "left"];
  }
}

// ---------- Farben und Textformat ----------

const FONTS = {
  sans: '"Segoe UI", "Noto Sans", "DejaVu Sans", sans-serif',
  serif: 'Georgia, "Noto Serif", "DejaVu Serif", serif',
  mono: 'Consolas, "DejaVu Sans Mono", monospace',
  // Comfortaa Bold, fest in der App (assets/), deshalb auch offline ohne Einbetten verfügbar.
  "Weitblick Brand": '"Weitblick Brand", "Segoe UI", sans-serif',
};
const ALIGNS = ["left", "center", "right"];
const ALIGN_ICONS = { left: "⇤", center: "⇔", right: "⇥" };

const formatbar = document.getElementById("formatbar");
const colorInput = document.getElementById("inp-color");
const fontSelect = document.getElementById("sel-font");
// Knöpfe der Formatleiste nehmen dem bearbeiteten Text nicht den Fokus: so wirken B und I auf die Markierung.
formatbar.addEventListener("mousedown", (e) => {
  if (e.target.closest("button")) e.preventDefault();
});

// Welches Feld eines Objekts die Farbe trägt.
function colorKey(o) {
  return { text: "color", icon: "color", shape: "fill", frame: "fill" }[o?.type] ?? null;
}

// Eine eigens gewählte Schrift gewinnt, sonst gilt die Schrift des Stils für die Rolle des Textes.
function textFont(o) {
  return o.font ?? doc.theme.fonts?.[o.role ?? "body"] ?? "sans";
}

// Fett und kursiv: eigene Einstellung am Text, sonst die des Stils für seine Rolle.
function textWeight(o) {
  return o.weight ?? (doc.theme.bold?.[o.role ?? "body"] ? 700 : 400);
}

function textItalic(o) {
  return o.italic ?? !!doc.theme.italic?.[o.role ?? "body"];
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
  // Beim Bearbeiten markierte Wörter: nur sie einfärben.
  const r = selected?.type === "text" && editedRange(selected);
  if (r) return formatRange(selected, r, (sts) => sts.map((st) => ({ ...st, c: colorInput.value })), false);
  for (const o of targets) {
    o[colorKey(o)] = colorInput.value;
    updateEl(o);
  }
});
colorInput.addEventListener("change", () => {
  if (colorBefore && colorBefore !== snapshot()) checkpoint(colorBefore);
  colorBefore = null;
});

fontSelect.addEventListener("change", () => addGoogleFont(fontSelect.value));

const roleSelect = document.getElementById("sel-role");
// Rolle wechseln: der Text folgt dann der Stilschrift dieser Rolle (eigene Schriftwahl wird aufgehoben).
roleSelect.addEventListener("change", () =>
  format((o) => {
    o.role = roleSelect.value;
    delete o.font;
  }, isText),
);

// ---------- Gemischte Formatierung ----------
// o.spans = [{ s, e, b?, i?, c? }]: Abschnitte von o.text mit eigener Fettung, Kursivschrift oder Farbe
// (b/i: true/false, c: Farbe). Ohne spans gilt das Format des ganzen Textes.

const runStyle = (r) => ({
  ...(r.b !== undefined && { fontWeight: r.b ? "700" : "400" }),
  ...(r.i !== undefined && { fontStyle: r.i ? "italic" : "normal" }),
  ...(r.c && { color: r.c }),
});

// Hängt text (steht in o.text ab Position at) an parent an, formatierte Abschnitte als <span>.
function appendRich(parent, text, spans, at) {
  const cuts = new Set([0, text.length]);
  for (const r of spans ?? []) for (const x of [r.s - at, r.e - at]) if (x > 0 && x < text.length) cuts.add(x);
  const pts = [...cuts].sort((a, b) => a - b);
  for (let k = 0; k + 1 < pts.length; k++) {
    const piece = text.slice(pts[k], pts[k + 1]);
    const r = spans?.find((r) => r.s <= at + pts[k] && r.e >= at + pts[k + 1]);
    if (!r) parent.append(piece);
    else {
      const sp = document.createElement("span");
      Object.assign(sp.style, runStyle(r));
      sp.textContent = piece;
      parent.append(sp);
    }
  }
}

const rgbHex = (c) => {
  const m = c.match(/\d+(\.\d+)?/g);
  return m && c.startsWith("rgb") ? `#${m.slice(0, 3).map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("")}` : c;
};

function baseStyle(o) {
  return { b: textWeight(o) >= 600, i: textItalic(o), c: rgbHex(toHex(o.color || doc.theme.text)).toLowerCase() };
}

// Pro Zeichen das eigene Format; packSpans fasst wieder zusammen und lässt weg, was dem Grundformat entspricht.
function charStyles(o) {
  const a = Array.from({ length: o.text.length }, () => ({}));
  for (const { s, e, ...st } of o.spans ?? []) for (let k = s; k < e && k < a.length; k++) a[k] = { ...st };
  return a;
}

function packSpans(o, styles) {
  const base = baseStyle(o);
  const out = [];
  styles.forEach((st, k) => {
    const c = {};
    if (st.b !== undefined && st.b !== base.b) c.b = st.b;
    if (st.i !== undefined && st.i !== base.i) c.i = st.i;
    if (st.c && st.c.toLowerCase() !== base.c) c.c = st.c;
    if (!Object.keys(c).length) return;
    const last = out.at(-1);
    if (last && last.e === k && last.b === c.b && last.i === c.i && last.c === c.c) last.e = k + 1;
    else out.push({ s: k, e: k + 1, ...c });
  });
  if (out.length) o.spans = out;
  else delete o.spans;
}

// Liest Text und Format pro Zeichen aus dem bearbeiteten Element. Der Text kommt aus innerText (Zeilen wie im
// Browser); jeder Textknoten wird darin der Reihe nach wiedergefunden, so lassen sich Format und Auswahl zuordnen.
function readRich(el) {
  const text = el.innerText.replace(/​/g, "");
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let at = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const d = n.data.replace(/​/g, "");
    if (!d) {
      nodes.push({ node: n, start: at, len: 0 });
      continue;
    }
    const idx = text.indexOf(d, at);
    if (idx < 0) continue;
    nodes.push({ node: n, start: idx, len: d.length });
    at = idx + d.length;
  }
  const styles = Array.from({ length: text.length }, () => ({}));
  for (const { node, start, len } of nodes) {
    if (!len) continue;
    const cs = getComputedStyle(node.parentElement);
    const st = { b: parseInt(cs.fontWeight, 10) >= 600, i: cs.fontStyle === "italic", c: rgbHex(cs.color) };
    for (let k = start; k < start + len; k++) styles[k] = st;
  }
  return { text, styles, nodes };
}

// Auswahl im bearbeiteten Element als Positionen [s, e) im Text (null ohne Auswahl).
function editSelection(el) {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !el.contains(sel.anchorNode)) return null;
  const { nodes } = readRich(el);
  const textNodes = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const out = [];
    for (let x = w.nextNode(); x; x = w.nextNode()) out.push(x);
    return out;
  };
  const pos = (node, off) => {
    if (node.nodeType !== 3) {
      const child = node.childNodes[off];
      const t = child ? textNodes(child)[0] ?? (child.nodeType === 3 ? child : null) : textNodes(node).at(-1);
      if (!t) return child ? (nodes.find((n) => node.compareDocumentPosition(n.node) & Node.DOCUMENT_POSITION_FOLLOWING)?.start ?? 0) : 0;
      [node, off] = child ? [t, 0] : [t, t.data.length];
    }
    const hit = nodes.find((n) => n.node === node);
    return hit ? hit.start + node.data.slice(0, off).replace(/​/g, "").length : 0;
  };
  const a = pos(sel.anchorNode, sel.anchorOffset);
  const b = pos(sel.focusNode, sel.focusOffset);
  return a === b ? null : [Math.min(a, b), Math.max(a, b)];
}

// Setzt die Auswahl im Element wieder auf [s, e) (nach dem Neuzeichnen beim Formatieren).
function selectRange(el, s, e) {
  const { nodes } = readRich(el);
  const at = (p) => {
    const n = nodes.find((n) => n.len && p >= n.start && p <= n.start + n.len) ?? nodes.find((n) => n.len && n.start >= p);
    return n ? [n.node, Math.min(n.len, Math.max(0, p - n.start))] : [el, 0];
  };
  const r = document.createRange();
  r.setStart(...at(s));
  r.setEnd(...at(e));
  getSelection().removeAllRanges();
  getSelection().addRange(r);
}

// Zuletzt markierter Bereich beim Bearbeiten: so wirkt auch der Farbwähler (der den Fokus nimmt) nur darauf.
let lastEditRange = null;
document.addEventListener("selectionchange", () => {
  const el = document.activeElement;
  if (el?.classList?.contains("text") && el.isContentEditable) {
    const r = editSelection(el);
    lastEditRange = r ? { id: el.dataset.id, s: r[0], e: r[1] } : null;
  }
});

function editedRange(o) {
  const el = elOf(o);
  if (el?.isContentEditable) {
    const r = editSelection(el);
    return r ? { el, s: r[0], e: r[1] } : null;
  }
  return lastEditRange?.id === o.id ? { el: null, s: lastEditRange.s, e: lastEditRange.e } : null;
}

// Bearbeiteten Inhalt ins Modell übernehmen, ohne die Bearbeitung zu beenden.
function syncEditing(el) {
  const o = byId.get(el.dataset.id);
  if (!o) return false;
  const { text, styles } = readRich(el);
  const copy = { ...o, text };
  packSpans(copy, styles);
  if (JSON.stringify([text, copy.spans]) === JSON.stringify([o.text, o.spans])) return false;
  checkpoint();
  o.text = text;
  if (copy.spans) o.spans = copy.spans;
  else delete o.spans;
  return true;
}

// Format nur für einen Bereich: beim Bearbeiten erst den Stand übernehmen, danach neu zeichnen und die
// Auswahl wiederherstellen; sonst direkt am Modell.
function formatRange(o, r, change, undoStep = true) {
  if (r.el) syncEditing(r.el);
  if (undoStep) checkpoint();
  const styles = charStyles(o);
  change(styles.slice(r.s, r.e), baseStyle(o)).forEach((st, k) => (styles[r.s + k] = st));
  packSpans(o, styles);
  if (r.el) {
    renderText(o, r.el);
    selectRange(r.el, r.s, r.e);
  } else updateEl(o);
}

// Der neue Zustand richtet sich nach dem zuletzt gewählten Text und gilt dann für alle.
function toggleBold() {
  if (selected?.type !== "text") return;
  const r = editedRange(selected);
  if (r)
    return formatRange(selected, r, (sts, base) => {
      const on = !sts.every((st) => st.b ?? base.b);
      return sts.map((st) => ({ ...st, b: on }));
    });
  const weight = textWeight(selected) >= 600 ? 400 : 700;
  format((o) => (o.weight = weight), isText);
}

function toggleItalic() {
  if (selected?.type !== "text") return;
  const r = editedRange(selected);
  if (r)
    return formatRange(selected, r, (sts, base) => {
      const on = !sts.every((st) => st.i ?? base.i);
      return sts.map((st) => ({ ...st, i: on }));
    });
  const italic = !textItalic(selected);
  format((o) => (o.italic = italic), isText);
}

// Aufzählung an/aus: jede nicht leere Zeile bekommt „• “ (oder verliert es). Tiefer einrücken: drei Leerzeichen
// vor dem Punkt, beim Bearbeiten mit Tab (siehe startEditing).
const isBulleted = (o) => o.text.split("\n").filter((l) => l.trim()).every((l) => /^ *• /.test(l));

function toggleBullets() {
  if (selected?.type !== "text") return;
  const on = !isBulleted(selected);
  format((o) => {
    const lines = o.text.split("\n");
    const next = lines.map((l) => (!l.trim() ? l : on ? (/^ *• /.test(l) ? l : `• ${l}`) : l.replace(/^ *• /, "")));
    // Formatabschnitte mitschieben: jede Zeile ändert sich nur am Anfang.
    const st = charStyles(o);
    const out = [];
    let pos = 0;
    lines.forEach((l, k) => {
      const ls = st.slice(pos, pos + l.length);
      const d = next[k].length - l.length;
      out.push(...(d >= 0 ? [...Array(d).fill({}), ...ls] : ls.slice(-d)));
      if (k < lines.length - 1) out.push({});
      pos += l.length + 1;
    });
    o.text = next.join("\n");
    packSpans(o, out);
  }, isText);
}

function cycleAlign() {
  if (selected?.type !== "text") return;
  const align = ALIGNS[(ALIGNS.indexOf(selected.align ?? "left") + 1) % ALIGNS.length];
  format((o) => (o.align = align), isText);
}

function startEditing(o) {
  const el = elOf(o);
  el.querySelectorAll(".handle, .rot-handle").forEach((h) => h.remove()); // sonst landen die Anfasser im Text
  lastEditRange = null;
  // „true“ statt „plaintext-only“: markierte Wörter lassen sich einzeln formatieren (Strg+B/I, Farbe).
  el.contentEditable = "true";
  el.focus();
  document.getSelection().selectAllChildren(el);
}

function finishEditing(el) {
  if (!el.isContentEditable) return;
  const o = byId.get(el.dataset.id);
  if (o) syncEditing(el); // Text und Formatabschnitte übernehmen (Platzhalter leerer Zeilen fallen weg)
  el.contentEditable = "false";
  if (o) updateEl(o, el);
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

// Neues Objekt in der Mitte der aktuellen Ansicht (oder um den Punkt at), passend zur Zoomstufe.
function addObject(kind, at = null) {
  checkpoint();
  const vw = camera.w;
  const base = { x: 0, y: 0 };
  let o;
  if (kind === "text") {
    o = { ...base, id: newId("t"), type: "text", w: vw * 0.4, h: vw * 0.08, text: "Neuer Text", size: vw * 0.035 };
  } else if (kind === "frame") {
    o = { ...base, id: newId("f"), type: "frame", w: vw * 0.6, h: (vw * 0.6) / aspectRatio(), title: "Neuer Rahmen" };
  } else {
    const [sw, sh] = SHAPES.find((s) => s.id === kind)?.size ?? [1, 1];
    o = { ...base, id: newId("s"), type: "shape", shape: kind, w: vw * 0.2 * sw, h: vw * 0.2 * sh, fill: doc.theme.accent };
  }
  o.x = (at?.x ?? camera.cx) - o.w / 2;
  o.y = (at?.y ?? camera.cy) - o.h / 2;
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
  // Inhalt eines gelöschten Rahmens gehört danach wieder dorthin, wo er geometrisch liegt.
  for (const o of doc.objects) if (ids.has(o.frame)) delete o.frame;
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

// at: Einfügen mit der Mitte an diesem Punkt (Rechtsklick „Hier einfügen“), sonst leicht versetzt.
function pasteObjects(source = clipboard, at = null) {
  if (!source?.items.length) return;
  checkpoint();
  source.pastes += 1;
  let dx = camera.w * 0.03 * source.pastes;
  let dy = dx;
  if (at) {
    const xs = source.items.flatMap((o) => [o.x, o.x + o.w]);
    const ys = source.items.flatMap((o) => [o.y, o.y + o.h]);
    dx = at.x - (Math.min(...xs) + Math.max(...xs)) / 2;
    dy = at.y - (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const ids = new Map();
  const copies = source.items.map((o) => {
    const c = structuredClone(o);
    c.id = newId(o.type[0]);
    ids.set(o.id, c.id);
    c.x += dx;
    c.y += dy;
    return c;
  });
  // Feste Rahmenzugehörigkeit auf die kopierten Rahmen umbiegen; ohne kopierten Rahmen löst sich die Kopie.
  for (const c of copies) if (c.frame) c.frame = ids.get(c.frame) ?? null;
  // Kopierte Gruppen bekommen neue Gruppen-ids, damit sie nicht mit dem Original verbunden sind.
  const groups = new Map();
  for (const c of copies) if (c.group) c.group = groups.get(c.group) ?? groups.set(c.group, `g-${newId("x")}`).get(c.group);
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
  const p = eventToWorld(e);
  const band = FRAME_GRAB_PX / zoom();
  // Alle Objekte unter dem Zeiger, oberstes zuerst: ein nach vorn geholter Rahmen soll den Inhalt
  // darunter nicht verdecken, also zählt er nur an seiner Kante.
  // Ein gefüllter Rahmen (z. B. eine Folie aus PowerPoint) ist auch auf seiner freien Fläche greifbar,
  // sonst bliebe beim Verschieben des Inhalts der leere Folienkasten zurück.
  let filled = null;
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    const objEl = el.closest?.(".obj");
    if (!objEl || objEl.classList.contains("hidden-frame") || !world.contains(objEl)) continue;
    const o = byId.get(objEl.dataset.id);
    if (!o || o.locked) continue;
    if (o.type !== "frame") return o;
    const nearEdge = p.x - o.x < band || o.x + o.w - p.x < band || p.y - o.y < band || o.y + o.h - p.y < band;
    if (nearEdge) return o;
    if (o.fill && !filled) filled = o;
  }
  return filled;
}

// ---------- Zeigergesten: verschieben, Objekt bewegen, Größe ändern ----------

let gesture = null;

function handleAt(e) {
  const handles = [...(groupBox.isConnected ? groupBox.querySelectorAll(".handle") : []), ...selection.flatMap((o) => [...(elOf(o)?.querySelectorAll(":scope > .handle, :scope > .rot-handle") ?? [])])];
  return handles.find((h) => {
    const r = h.getBoundingClientRect();
    return e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
  });
}

viewport.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  // Leisten über der Leinwand bekommen ihre Klicks selbst, sonst würde die Zeigererfassung sie schlucken.
  if (e.target.closest(".formatbar, .present-controls, .minimap, .tour")) return;
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
  const badge = e.button === 0 && e.target.closest(".path-badge");
  if (badge) return togglePathFor(badge.dataset.frame);
  if (drawingFrame && e.button === 0) {
    const box = document.createElement("div");
    box.className = "marquee draw";
    viewport.append(box);
    const r = viewport.getBoundingClientRect();
    gesture = { kind: "draw", start, box, sx: e.clientX - r.left, sy: e.clientY - r.top };
    viewport.setPointerCapture(e.pointerId);
    return;
  }

  // Anfasser der Auswahl nach ihrer Lage treffen: oft liegt ein Rahmen darüber (z. B. nach Prezi-Import)
  // und bekäme sonst den Klick – das Ziehen würde dann Text markieren statt die Größe ändern.
  const hit = (e.button === 0 && selected && handleAt(e)) || e.target;
  if (e.button === 0 && hit.classList.contains("handle") && selected) {
    gesture = hit.classList.contains("group-handle")
      ? {
          kind: "group-resize",
          start,
          box: selectionBox(),
          items: selection.map((p) => ({ p, x: p.x, y: p.y, w: p.w, h: p.h, size: p.size })),
          before: snapshot(),
        }
      : { kind: "resize", start, o: selected, w: selected.w, h: selected.h, before: snapshot() };
  } else if (e.button === 0 && hit.classList.contains("rot-handle") && selected) {
    const o = selected;
    gesture = { kind: "rotate", o, center: { x: o.x + o.w / 2, y: o.y + o.h / 2 }, before: snapshot() };
  } else {
    const o = e.button === 0 ? hitObject(e) : null;
    if (o && painting) {
      pasteFormat(groupOf(o));
      setPainting(false);
      select(o);
      return;
    }
    if (o && (e.shiftKey || e.ctrlKey)) {
      select(o, true); // Umschalt- oder Strg+Klick: zur Auswahl hinzufügen oder entfernen
      return;
    }
    if (o) {
      // Ist die Gruppe schon ausgewählt, wählt ein weiterer Klick (ohne Ziehen) nur das Objekt darin.
      const drill = o.group && selectedGroup() && selection.includes(o) ? o : null;
      if (!selection.includes(o)) select(o);
      // Alle ausgewählten Objekte bewegen sich gemeinsam, Rahmen mit ihrem Inhalt.
      const items = withContents(selection).map((p) => ({ p, x: p.x, y: p.y }));
      gesture = { kind: "move", start, items, before: snapshot(), drill, cx: e.clientX, cy: e.clientY };
    } else if (e.button === 0 && (e.shiftKey || e.ctrlKey)) {
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
    const d = unrotate((e.clientX - gesture.x) / z, (e.clientY - gesture.y) / z);
    cameraBusy();
    camera.set({ w: camera.w, cx: gesture.cx - d.x, cy: gesture.cy - d.y });
    return;
  }
  const p = eventToWorld(e);
  if (gesture.kind === "rotate") {
    gesture.o.rot = rotationAt(gesture, p, e.shiftKey);
    updateEl(gesture.o);
    return;
  }
  if (gesture.kind === "marquee" || gesture.kind === "draw") {
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
    // Erst ab 5 px Weg ist es ein Verschieben; darunter ein Klick (sonst rückt das Einrasten Objekte beim Klicken).
    if (!gesture.live && Math.hypot(e.clientX - gesture.cx, e.clientY - gesture.cy) < 5) return;
    gesture.live = true;
    // Einrasten an Hilfslinien bzw. am Raster; mit gedrückter Alt-Taste frei.
    const [sx, sy] = e.altKey ? (clearGuides(), [dx, dy]) : snapMove(gesture, dx, dy);
    for (const it of gesture.items) {
      it.p.x = it.x + sx;
      it.p.y = it.y + sy;
      updateEl(it.p);
    }
  } else if (gesture.kind === "group-resize") {
    // Gleichmäßig um die linke obere Ecke der Gruppe skalieren, Schriften wachsen mit.
    const g = gesture;
    const f = Math.max(0.05, (g.box.w + dx) / g.box.w);
    for (const it of g.items) {
      Object.assign(it.p, {
        x: g.box.x + (it.x - g.box.x) * f,
        y: g.box.y + (it.y - g.box.y) * f,
        w: it.w * f,
        h: it.h * f,
      });
      if (it.size) it.p.size = it.size * f;
      updateEl(it.p);
    }
    updateGroupBox();
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
    if (!e.altKey && !o.rot) snapResize(gesture, o, keepAspect);
    updateEl(o);
  }
});

// ---------- Hilfslinien und Raster ----------
// Beim Verschieben rasten Kanten und Mitten der bewegten Objekte an Kanten und Mitten anderer
// sichtbarer Objekte ein (orange Linie). Ohne Treffer und mit eingeschaltetem Raster am Raster.

const SNAP_PX = 7;
const GRID_UNIT = 40; // Leinwand-Einheiten, wie das Punktraster
let gridOn = false;
try {
  gridOn = localStorage.getItem("weitblick-grid") === "1";
} catch {
  // ohne Speicher: Raster aus
}

// Rasterweite passend zur Zoomstufe, wie das angezeigte Punktraster.
function gridStep() {
  const px = GRID_UNIT * zoom();
  return px < 12 ? GRID_UNIT * Math.ceil(12 / px) : GRID_UNIT;
}

function toggleGrid() {
  gridOn = !gridOn;
  try {
    localStorage.setItem("weitblick-grid", gridOn ? "1" : "0");
  } catch {
    // nur für diese Sitzung
  }
  viewport.classList.toggle("grid-on", gridOn);
  document.getElementById("btn-grid").classList.toggle("on", gridOn);
}

function clearGuides() {
  world.querySelectorAll(".guide").forEach((g) => g.remove());
}

function showGuide(axis, pos, from, to, kind = "") {
  const g = document.createElement("div");
  g.className = `guide ${axis} ${kind}`;
  if (axis === "v") Object.assign(g.style, { left: `${pos}px`, top: `${from}px`, height: `${to - from}px` });
  else Object.assign(g.style, { top: `${pos}px`, left: `${from}px`, width: `${to - from}px` });
  // Abstandsmarken tragen ihre Länge in Leinwand-Pixeln.
  if (kind === "gap") g.append(Object.assign(document.createElement("span"), { className: "gap-label", textContent: `${Math.round(to - from)}` }));
  world.append(g);
}

function snapMove(g, dx, dy) {
  if (!g.snap) {
    const moving = new Set(g.items.map((it) => it.p));
    const xs = g.items.map((it) => it.x);
    const ys = g.items.map((it) => it.y);
    const box = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...g.items.map((it) => it.x + it.p.w)) - Math.min(...xs),
      h: Math.max(...g.items.map((it) => it.y + it.p.h)) - Math.min(...ys),
    };
    const others = doc.objects.filter((o) => !o.hidden && !moving.has(o));
    g.snap = { box, others };
  }
  const { box, others } = g.snap;
  const tol = SNAP_PX / zoom();
  const b = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const mine = { v: [b.x, b.x + b.w / 2, b.x + b.w], h: [b.y, b.y + b.h / 2, b.y + b.h] };
  let best = { v: null, h: null };
  for (const o of others) {
    const theirs = { v: [o.x, o.x + o.w / 2, o.x + o.w], h: [o.y, o.y + o.h / 2, o.y + o.h] };
    for (const axis of ["v", "h"]) {
      for (const m of mine[axis]) {
        for (const t of theirs[axis]) {
          const d = t - m;
          if (Math.abs(d) <= tol && (!best[axis] || Math.abs(d) < Math.abs(best[axis].d))) best[axis] = { d, t, o };
        }
      }
    }
  }
  // Gleiche Abstände: liegt der Kasten in einer Reihe mit zwei anderen Objekten, rastet er so ein, dass
  // die Lücken gleich groß sind (zwischen beiden oder als Fortsetzung der Reihe).
  for (const [axis, p, s, q, t] of [["v", "x", "w", "y", "h"], ["h", "y", "h", "x", "w"]]) {
    const row = others
      .filter((o) => o.type !== "frame" && o[q] < b[q] + b[t] && o[q] + o[t] > b[q])
      .sort((m, n) => m[p] - n[p]);
    for (let i = 0; i + 1 < row.length; i++) {
      const A = row[i];
      const B = row[i + 1];
      const aEnd = A[p] + A[s];
      const g = B[p] - aEnd;
      if (g <= 0) continue;
      const tries = [
        { at: (aEnd + B[p] - b[s]) / 2, gaps: (at) => [[aEnd, at], [at + b[s], B[p]]] },
        { at: B[p] + B[s] + g, gaps: (at) => [[aEnd, B[p]], [B[p] + B[s], at]] },
        { at: A[p] - g - b[s], gaps: (at) => [[at + b[s], A[p]], [aEnd, B[p]]] },
      ];
      for (const c of tries) {
        const d = c.at - b[p];
        if (c.gaps(c.at).some(([f, e]) => e - f <= 0)) continue;
        // Bei Gleichstand gewinnt der Abstand: er sagt mehr als eine Kantenlinie an derselben Stelle.
        if (Math.abs(d) <= tol && (!best[axis] || Math.abs(d) <= Math.abs(best[axis].d))) best[axis] = { d, gaps: c.gaps(c.at) };
      }
    }
  }
  let sx = dx + (best.v?.d ?? 0);
  let sy = dy + (best.h?.d ?? 0);
  if (gridOn) {
    const step = gridStep();
    if (!best.v) sx = Math.round((box.x + dx) / step) * step - box.x;
    if (!best.h) sy = Math.round((box.y + dy) / step) * step - box.y;
  }
  clearGuides();
  const nb = { x: box.x + sx, y: box.y + sy, w: box.w, h: box.h };
  // Gleiche Abstände: die beiden Lücken als kurze Linien auf halber Höhe bzw. Breite des Kastens.
  if (best.v?.gaps) for (const [f, e] of best.v.gaps) showGuide("h", nb.y + nb.h / 2, f, e, "gap");
  else if (best.v) {
    const o = best.v.o;
    showGuide("v", best.v.t, Math.min(nb.y, o.y), Math.max(nb.y + nb.h, o.y + o.h));
  }
  if (best.h?.gaps) for (const [f, e] of best.h.gaps) showGuide("v", nb.x + nb.w / 2, f, e, "gap");
  else if (best.h) {
    const o = best.h.o;
    showGuide("h", best.h.t, Math.min(nb.x, o.x), Math.max(nb.x + nb.w, o.x + o.w));
  }
  return [sx, sy];
}

// Beim Größe-Ändern: rechte bzw. untere Kante rastet an Kanten anderer Objekte ein, Breite und Höhe an
// den Maßen anderer Objekte (gleich groß). Nur für ungedrehte Objekte.
function snapResize(g, o, keepAspect) {
  g.others ??= doc.objects.filter((p) => !p.hidden && p !== o);
  const tol = SNAP_PX / zoom();
  clearGuides();
  const pick = (cur, cands) => cands.reduce((m, c) => (Math.abs(c.v - cur) <= tol && (!m || Math.abs(c.v - cur) < Math.abs(m.v - cur)) ? c : m), null);
  const wHit = pick(o.w, g.others.flatMap((p) => [{ v: p.w, size: p }, { v: p.x - o.x, edge: p.x }, { v: p.x + p.w - o.x, edge: p.x + p.w }]).filter((c) => c.v > 0));
  if (wHit) {
    if (keepAspect) o.h *= wHit.v / o.w;
    o.w = wHit.v;
    showGuide("v", o.x + o.w, o.y, o.y + o.h);
    if (wHit.size) showGuide("v", wHit.size.x + wHit.size.w, wHit.size.y, wHit.size.y + wHit.size.h);
  }
  if (keepAspect) return;
  const hHit = pick(o.h, g.others.flatMap((p) => [{ v: p.h, size: p }, { v: p.y - o.y, edge: p.y }, { v: p.y + p.h - o.y, edge: p.y + p.h }]).filter((c) => c.v > 0));
  if (hHit) {
    o.h = hHit.v;
    showGuide("h", o.y + o.h, o.x, o.x + o.w);
    if (hHit.size) showGuide("h", hHit.size.y + hHit.size.h, hHit.size.x, hHit.size.x + hHit.size.w);
  }
}

const endGesture = (e) => {
  const g = gesture;
  gesture = null;
  viewport.classList.remove("dragging");
  positionContextBar();
  if (g?.live || g?.kind?.includes("resize") || g?.kind === "rotate") staleMinimap();
  clearGuides();
  const moved = g?.before && snapshot() !== g.before;
  if (moved) checkpoint(g.before);
  else if (g?.drill && !g.live) setSelection([g.drill]);
  updateGeomFields();
  if (g?.kind === "draw") {
    g.box.remove();
    setDrawFrame(false);
    const b = g.end && { x: Math.min(g.start.x, g.end.x), y: Math.min(g.start.y, g.end.y), w: Math.abs(g.end.x - g.start.x), h: Math.abs(g.end.y - g.start.y) };
    // Unter 10 px auf dem Bildschirm gilt als Versehen.
    if (b && Math.max(b.w, b.h) * zoom() > 10) frameFromRect(b);
  }
  if (g?.kind === "marquee") {
    g.box.remove();
    if (g.end) {
      const box = {
        x: Math.min(g.start.x, g.end.x),
        y: Math.min(g.start.y, g.end.y),
        w: Math.abs(g.end.x - g.start.x),
        h: Math.abs(g.end.y - g.start.y),
      };
      const hits = doc.objects.filter((o) => !o.hidden && !o.locked && inside(o, box));
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
  const d = unrotate((sx - viewport.clientWidth / 2) / z, (sy - viewport.clientHeight / 2) / z);
  cameraBusy();
  camera.set({ w, cx: before.x - d.x, cy: before.y - d.y });
}

// Doppelklick: Text bearbeiten, sonst zum kleinsten Rahmen unter dem Zeiger fliegen.
viewport.addEventListener("dblclick", (e) => {
  if (presenting || e.target.closest(".formatbar")) return;
  // Wegen der Zeigererfassung ist e.target hier der Viewport, also selbst nachsehen; hitObject übergeht
  // Rahmen, die über dem Text liegen (außer an ihrer Kante).
  const o = hitObject(e);
  if (o?.type === "text") {
    startEditing(o);
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
function usedMediaNames() {
  const names = new Set(doc.objects.filter((o) => o.type === "image" || o.type === "video").flatMap((o) => [o.src, o.source?.file]));
  if (doc.background?.src) names.add(doc.background.src);
  for (const f of doc.fonts ?? []) for (const face of f.faces) names.add(face.src);
  return [...names].filter((n) => media.has(n));
}

// Welche Medien in welcher Datei schon stecken: Pfad → Map(Name → Medieneintrag). Unveränderte kopiert
// Rust roh aus dieser Datei, statt sie als Base64 durch die Oberfläche zu schicken (Autospeichern, Strg+S).
const writtenMedia = new Map();

async function writePresentation(path, json, from = path) {
  const names = usedMediaNames();
  const had = writtenMedia.get(from);
  const keep = had ? names.filter((n) => had.get(n) === media.get(n)) : [];
  const payload = (list) => Promise.all(list.map(async (name) => ({ name, data: await mediaData(name) })));
  try {
    await tauri.core.invoke("save_presentation", { path, json, media: await payload(names.filter((n) => !keep.includes(n))), keepFrom: keep.length ? from : null, keep });
  } catch (err) {
    if (!keep.length) throw err;
    // Die alte Datei wurde außerhalb verändert oder fehlt: alles neu schreiben.
    await tauri.core.invoke("save_presentation", { path, json, media: await payload(names) });
  }
  writtenMedia.set(path, new Map(names.map((n) => [n, media.get(n)])));
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

// Kurze Rückmeldung unten in der Mitte, die nach zwei Sekunden verblasst.
let toastTimer = 0;
function showToast(text) {
  let t = document.getElementById("toast");
  if (!t) {
    t = Object.assign(document.createElement("div"), { id: "toast", className: "toast" });
    t.setAttribute("role", "status");
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}

async function saveAs() {
  const path = await tauri.dialog.save({ filters: FILTERS, defaultPath: `${doc.title}.weitblick` });
  if (!path) return;
  const old = currentPath;
  currentPath = path.endsWith(".weitblick") ? path : `${path}.weitblick`;
  // Eine neue Präsentation heißt danach wie ihre Datei.
  if (doc.title === "Neue Präsentation") doc.title = currentPath.split(/[\\/]/).pop().replace(/\.weitblick$/i, "");
  await save(old);
}

// from: Datei, aus der unveränderte Medien übernommen werden können (bei „Speichern unter“ die bisherige).
async function save(from = currentPath) {
  if (!currentPath) return saveAs();
  if (isEditing()) document.activeElement.blur();
  try {
    await writePresentation(currentPath, JSON.stringify({ ...doc, version: FORMAT_VERSION }, null, 2), from ?? currentPath);
    markSaved();
    clearRecovery();
    rememberRecent(currentPath);
    showToast(`✓ Gespeichert: ${currentPath.split(/[\\/]/).pop()}`);
  } catch (err) {
    await tauri.dialog.message(String(err), { title: "Speichern fehlgeschlagen", kind: "error" });
  }
}

async function openFile() {
  if (!(await confirmDiscard())) return;
  const path = await tauri.dialog.open({
    multiple: false,
    filters: [
      { name: "Weitblick, PowerPoint oder Offline-Prezi", extensions: ["weitblick", "pptx", "zip"] },
      ...FILTERS,
      { name: "PowerPoint-Präsentation", extensions: ["pptx"] },
      { name: "Offline-Prezi (Portable Prezi)", extensions: ["zip"] },
    ],
  });
  if (!path) return;
  if (/\.(pptx|zip)$/i.test(path)) await importPath(path);
  else await openPath(path);
}

// ---------- PowerPoint ----------

// Das Rechteck, auf das die Kamera bei Schritt i blickt (bei Animationsschritten das davor).
function stepRect(i) {
  let k = i;
  while (k > 0 && isAnim(doc.path[k])) k--;
  return byId.get(doc.path[k]);
}

async function exportPptx(morph) {
  if (isEditing()) document.activeElement.blur();
  const base = (currentPath?.split(/[\\/]/).pop() ?? `${doc.title}.weitblick`).replace(/\.weitblick$/i, "");
  const path = await tauri.dialog.save({ filters: [{ name: "PowerPoint-Präsentation", extensions: ["pptx"] }], defaultPath: `${base}.pptx` });
  if (!path) return;
  const target = path.toLowerCase().endsWith(".pptx") ? path : `${path}.pptx`;
  const steps = doc.path.map((_, i) => ({ rect: stepRect(i), hidden: hiddenAt(i), notes: noteHolder(i)?.notes ?? "", transition: noteHolder(i)?.transition })).filter((s) => s.rect);
  try {
    document.body.classList.add("busy");
    const entries = await buildPptx({
      doc,
      media,
      mediaData,
      steps,
      morph,
      aspect: aspectRatio(),
      textFont,
      textWeight,
      textItalic,
      cornerRadius,
      hasCorners,
      shapeSvg,
      iconSvg,
    });
    await tauri.core.invoke("write_zip", { path: target, entries });
    await tauri.dialog.message(
      `${steps.length} Folien exportiert${morph ? " mit Morph-Übergängen (PowerPoint 2019/365)" : ""}.`,
      { title: "PowerPoint-Export", kind: "info" },
    );
  } catch (err) {
    await tauri.dialog.message(String(err?.message ?? err), { title: "Export fehlgeschlagen", kind: "error" });
  } finally {
    document.body.classList.remove("busy");
  }
}

// PowerPoint (.pptx) oder Offline-Prezi (.zip) importieren.
async function importPath(path) {
  const prezi = /\.zip$/i.test(path);
  try {
    document.body.classList.add("busy");
    const entries = await tauri.core.invoke("read_zip", { path, filter: prezi ? "contents.portable/" : null, skip: prezi ? "contents.portable/videos/thumb_" : null });
    // PowerPoint: EMF/WMF-Vorschaubilder (eingebettete Objekte) vorab in PNG umwandeln, soweit möglich.
    if (!prezi) {
      for (const e of entries.filter((e) => /\.(emf|wmf)$/i.test(e.name) && e.data)) e.png = await tauri.core.invoke("emf_to_png", { data: e.data }).catch(() => null);
    }
    const title = path.split(/[\\/]/).pop().replace(/\.(pptx|zip)$/i, "");
    const result = await (prezi ? importPrezi : importPptx)(entries, title, structuredClone(demo.theme));
    // Ungespeichert öffnen: beim ersten Speichern fragt Weitblick nach dem Namen der .weitblick-Datei.
    loadDocument(result.doc, null, result.media);
    await fitImportedTexts();
    savedSnapshot = null;
    showFileName();
    rememberRecent(path);
    const notes = result.skipped.length ? `\n\nNicht oder nur vereinfacht übernommen:\n– ${result.skipped.join("\n– ")}` : "";
    const summary = prezi ? `${result.count} Objekte und ${result.steps} Pfadschritte aus Prezi übernommen.` : `${result.slides} Folien als Rahmen auf die Leinwand gelegt.`;
    await tauri.dialog.message(`${summary}${notes}`, { title: prezi ? "Prezi-Import" : "PowerPoint-Import", kind: "info" });
  } catch (err) {
    await tauri.dialog.message(String(err?.message ?? err), { title: "Import fehlgeschlagen", kind: "error" });
  } finally {
    document.body.classList.remove("busy");
  }
}

// Importierte Texte, die über ihr Feld hinauslaufen (andere Schrift, andere Zeilenhöhe als in PowerPoint),
// schrittweise verkleinern, bis sie passen. Gemessen wird in Leinwand-Einheiten, unabhängig vom Zoom.
async function fitImportedTexts() {
  await document.fonts.ready;
  for (const o of doc.objects) {
    // fitH: Höhe unbekannt (Prezi ohne Autofit, Prezi Classic): nachmessen, Mittelpunkt bleibt.
    if (o.type === "text" && o.fitH) {
      delete o.fitH;
      const el = elOf(o);
      if (!el) continue;
      const mid = o.y + o.h / 2;
      o.h = 1;
      updateEl(o, el);
      o.h = el.scrollHeight;
      o.y = mid - o.h / 2;
      updateEl(o, el);
    }
    if (o.type !== "text" || !o.fit) continue;
    delete o.fit;
    const el = elOf(o);
    if (!el) continue;
    el.style.overflow = "hidden";
    for (let i = 0; i < 40 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1); i++) {
      o.size *= 0.93;
      updateEl(o, el);
    }
    el.style.overflow = "";
  }
}

// ---------- PDF ----------
// Jeder Pfadschritt wird eine Seite: eine Kopie der Leinwand mit der Kamera dieses Schritts. Das PDF schreibt
// die WebView direkt (WebView2 unter Windows, WebKitGTK unter Linux): randlos, Seitengröße der Präsentation.
// Texte und Formen bleiben Vektoren, die eingebetteten Schriften stimmen.
const PRINT_W = 1280;

async function printDeck() {
  if (isEditing()) document.activeElement.blur();
  const base = (currentPath?.split(/[\\/]/).pop() ?? `${doc.title}.weitblick`).replace(/\.weitblick$/i, "");
  let target = await tauri.dialog.save({ filters: [{ name: "PDF", extensions: ["pdf"] }], defaultPath: `${base}.pdf` });
  if (!target) return;
  if (!target.toLowerCase().endsWith(".pdf")) target += ".pdf";
  const aspect = aspectRatio();
  const H = Math.round(PRINT_W / aspect);
  const deck = document.createElement("div");
  deck.id = "print-deck";
  const style = document.createElement("style");
  style.textContent = `@page { size: ${PRINT_W}px ${H}px; margin: 0; } #print-deck .print-page { width: ${PRINT_W}px; height: ${H}px; zoom: calc(100vw / ${PRINT_W}px); }`;
  // zoom: WebView2 setzt die Seite beim PDF-Druck nicht mit 96 px/Zoll (gemessen: 1920 statt 1280 px Breite).
  deck.append(style);
  doc.path.forEach((_, i) => {
    const cam = stepCamera(i);
    const hidden = hiddenAt(i);
    const page = document.createElement("div");
    page.className = "print-page";
    page.style.backgroundColor = doc.theme.background;
    const bg = bgLayer.cloneNode(false);
    bg.removeAttribute("id");
    bg.style.transform = "";
    page.append(bg);
    const w = world.cloneNode(true);
    w.removeAttribute("id");
    const z = PRINT_W / cam.w;
    w.style.transform = `translate(${PRINT_W / 2}px, ${H / 2}px) rotate(${-(cam.rot ?? 0)}deg) scale(${z}) translate(${-cam.cx}px, ${-cam.cy}px)`;
    w.style.setProperty("--inv", 1 / z);
    for (const el of w.querySelectorAll(".obj")) {
      const o = byId.get(el.dataset.id);
      el.classList.remove("selected", "frame-member", "anim-hidden", "zoom-hidden");
      el.querySelectorAll(".handle, .rot-handle").forEach((h) => h.remove());
      if (!o || hidden.has(o.id)) el.style.display = "none";
      else if (o.cover || o.inside) el.style.setProperty("--zoomfade", zoomFade(o, cam, aspect));
    }
    page.append(w);
    deck.append(page);
  });
  document.body.append(deck);
  document.body.classList.add("printing");
  const done = () => {
    deck.remove();
    document.body.classList.remove("printing", "busy");
    removeEventListener("afterprint", done);
  };
  // Bilder und Schriften der Kopien sind schon geladen; kurz warten, bis sie gezeichnet sind.
  await new Promise((r) => setTimeout(r, 300));
  try {
    document.body.classList.add("busy");
    await tauri.core.invoke("export_pdf", { path: target, width: PRINT_W / 96, height: H / 96 });
    await tauri.dialog.message(`${doc.path.length} Seiten als PDF gespeichert.`, { title: "PDF-Export", kind: "info" });
  } catch (err) {
    // Ohne direkten Weg (weder WebView2 noch WebKitGTK): Druckdialog.
    if (String(err) === "unsupported") {
      document.body.classList.remove("busy");
      addEventListener("afterprint", done);
      print();
      return;
    }
    await tauri.dialog.message(String(err?.message ?? err), { title: "PDF-Export fehlgeschlagen", kind: "error" });
  }
  done();
}

function showExportMenu() {
  const b = document.getElementById("btn-export").getBoundingClientRect();
  buildMenu(
    [
      { label: "PDF …", run: printDeck },
      { label: "Als Vorlage speichern", run: saveAsTemplate },
      { label: "PowerPoint mit Morph-Übergängen …", run: () => exportPptx(true) },
      { label: "PowerPoint klassisch …", run: () => exportPptx(false) },
      "-",
      { label: "PowerPoint oder Offline-Prezi importieren …", run: openFile },
    ],
    ctxMenu,
  );
  ctxMenu.classList.add("open");
  ctxMenu.style.left = `${Math.min(b.left, innerWidth - ctxMenu.offsetWidth - 4)}px`;
  ctxMenu.style.top = `${b.bottom + 4}px`;
}

async function openPath(path) {
  try {
    const result = await tauri.core.invoke("open_presentation", { path });
    const loaded = JSON.parse(result.json);
    if (loaded.format !== "weitblick") throw new Error("Das ist keine Weitblick-Präsentation.");
    if (loaded.version > FORMAT_VERSION) throw new Error("Die Datei stammt aus einer neueren Weitblick-Version.");
    loadDocument(loaded, path, result.media);
    writtenMedia.set(path, new Map(media)); // diese Medien stecken unverändert in der Datei
    rememberRecent(path);
  } catch (err) {
    await tauri.dialog.message(String(err.message ?? err), { title: "Öffnen fehlgeschlagen", kind: "error" });
  }
}

// Ein Dokument anzeigen: Medien und Schriften laden, Verlauf und Auswahl zurücksetzen.
function loadDocument(loaded, path, mediaList = []) {
  clearRecovery(); // die bisherige Präsentation wurde gespeichert oder bewusst verworfen
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
// at: Mittelpunkt auf der Leinwand, sonst die Bildmitte.
function insertObjects(items, at = null) {
  checkpoint();
  const cx = at?.x ?? camera.cx;
  const cy = at?.y ?? camera.cy;
  const added = items.map((o) => ({ ...o, id: newId(o.type[0]), x: o.x + cx, y: o.y + cy }));
  doc.objects.push(...added);
  buildWorld();
  setSelection(added);
}

function insertIcon(name, at = null) {
  const s = camera.w * 0.1;
  insertObjects([{ type: "icon", name, x: -s / 2, y: -s / 2, w: s, h: s, color: doc.theme.accent }], at);
}

function insertDiagram(id, at = null) {
  const d = DIAGRAMS.find((x) => x.id === id);
  if (!d) return;
  let items = d.build(camera.w / 16, doc.theme);
  // Blöcke wie der Planet gelten als ein Stück: alle Teile in eine Gruppe.
  if (d.group) {
    const g = `g-${Date.now().toString(36)}`;
    items = items.map((o) => ({ ...o, group: g }));
  }
  insertObjects(items, at ?? freeSpot(items));
  const added = [...selection];
  const frame = frameAndAddToPath(added, d.label);
  addSubSteps(added);
  // Liegt der neue Block neben dem Bild, dorthin fliegen.
  if (frame) camera.flyTo(frameState(frame.id));
  setSelection(added.filter((o) => byId.has(o.id)).flatMap((o) => (o.group ? groupOf(o) : [o])).filter((o, i, a) => a.indexOf(o) === i));
}

// Teile mit gleichem „step“ (z. B. ein Mond samt Beschriftung) bekommen je einen unsichtbaren Rahmen,
// der als Unterschritt in den Pfad kommt. Die Rahmen gehören zur Gruppe des Blocks und wandern mit.
function addSubSteps(items) {
  const keys = [...new Set(items.map((o) => o.step).filter(Boolean))];
  for (const key of keys) {
    const parts = items.filter((o) => o.step === key);
    const x1 = Math.min(...parts.map((o) => o.x));
    const y1 = Math.min(...parts.map((o) => o.y));
    const x2 = Math.max(...parts.map((o) => o.x + o.w));
    const y2 = Math.max(...parts.map((o) => o.y + o.h));
    const pad = Math.max(x2 - x1, y2 - y1) * 0.25;
    let w = x2 - x1 + 2 * pad;
    let h = y2 - y1 + 2 * pad;
    const ratio = aspectRatio();
    if (w / h < ratio) w = h * ratio;
    else h = w / ratio;
    const f = {
      id: newId("f"),
      type: "frame",
      hidden: true,
      sub: true,
      title: key,
      x: (x1 + x2) / 2 - w / 2,
      y: (y1 + y2) / 2 - h / 2,
      w,
      h,
      frame: parts[0].frame,
      ...(parts[0].group ? { group: parts[0].group } : {}),
    };
    doc.objects.splice(1, 0, f);
    byId.set(f.id, f);
    addToPath(f.id);
  }
  for (const o of items) delete o.step;
  buildWorld();
}

// Um frisch eingefügte Inhalte einen Rahmen im Seitenverhältnis der Präsentation legen und ihn
// als Pfadschritt anhängen. Gehört zum selben Rückgängig-Schritt wie das Einfügen.
function frameAndAddToPath(items, title) {
  if (!items.length) return;
  const b = { ...selectionBox() };
  const pad = Math.max(b.w, b.h) * 0.08;
  let w = b.w + 2 * pad;
  let h = b.h + 2 * pad;
  const ratio = aspectRatio();
  if (w / h < ratio) w = h * ratio;
  else h = w / ratio;
  const f = {
    id: newId("f"),
    type: "frame",
    x: b.x + b.w / 2 - w / 2,
    y: b.y + b.h / 2 - h / 2,
    w,
    h,
    title,
  };
  for (const o of items) o.frame = f.id;
  // Rahmen hinter alles andere, damit der Inhalt klickbar bleibt.
  doc.objects.splice(1, 0, f);
  growOverview(f);
  buildWorld();
  addToPath(f.id);
  return f;
}

// Der Überblick (erster Pfadschritt) soll alles zeigen: liegt etwas außerhalb, wächst er mit.
function growOverview(r) {
  const ov = byId.get(doc.path[0]);
  if (!ov?.hidden || inside(r, ov)) return;
  const pad = Math.max(r.w, r.h) * 0.1;
  const x1 = Math.min(ov.x, r.x - pad);
  const y1 = Math.min(ov.y, r.y - pad);
  const x2 = Math.max(ov.x + ov.w, r.x + r.w + pad);
  const y2 = Math.max(ov.y + ov.h, r.y + r.h + pad);
  Object.assign(ov, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
}

// Einen freien Platz für neue Inhalte suchen: erst die Bildmitte, dann ringsum in Schritten
// der Blockgröße. Belegt ist, was sichtbare Objekte (außer dem Überblick) überdecken.
function freeSpot(items) {
  const x1 = Math.min(...items.map((o) => o.x));
  const y1 = Math.min(...items.map((o) => o.y));
  const w = Math.max(...items.map((o) => o.x + o.w)) - x1;
  const h = Math.max(...items.map((o) => o.y + o.h)) - y1;
  const pad = Math.max(w, h) * 0.15;
  const taken = doc.objects.filter((o) => !o.hidden);
  const free = (cx, cy) => {
    const r = { x: cx + x1 - pad, y: cy + y1 - pad, w: w + 2 * pad, h: h + 2 * pad };
    return !taken.some((o) => o.x < r.x + r.w && o.x + o.w > r.x && o.y < r.y + r.h && o.y + o.h > r.y);
  };
  const sx = w + 2 * pad;
  const sy = h + 2 * pad;
  for (let ring = 0; ring <= 4; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const cx = camera.cx + i * sx;
        const cy = camera.cy + j * sy;
        if (free(cx, cy)) return { x: cx, y: cy };
      }
    }
  }
  return null;
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

// Braucht eine Schrift einen Download? Standard- und Systemschriften nicht, eingebettete auch nicht.
function needsDownload(family) {
  if (!family || FONTS[family]) return false;
  if ((systemFonts ?? []).includes(family)) return false;
  return !doc.fonts.some((f) => f.family.toLowerCase() === family.toLowerCase());
}

// Lädt eine Google-Schrift und bettet sie ein (ohne eigenen Rückgängig-Schritt). Liefert true bei Erfolg.
async function embedGoogleFont(family, status = fontStatus) {
  if (!needsDownload(family)) return true;
  status.textContent = `Lade „${family}“ …`;
  try {
    const faces = await tauri.core.invoke("google_font", { family });
    const slug = family.toLowerCase().replace(/\s+/g, "-");
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
    return true;
  } catch (err) {
    status.textContent = String(err?.message ?? err);
    return false;
  }
}

async function addGoogleFont(family, status = fontStatus) {
  family = family.trim();
  if (!family) return;
  const known = doc.fonts.find((f) => f.family.toLowerCase() === family.toLowerCase());
  if (known) return applyFont(known.family);
  if (await embedGoogleFont(family, status)) applyFont(family);
}

// Schrift auf die ausgewählten Texte anwenden, falls welche ausgewählt sind.
function applyFont(family) {
  format((o) => (o.font = family), isText);
}

function fontGroups() {
  const embedded = (doc.fonts ?? []).map((f) => f.family);
  return [
    ["Standard", [["sans", "Serifenlos"], ["serif", "Serif"], ["mono", "Schreibmaschine"], ["Weitblick Brand", "Weitblick (Comfortaa)"]]],
    ["In dieser Präsentation", embedded.map((f) => [f, f])],
    ["Google (wird beim Wählen geladen)", GOOGLE_FONTS.filter((f) => !embedded.includes(f)).map((f) => [f, f])],
    ["Systemschriften", (systemFonts ?? []).map((f) => [f, f])],
  ];
}

// Alle Schriftauswahlen (Formatleiste und Stil) mit denselben Gruppen füllen.
function fillFontSelect() {
  for (const sel of document.querySelectorAll("select.font-select")) {
    const value = sel.value;
    sel.replaceChildren(
      ...fontGroups()
        .filter(([, items]) => items.length)
        .map(([title, items]) => {
          const g = document.createElement("optgroup");
          g.label = title;
          for (const [v, text] of items) g.append(new Option(text, v));
          return g;
        }),
    );
    sel.value = value;
  }
  if (selected?.type === "text") fontSelect.value = textFont(selected);
  updateStylePanel();
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
const fontStatus = sidebar.querySelector(".font-status");

// ---------- Stil: Farbpaletten und Schriftkombinationen ----------

const THEME_COLORS = ["background", "text", "accent", "accent2"];

// Neuen Stil übernehmen: Objekte in den alten Stilfarben bekommen die neuen,
// Texte folgen wieder der Stilschrift ihrer Rolle. Ein Rückgängig-Schritt.
async function applyTheme(next) {
  const old = doc.theme;
  checkpoint();
  const swap = new Map(THEME_COLORS.filter((k) => old[k]).map((k) => [old[k].toLowerCase(), next[k]]));
  for (const o of doc.objects) {
    for (const key of ["color", "fill"]) {
      const c = o[key]?.toLowerCase?.();
      if (c && swap.has(c)) o[key] = swap.get(c);
    }
    if (o.type === "text") delete o.font;
  }
  doc.theme = { ...structuredClone(next), id: next.id };
  buildWorld();
  updateToolbar();
  updateStylePanel();
  // Schriften nachladen; ohne Internet bleibt die Ersatzschrift, bis man es erneut versucht.
  for (const f of new Set(Object.values(next.fonts))) await embedGoogleFont(f, styleStatus);
  buildWorld();
}

// Eine einzelne Farbe oder Schrift des Stils ändern (eigene Anpassung).
async function setThemeValue(key, value, isFont = false) {
  const old = doc.theme;
  if (isFont) {
    if (!(await embedGoogleFont(value, styleStatus))) return;
    checkpoint();
    doc.theme = { ...old, id: "custom", fonts: { ...old.fonts, [key]: value } };
  } else {
    await applyTheme({ ...old, id: "custom", [key]: value });
    return;
  }
  buildWorld();
  updateStylePanel();
}

const styleStatus = sidebar.querySelector(".style-status");

// Fett/kursiv für eine Rolle im Stil umschalten.
function toggleThemeStyle(role, kind) {
  checkpoint();
  const old = doc.theme;
  doc.theme = { ...old, id: "custom", [kind]: { ...old[kind], [role]: !old[kind]?.[role] } };
  buildWorld();
  updateToolbar();
  updateStylePanel();
}

// ---------- Eigene Stilkits ----------
// Gespeichert im App-Datenordner (style-kits.json), damit sie in jeder Präsentation zur Verfügung stehen.

let styleKits = [];

async function loadStyleKits() {
  try {
    styleKits = JSON.parse(tauri ? await tauri.core.invoke("load_style_kits") : (localStorage.getItem("weitblick-kits") ?? "[]"));
  } catch {
    styleKits = [];
  }
  renderStyleKits();
}

async function persistStyleKits() {
  const json = JSON.stringify(styleKits, null, 2);
  try {
    if (tauri) await tauri.core.invoke("save_style_kits", { json });
    else localStorage.setItem("weitblick-kits", json);
  } catch (err) {
    styleStatus.textContent = `Stilkits konnten nicht gespeichert werden: ${err}`;
  }
}

async function saveStyleKit(name) {
  name = name.trim();
  if (!name) return;
  const kit = { ...structuredClone(doc.theme), id: `kit-${Date.now().toString(36)}`, name };
  styleKits = [...styleKits.filter((k) => k.name !== name), kit];
  await persistStyleKits();
  doc.theme = { ...doc.theme, id: kit.id };
  renderStyleKits();
  styleStatus.textContent = `Stilkit „${name}“ gespeichert.`;
}

async function deleteStyleKit(id) {
  styleKits = styleKits.filter((k) => k.id !== id);
  await persistStyleKits();
  renderStyleKits();
}

function themeCard(t, onClick) {
  const b = document.createElement("button");
  b.className = "theme-card";
  b.dataset.theme = t.id;
  b.style.background = t.background;
  b.style.color = t.text;
  b.innerHTML = `<span class="tc-title"></span><span class="tc-fonts"></span><span class="tc-bar"><i></i><i></i></span>`;
  b.querySelector(".tc-title").textContent = t.name;
  b.querySelector(".tc-fonts").textContent = `${t.fonts?.title ?? "sans"} · ${t.fonts?.body ?? "sans"}`;
  const [a, a2] = b.querySelectorAll(".tc-bar i");
  a.style.background = t.accent;
  a2.style.background = t.accent2 ?? t.accent;
  b.addEventListener("click", onClick);
  return b;
}

function renderStyleKits() {
  const box = sidebar.querySelector(".kit-cards");
  box.replaceChildren(
    ...styleKits.map((k) => {
      const card = themeCard(k, () => applyTheme(k));
      const del = document.createElement("span");
      del.className = "kit-delete";
      del.title = "Stilkit löschen";
      del.textContent = "×";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteStyleKit(k.id);
      });
      card.append(del);
      return card;
    }),
  );
  sidebar.querySelector(".kit-empty").hidden = styleKits.length > 0;
  updateStylePanel();
}

function updateStylePanel() {
  const t = doc.theme;
  const bg = doc.background ?? {};
  const m = bg.src ? media.get(bg.src) : null;
  const preview = document.getElementById("bg-preview");
  preview.style.background = m ? `${t.background} url("${m.url}") center / cover` : t.background;
  document.getElementById("btn-bg-remove").disabled = !m;
  document.getElementById("sel-bg-fit").value = bg.fit ?? "cover";
  document.getElementById("chk-parallax").checked = !!bg.parallax;
  document.getElementById("sel-motion").value = bg.motion?.kind ?? "";
  document.getElementById("inp-motion").value = bg.motion?.strength ?? 0.5;
  document.getElementById("inp-motion").disabled = !bg.motion;
  document.getElementById("sel-aspect").value = doc.aspect ?? "16:9";
  sidebar.querySelectorAll(".theme-card").forEach((c) => c.classList.toggle("on", c.dataset.theme === t.id));
  for (const k of THEME_COLORS) {
    const inp = sidebar.querySelector(`[data-theme-color="${k}"]`);
    if (inp) inp.value = toHex(t[k] ?? "#888888");
  }
  for (const [role] of ROLES) {
    const sel = sidebar.querySelector(`[data-theme-font="${role}"]`);
    if (!sel) continue;
    const v = t.fonts?.[role] ?? "sans";
    if (![...sel.options].some((o) => o.value === v)) sel.append(new Option(v, v));
    sel.value = v;
    sidebar.querySelector(`[data-theme-bold="${role}"]`)?.classList.toggle("on", !!t.bold?.[role]);
    sidebar.querySelector(`[data-theme-italic="${role}"]`)?.classList.toggle("on", !!t.italic?.[role]);
  }
}

function buildStylePanel() {
  const panel = sidebar.querySelector('[data-panel="style"]');
  const cards = panel.querySelector(".theme-cards");
  for (const t of THEMES) cards.append(themeCard(t, () => applyTheme(t)));
  for (const b of panel.querySelectorAll("[data-theme-bold]")) {
    b.addEventListener("click", () => toggleThemeStyle(b.dataset.themeBold, "bold"));
  }
  for (const b of panel.querySelectorAll("[data-theme-italic]")) {
    b.addEventListener("click", () => toggleThemeStyle(b.dataset.themeItalic, "italic"));
  }
  const kitName = panel.querySelector("#kit-name");
  const saveKit = () => {
    saveStyleKit(kitName.value);
    kitName.value = "";
  };
  panel.querySelector("#btn-kit-save").addEventListener("click", saveKit);
  kitName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveKit();
  });
  for (const inp of panel.querySelectorAll("[data-theme-color]")) {
    inp.addEventListener("change", () => setThemeValue(inp.dataset.themeColor, inp.value));
  }
  document.getElementById("btn-bg-image").addEventListener("click", chooseBackground);
  document.getElementById("btn-bg-remove").addEventListener("click", () => setBackground({ src: null }));
  const fitSel = document.getElementById("sel-bg-fit");
  fitSel.addEventListener("change", () => setBackground({ fit: fitSel.value }));
  const parallax = document.getElementById("chk-parallax");
  parallax.addEventListener("change", () => setBackground({ parallax: parallax.checked }));
  const motionSel = document.getElementById("sel-motion");
  const motionStrength = document.getElementById("inp-motion");
  for (const fx of MOTIONS) motionSel.append(new Option(fx.label, fx.id));
  const setMotion = () => setBackground({ motion: motionSel.value ? { kind: motionSel.value, strength: Number(motionStrength.value) } : null });
  motionSel.addEventListener("change", setMotion);
  motionStrength.addEventListener("change", setMotion);
  const aspect = document.getElementById("sel-aspect");
  aspect.addEventListener("change", () => {
    checkpoint();
    doc.aspect = aspect.value;
  });
  for (const sel of panel.querySelectorAll("[data-theme-font]")) {
    sel.addEventListener("change", () => setThemeValue(sel.dataset.themeFont, sel.value, true));
  }
  updateStylePanel();
}

function showTab(tab) {
  sidebar.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  sidebar.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
}

function buildSidebar() {
  const shapes = sidebar.querySelector('[data-panel="shapes"]');
  for (const group of SHAPE_GROUPS) {
    const h = document.createElement("h4");
    h.textContent = group.title;
    const grid = document.createElement("div");
    grid.className = "tile-grid";
    for (const s of group.shapes) {
      const b = document.createElement("button");
      b.className = "tile";
      b.title = s.label;
      const preview = shapeSvg(s.id, "currentColor") ?? `<span class="css-shape ${s.id}"></span>`;
      b.innerHTML = `${preview}<span>${s.label}</span>`;
      b.addEventListener("click", () => addObject(s.id));
      dragToCanvas(b, (at) => addObject(s.id, at));
      grid.append(b);
    }
    shapes.append(h, grid);
  }

  const diagrams = sidebar.querySelector('[data-panel="diagrams"]');
  for (const d of DIAGRAMS) {
    const b = document.createElement("button");
    b.className = "row";
    b.textContent = d.label;
    b.addEventListener("click", () => insertDiagram(d.id));
    dragToCanvas(b, (at) => insertDiagram(d.id, at));
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
        dragToCanvas(b, (at) => insertIcon(n, at));
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

  buildStylePanel();
  sidebar.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  showTab("style");
}

// ---------- Breite der Seitenleisten ----------
// Ziehen an der Kante ändert die Breite; sie wird pro Rechner gemerkt (nur eine Bequemlichkeit).

const PANEL_LIMITS = { left: [150, 480, 220], right: [240, 560, 280] };

function setPanelWidth(side, px) {
  const [min, max] = PANEL_LIMITS[side];
  const w = Math.round(clamp(px, min, Math.min(max, innerWidth * 0.45)));
  document.body.style.setProperty(side === "left" ? "--left-w" : "--right-w", `${w}px`);
  try {
    localStorage.setItem(`weitblick-panel-${side}`, String(w));
  } catch {
    // Ohne Speicher gilt die Breite nur bis zum Schließen.
  }
}

for (const side of ["left", "right"]) {
  try {
    const saved = Number(localStorage.getItem(`weitblick-panel-${side}`));
    if (saved) setPanelWidth(side, saved);
  } catch {
    // Kein gespeicherter Wert: Standardbreite.
  }
}

for (const bar of document.querySelectorAll(".splitter")) {
  const side = bar.dataset.side;
  bar.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
    document.body.classList.add("resizing");
    hidePathPreview();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!bar.classList.contains("dragging")) return;
    setPanelWidth(side, side === "left" ? e.clientX : innerWidth - e.clientX);
  });
  const stop = () => {
    bar.classList.remove("dragging");
    document.body.classList.remove("resizing");
  };
  bar.addEventListener("pointerup", stop);
  bar.addEventListener("pointercancel", stop);
  bar.addEventListener("dblclick", () => setPanelWidth(side, PANEL_LIMITS[side][2]));
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

// ---------- Suchen (Strg+F) ----------
// Findet Texte (und Rahmentitel); Enter springt zum nächsten Treffer, Umschalt+Enter zum vorigen.
let searchBox = null;
let searchHits = [];
let searchAt = -1;

function openSearch() {
  if (presenting) return;
  if (!searchBox) {
    searchBox = document.createElement("div");
    searchBox.className = "search-box";
    searchBox.innerHTML = `<input type="search" placeholder="Text suchen …" aria-label="Text suchen" /><span class="search-count"></span><button title="Schließen (Esc)" aria-label="Suche schließen">×</button>`;
    viewport.append(searchBox);
    const input = searchBox.querySelector("input");
    for (const ev of ["pointerdown", "wheel", "dblclick", "contextmenu"]) searchBox.addEventListener(ev, (e) => e.stopPropagation());
    input.addEventListener("input", () => runSearch(input.value));
    input.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey && e.key.toLowerCase() === "s")) e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        showHit(e.shiftKey ? -1 : 1);
      }
      if (e.key === "Escape") closeSearch();
    });
    searchBox.querySelector("button").addEventListener("click", closeSearch);
  }
  searchBox.hidden = false;
  const input = searchBox.querySelector("input");
  input.focus();
  input.select();
  runSearch(input.value);
}

function closeSearch() {
  if (searchBox) searchBox.hidden = true;
}

function runSearch(q) {
  const needle = q.trim().toLowerCase();
  searchHits = needle
    ? doc.objects.filter((o) => (o.type === "text" && o.text?.toLowerCase().includes(needle)) || (o.type === "frame" && !o.hidden && o.title?.toLowerCase().includes(needle)))
    : [];
  searchAt = -1;
  searchBox.querySelector(".search-count").textContent = needle ? (searchHits.length ? `${searchHits.length} Treffer` : "kein Treffer") : "";
}

function showHit(dir) {
  if (!searchHits.length) return;
  searchAt = (searchAt + dir + searchHits.length) % searchHits.length;
  const o = searchHits[searchAt];
  searchBox.querySelector(".search-count").textContent = `${searchAt + 1} / ${searchHits.length}`;
  select(o);
  // Texte im kleinsten sichtbaren Rahmen zeigen, der sie enthält; sonst den Text mit Rand.
  const frame = o.type === "text" ? doc.objects.filter((f) => f.type === "frame" && !f.hidden && inside(o, f)).sort((a, b) => a.w * a.h - b.w * b.h)[0] : null;
  if (frame) {
    offPath = true;
    camera.flyTo({ ...fitRect(frame, viewport.clientWidth, viewport.clientHeight, 0.08), rot: frame.rot ?? 0 });
  } else flyToObject(o);
}

function flyToObject(o) {
  if (!o) return;
  const i = o.type === "frame" ? doc.path.indexOf(o.id) : -1;
  if (i >= 0) return goTo(i);
  offPath = true;
  camera.flyTo({ ...fitRect(o, viewport.clientWidth, viewport.clientHeight, o.type === "frame" ? 0.08 : 0.15), rot: o.rot ?? 0 });
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

// ---------- Bildschirm für die Präsentation ----------
// Mit mehreren Bildschirmen präsentiert Weitblick wie PowerPoint auf dem anderen (z. B. Beamer).
// Die Wahl („same“, „other“ oder ein Bildschirmname) wird gemerkt; das Fenster kommt danach zurück.

let screenChoice = "other";
try {
  screenChoice = localStorage.getItem("weitblick-screen") ?? "other";
} catch {
  // Standard: anderer Bildschirm
}
let windowBefore = null;

async function monitors() {
  try {
    const all = await tauri.window.availableMonitors();
    const cur = await tauri.window.currentMonitor();
    return { all, cur };
  } catch (err) {
    window.__screenError = String(err?.message ?? err);
    return { all: [], cur: null };
  }
}

async function moveToPresentationScreen() {
  const { all, cur } = await monitors();
  if (all.length < 2 || screenChoice === "same") return;
  const target = screenChoice === "other" ? all.find((m) => m.name !== cur?.name) : all.find((m) => m.name === screenChoice);
  if (!target || target.name === cur?.name) return;
  try {
    windowBefore = {
      pos: await appWindow.outerPosition(),
      // setSize setzt die Innengröße, also auch die Innengröße merken.
      size: await appWindow.innerSize(),
      max: await appWindow.isMaximized(),
    };
    if (windowBefore.max) await appWindow.unmaximize();
    await appWindow.setPosition(new tauri.dpi.PhysicalPosition(target.position.x + 40, target.position.y + 40));
  } catch (err) {
    window.__screenError = String(err?.message ?? err);
    windowBefore = null;
  }
}

async function restoreWindow() {
  if (!windowBefore) return;
  const w = windowBefore;
  windowBefore = null;
  try {
    await appWindow.setPosition(w.pos);
    await appWindow.setSize(w.size);
    if (w.max) await appWindow.maximize();
  } catch {
    // Fenster bleibt, wo es ist.
  }
}

async function showPresentMenu() {
  const { all, cur } = await monitors();
  const b = document.getElementById("btn-present-menu").getBoundingClientRect();
  const pick = (v) => () => {
    screenChoice = v;
    try {
      localStorage.setItem("weitblick-screen", v);
    } catch {
      // nur für diese Sitzung
    }
  };
  const mark = (v) => (screenChoice === v ? "✓" : "");
  const items = [
    { label: "Von vorn präsentieren", keys: "F5", run: () => startPresentation(false) },
    { label: "Ab aktuellem Schritt", keys: "Umschalt+F5", run: () => startPresentation(true) },
    "-",
    { label: "Auf diesem Bildschirm", keys: mark("same"), run: pick("same") },
  ];
  if (all.length > 1) {
    items.push({ label: "Auf dem anderen Bildschirm", keys: mark("other"), run: pick("other") });
    all.forEach((m, i) =>
      items.push({
        label: `Bildschirm ${i + 1}: ${m.size.width}×${m.size.height}${m.name === cur?.name ? " (dieser)" : ""}`,
        keys: mark(m.name),
        run: pick(m.name),
      }),
    );
  } else {
    items.push({ label: "Kein zweiter Bildschirm erkannt", keys: "", run: () => {} });
  }
  buildMenu(items, ctxMenu);
  ctxMenu.classList.add("open");
  ctxMenu.style.left = `${Math.max(4, b.right - ctxMenu.offsetWidth)}px`;
  ctxMenu.style.top = `${b.bottom + 4}px`;
}

async function startPresentation(fromCurrent) {
  if (presenting) return;
  if (isEditing()) document.activeElement.blur();
  select(null);
  presenting = true;
  document.body.classList.add("presenting");
  const { cur } = await monitors();
  await moveToPresentationScreen();
  // Nur wenn die Präsentation auf einen anderen Bildschirm gewandert ist, bleibt Platz für die Referentenansicht.
  if (windowBefore && cur) openPresenter(cur);
  await setFullscreen(true);
  // Erst wenn das Fenster seine neue Größe hat, passt der Ausschnitt.
  requestAnimationFrame(() => {
    goTo(fromCurrent ? pathIndex : 0);
    showControls();
  });
}

// ---------- Präsentierhilfen: leerer Bildschirm und Laserpointer ----------
let blankMode = null;
let laserOn = false;
const blankEl = Object.assign(document.createElement("div"), { className: "blank-screen", hidden: true });
const laserDot = Object.assign(document.createElement("div"), { className: "laser-dot", hidden: true });
document.body.append(blankEl, laserDot);

function setBlank(mode) {
  blankMode = mode;
  blankEl.hidden = !mode;
  blankEl.style.background = mode === "white" ? "#fff" : "#000";
}

function setLaser(on) {
  laserOn = on;
  laserDot.hidden = !on;
  document.body.classList.toggle("laser", on);
}

document.addEventListener("pointermove", (e) => {
  if (!laserOn) return;
  laserDot.style.left = `${e.clientX}px`;
  laserDot.style.top = `${e.clientY}px`;
});

async function stopPresentation() {
  if (!presenting) return;
  setBlank(null);
  setLaser(false);
  presenting = false;
  document.body.classList.remove("presenting", "show-controls");
  applyVisibility(pathIndex); // im Editor ist alles sichtbar
  for (const v of world.querySelectorAll(".obj.video video")) v.pause();
  closePresenter();
  await setFullscreen(false);
  await restoreWindow();
}

if (tauri?.event) {
  tauri.event.listen("presenter-ready", sendPresenter);
  tauri.event.listen("presenter-cmd", ({ payload }) => {
    if (!presenting) return;
    // Wie bei Tasten im Hauptfenster: aus dem leeren Bildschirm führt der nächste Befehl erst zurück.
    if (blankMode && (payload === "next" || payload === "prev")) return setBlank(null);
    if (payload === "next") goTo(pathIndex + 1);
    else if (payload === "prev") goTo(pathIndex - 1);
    else if (payload === "stop") stopPresentation();
    else if (payload === "black" || payload === "white") setBlank(blankMode ? null : payload);
  });
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

// ---------- Rechtsklick-Menü ----------
// Einträge: { label, keys, run, sub } oder "-" als Trenner. Was gerade nicht geht, steht gar nicht erst drin.

const ctxMenu = document.createElement("div");
ctxMenu.className = "ctx-menu";
ctxMenu.setAttribute("role", "menu");
document.body.append(ctxMenu);

function buildMenu(items, el) {
  el.replaceChildren();
  // Trenner am Anfang, Ende und doppelt hintereinander weglassen.
  const clean = items.filter((it, i, a) => it !== "-" || (i > 0 && i < a.length - 1 && a[i - 1] !== "-"));
  for (const it of clean) {
    if (it === "-") {
      el.append(Object.assign(document.createElement("div"), { className: "ctx-sep" }));
      continue;
    }
    const b = document.createElement("button");
    b.className = "ctx-item";
    b.setAttribute("role", "menuitem");
    b.innerHTML = `<span class="ctx-label"></span><span class="ctx-keys"></span>`;
    b.querySelector(".ctx-label").textContent = it.label;
    b.querySelector(".ctx-keys").textContent = it.sub ? "▸" : (it.keys ?? "");
    if (it.sub) {
      const sub = document.createElement("div");
      sub.className = "ctx-menu ctx-sub";
      buildMenu(it.sub, sub);
      b.append(sub);
      b.classList.add("has-sub");
    } else {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenu();
        it.run();
      });
    }
    el.append(b);
  }
}

function closeMenu() {
  ctxMenu.classList.remove("open");
}

function objectMenu(at) {
  const one = selection.length === 1 ? selected : null;
  return [
    { label: "Ausschneiden", keys: "Strg+X", run: cutSelection },
    { label: "Kopieren", keys: "Strg+C", run: copySelection },
    clipboard && { label: "Hier einfügen", keys: "Strg+V", run: () => pasteObjects(clipboard, at) },
    { label: "Duplizieren", keys: "Strg+D", run: duplicateSelection },
    "-",
    {
      label: "Anordnen",
      sub: [
        { label: "Ganz nach vorn", keys: "Strg+Umschalt+↑", run: () => reorder("front") },
        { label: "Eine Ebene nach vorn", keys: "Strg+↑", run: () => reorder("forward") },
        { label: "Eine Ebene nach hinten", keys: "Strg+↓", run: () => reorder("backward") },
        { label: "Ganz nach hinten", keys: "Strg+Umschalt+↓", run: () => reorder("back") },
      ],
    },
    arrangeUnits().length > 1 && { label: "Ausrichten und angleichen", sub: arrangeMenuItems() },
    { label: "Fixieren (nicht mehr verschiebbar)", run: lockSelection },
    { label: "Format kopieren", keys: "Strg+Umschalt+C", run: copyFormat },
    formatClip && { label: "Format einfügen", keys: "Strg+Umschalt+V", run: () => pasteFormat() },
    one?.type === "image" && { label: "Bild ersetzen …", run: () => replaceImage(one) },
    selection.length > 1 && { label: "Gruppieren", keys: "Strg+G", run: groupSelection },
    selection.some((o) => o.group) && { label: "Gruppierung aufheben", keys: "Strg+Umschalt+G", run: ungroupSelection },
    frameTarget() && { label: "In den Rahmen aufnehmen", run: addToFrame },
    selection.some((o) => o.type !== "frame" && inAnyFrame(o)) && { label: "Aus dem Rahmen lösen", run: removeFromFrame },
    one?.type === "image" && { label: "Zuschneiden …", run: () => openCrop(one) },
    one?.type === "image" && { label: "Als Hintergrund verwenden", run: imageToBackground },
    one?.source && { label: "Original bearbeiten", run: () => editSource(one) },
    one?.type === "image" && { label: one.source ? "Andere Originaldatei verknüpfen …" : "Originaldatei verknüpfen …", run: () => attachSource(one) },
    one?.type === "text" && { label: "Text bearbeiten", keys: "Doppelklick", run: () => startEditing(one) },
    "-",
    { label: "Als Pfadschritt anhängen", run: addSelectedToPath },
    selection.some((o) => o.type !== "frame") && { label: "Rahmen um Auswahl (in den Pfad)", run: frameSelection },
    { label: "Beim Präsentieren einblenden", run: () => addAnimation("fade-in") },
    { label: "Beim Präsentieren ausblenden", run: () => addAnimation("fade-out") },
    one && { label: "Hierher zoomen", run: () => flyToObject(one) },
    "-",
    { label: "Löschen", keys: "Entf", run: deleteSelected },
  ].filter(Boolean);
}

function canvasMenu(at, lockedHit) {
  const locked = doc.objects.filter((o) => o.locked);
  return [
    lockedHit && { label: "Fixierung hier lösen", run: () => unlock(lockedHit.group ? groupOf(lockedHit) : [lockedHit]) },
    locked.length > 0 && { label: `Alle Fixierungen lösen (${locked.length})`, run: () => unlock(locked) },
    "-",
    clipboard && { label: "Hier einfügen", keys: "Strg+V", run: () => pasteObjects(clipboard, at) },
    "-",
    { label: "Text hier", run: () => addObject("text", at) },
    { label: "Rahmen hier", run: () => addObject("frame", at) },
    { label: "Rahmen aufziehen", keys: "R", run: () => setDrawFrame(true) },
    { label: "Bild einfügen …", run: chooseImages },
    { label: "Verknüpfte Grafik einfügen … (z. B. Origin)", run: () => insertLinkedGraphic(at) },
    {
      label: "Form",
      sub: ["rect", "rounded", "ellipse", "triangle", "hexagon", "star", "arrow", "bubble"].map((id) => ({
        label: SHAPES.find((s) => s.id === id)?.label ?? id,
        run: () => addObject(id, at),
      })),
    },
    "-",
    { label: "Alles auswählen", keys: "Strg+A", run: selectAll },
    { label: "Zum Überblick", keys: "Pos1", run: () => goTo(0) },
    { label: "Stil und Hintergrund …", run: () => openSidebar("style") },
    "-",
    { label: "Rückgängig", keys: "Strg+Z", run: undo },
    { label: "Wiederholen", keys: "Strg+Y", run: redo },
  ].filter(Boolean);
}

function openSidebar(tab) {
  if (!document.body.classList.contains("insertbar-open")) toggleSidebar();
  showTab(tab);
}

viewport.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (presenting || e.target.closest(".formatbar")) return;
  if (isEditing()) document.activeElement.blur();
  const at = eventToWorld(e);
  const hit = hitObject(e);
  if (hit && !selection.includes(hit)) select(hit);
  if (!hit) select(null);
  buildMenu(hit ? objectMenu(at) : canvasMenu(at, lockedAt(e)), ctxMenu);
  ctxMenu.classList.add("open");
  // Im Fenster halten.
  const w = ctxMenu.offsetWidth;
  const h = ctxMenu.offsetHeight;
  ctxMenu.style.left = `${Math.min(e.clientX, innerWidth - w - 4)}px`;
  ctxMenu.style.top = `${Math.min(e.clientY, innerHeight - h - 4)}px`;
  ctxMenu.classList.toggle("flip-sub", e.clientX + w * 2 > innerWidth);
});

// Außerhalb klicken, Esc, Scrollen oder Fensterwechsel schließt das Menü.
document.addEventListener("pointerdown", (e) => {
  if (!ctxMenu.contains(e.target)) closeMenu();
});
viewport.addEventListener("wheel", closeMenu, { passive: true });
window.addEventListener("blur", closeMenu);

// Das Browser-Menü (Neu laden, Untersuchen …) gibt es in der App nicht; in Eingabefeldern bleibt es.
document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest("input, textarea, [contenteditable='plaintext-only'], [contenteditable='true']")) e.preventDefault();
});

// ---------- Tasten und Knöpfe ----------

document.addEventListener("keydown", (e) => {
  if (ctxMenu.classList.contains("open")) {
    if (e.key === "Escape") e.preventDefault();
    closeMenu();
    if (e.key === "Escape") return;
  }
  if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    if (e.shiftKey) saveAs();
    else save();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openSearch();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (isEditing()) document.activeElement.blur();
    openPalette();
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
  // In Eingabefeldern (Suche, Notizen, Maße …) gehören Buchstaben, Pfeile und Entf dem Feld.
  if (e.target.closest?.("input, textarea, select") && !/^F\d+$/.test(e.key)) return;
  // Ebenen: Strg+↑/↓ einen Schritt, mit Umschalt ganz nach vorn/hinten.
  if (e.ctrlKey && !presenting && selection.length && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const up = e.key === "ArrowUp";
    reorder(e.shiftKey ? (up ? "front" : "back") : up ? "forward" : "backward");
    return;
  }
  if (e.ctrlKey && !presenting && (e.key === "#" || e.code === "Backslash")) {
    e.preventDefault();
    toggleGrid();
    return;
  }
  if (e.ctrlKey && !presenting && e.key.toLowerCase() === "g") {
    e.preventDefault();
    if (e.shiftKey) ungroupSelection();
    else groupSelection();
    return;
  }
  if (e.key === "Escape" && painting) {
    setPainting(false);
    return;
  }
  if (e.key === "Escape" && drawingFrame) {
    setDrawFrame(false);
    return;
  }
  if (!presenting && !e.ctrlKey && !e.altKey && (e.key === "?" || e.key === "F1")) {
    e.preventDefault();
    showShortcuts();
    return;
  }
  if (!presenting && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "r") {
    e.preventDefault();
    setDrawFrame(!drawingFrame);
    return;
  }
  // Format kopieren/einfügen wie in PowerPoint; preventDefault verhindert das normale Einfügen.
  if (e.ctrlKey && e.shiftKey && !presenting && ["c", "v"].includes(e.key.toLowerCase())) {
    e.preventDefault();
    if (e.key.toLowerCase() === "c") copyFormat();
    else pasteFormat();
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
  // Beim Präsentieren: B (oder .) schwarzer, W weißer Bildschirm – jede Taste kehrt zurück; L Laserpointer.
  if (presenting && !e.ctrlKey && !e.altKey) {
    if (blankMode) {
      e.preventDefault();
      return setBlank(null);
    } else {
      const k = e.key.toLowerCase();
      if (k === "b" || k === "w" || k === ".") {
        e.preventDefault();
        return setBlank(k === "w" ? "white" : "black");
      }
      if (k === "l") {
        e.preventDefault();
        return setLaser(!laserOn);
      }
    }
  }
  // Pfeiltasten verschieben die Auswahl (1 px, mit Umschalt 10 px auf dem Bildschirm); ohne Auswahl blättern sie im Pfad.
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir && !presenting && selection.length && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    nudge(dir, e.shiftKey ? 10 : 1);
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
document.getElementById("btn-export").addEventListener("pointerdown", (e) => e.stopPropagation());
on("btn-export", showExportMenu);
document.getElementById("btn-present-menu").addEventListener("pointerdown", (e) => e.stopPropagation());
on("btn-present-menu", showPresentMenu);
on("btn-grid", toggleGrid);
viewport.classList.toggle("grid-on", gridOn);
document.getElementById("btn-grid").classList.toggle("on", gridOn);
on("btn-insert", toggleSidebar);
on("btn-text-smaller", () => changeTextSize(1 / 1.15));
on("btn-text-bigger", () => changeTextSize(1.15));
on("btn-delete", deleteSelected);
on("btn-open", openFile);
on("btn-save", () => save());
on("btn-add-image", chooseImages);
on("btn-add-to-path", addSelectedToPath);
on("btn-fade-in", () => addAnimation("fade-in"));
on("btn-fade-out", () => addAnimation("fade-out"));
on("btn-bold", toggleBold);
on("btn-image-bg", imageToBackground);
on("btn-front", () => reorder("front"));
on("btn-forward", () => reorder("forward"));
on("btn-backward", () => reorder("backward"));
on("btn-back", () => reorder("back"));
on("btn-frame-add", addToFrame);
on("btn-frame-remove", removeFromFrame);
on("btn-italic", toggleItalic);
on("btn-list", toggleBullets);
on("btn-align", cycleAlign);
on("btn-undo", undo);
on("btn-frame-around", frameSelection);
on("btn-palette", openPalette);
on("btn-minimap", toggleMinimap);
on("btn-redo", redo);

// Vor dem Schließen nachfragen, wenn noch etwas ungespeichert ist.
appWindow?.onCloseRequested(async (event) => {
  if (!(await confirmDiscard())) event.preventDefault();
  else clearRecovery(); // bewusst beendet: nichts wiederherzustellen
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

// ---------- Bild zuschneiden ----------
// Dialog mit dem ganzen Bild und einem Ausschnitt-Rechteck (verschieben, an den Ecken ziehen). Übernommen wird
// o.crop (Anteile des Originalbilds); das Bild behält seinen Maßstab, der sichtbare Teil bleibt an seinem Platz.

function openCrop(o) {
  const m = media.get(o.src);
  if (!m) return;
  const old = o.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  let c = { ...old };
  const overlay = document.createElement("div");
  overlay.className = "crop-dialog";
  overlay.innerHTML = `<div class="crop-box"><div class="crop-stage"><img alt=""><div class="crop-rect">${["nw", "ne", "sw", "se"].map((k) => `<span class="crop-h" data-k="${k}"></span>`).join("")}</div></div>
    <div class="crop-buttons"><button data-a="reset">Ganzes Bild</button><span></span><button data-a="cancel">Abbrechen</button><button data-a="ok" class="primary">Übernehmen</button></div></div>`;
  const img = overlay.querySelector("img");
  const rect = overlay.querySelector(".crop-rect");
  img.src = m.url;
  const draw = () => Object.assign(rect.style, { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` });
  draw();
  let drag = null;
  overlay.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".crop-rect")) return;
    e.preventDefault();
    drag = { k: e.target.dataset.k ?? "move", x: e.clientX, y: e.clientY, c: { ...c }, r: img.getBoundingClientRect() };
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / drag.r.width;
    const dy = (e.clientY - drag.y) / drag.r.height;
    const s = drag.c;
    const min = 0.03;
    if (drag.k === "move") {
      c.x = clamp(s.x + dx, 0, 1 - s.w);
      c.y = clamp(s.y + dy, 0, 1 - s.h);
    } else {
      let [x0, y0, x1, y1] = [s.x, s.y, s.x + s.w, s.y + s.h];
      if (drag.k.includes("w")) x0 = clamp(x0 + dx, 0, x1 - min);
      if (drag.k.includes("e")) x1 = clamp(x1 + dx, x0 + min, 1);
      if (drag.k.includes("n")) y0 = clamp(y0 + dy, 0, y1 - min);
      if (drag.k.includes("s")) y1 = clamp(y1 + dy, y0 + min, 1);
      c = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    draw();
  });
  overlay.addEventListener("pointerup", () => (drag = null));
  overlay.addEventListener("click", (e) => {
    const a = e.target.dataset.a;
    if (a === "reset") {
      c = { x: 0, y: 0, w: 1, h: 1 };
      draw();
    }
    if (a === "cancel") overlay.remove();
    if (a !== "ok") return;
    overlay.remove();
    checkpoint();
    const fullW = o.w / old.w;
    const fullH = o.h / old.h;
    o.x += (c.x - old.x) * fullW;
    o.y += (c.y - old.y) * fullH;
    o.w = c.w * fullW;
    o.h = c.h * fullH;
    if (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1) delete o.crop;
    else o.crop = c;
    updateEl(o);
    updateToolbar();
  });
  overlay.addEventListener("keydown", (e) => e.key === "Escape" && overlay.remove());
  document.body.append(overlay);
  overlay.querySelector('[data-a="ok"]').focus();
}

// ---------- Autospeichern ----------
// Ungespeicherte Änderungen landen jede Minute in einer Wiederherstellungsdatei im App-Datenordner, nie in
// der eigenen Datei. Wird Weitblick ohne Speichern beendet (Absturz, Stromausfall), bietet der nächste Start
// die Wiederherstellung an.

let recoveryPath = null;
let autosaved = null;

async function autosave() {
  const snap = snapshot();
  if (!isDirty() || snap === autosaved) return;
  recoveryPath ??= await tauri.core.invoke("recovery_path");
  await writePresentation(recoveryPath, JSON.stringify({ ...doc, version: FORMAT_VERSION }));
  await tauri.core.invoke("save_recovery", { json: JSON.stringify({ path: currentPath, title: doc.title, time: Date.now() }) });
  autosaved = snap;
}

function clearRecovery() {
  autosaved = null;
  tauri?.core.invoke("save_recovery", { json: "{}" }).catch(() => {});
}

// Beim Start: liegt eine Wiederherstellung vor, fragen und sie als ungespeicherte Änderung öffnen.
async function offerRecovery() {
  let info;
  try {
    info = JSON.parse(await tauri.core.invoke("load_recovery"));
  } catch {
    return false;
  }
  if (!info?.time) return false;
  const when = new Date(info.time).toLocaleString("de-DE");
  const ok = await tauri.dialog.ask(`Weitblick wurde beendet, bevor „${info.title}“ gespeichert war (Stand ${when}). Wiederherstellen?`, {
    title: "Wiederherstellen",
    okLabel: "Wiederherstellen",
    cancelLabel: "Verwerfen",
  });
  if (!ok) {
    clearRecovery();
    return false;
  }
  try {
    recoveryPath ??= await tauri.core.invoke("recovery_path");
    const result = await tauri.core.invoke("open_presentation", { path: recoveryPath });
    loadDocument(JSON.parse(result.json), info.path, result.media);
    savedSnapshot = null; // gilt als ungespeichert, bis die eigene Datei gespeichert ist
    showFileName();
    return true;
  } catch (err) {
    await tauri.dialog.message(String(err?.message ?? err), { title: "Wiederherstellen fehlgeschlagen", kind: "error" });
    return false;
  }
}

if (tauri) setInterval(() => autosave().catch(() => {}), 60000);

// ---------- Verknüpfte Grafiken (z. B. Graphen aus Origin) ----------
// o.link = { path, mtime }: die Grafikdatei auf der Festplatte; ändert sie sich, wird das Bild ersetzt.
// o.source = { path, file, mtime }: die Originaldatei (z. B. .opju), als Kopie unter media/ eingebettet.

const LINK_TYPES = ["svg", "png", "jpg", "jpeg", "webp", "gif"];

async function insertLinkedGraphic(at = null) {
  const path = await tauri.dialog.open({ multiple: false, filters: [{ name: "Grafik (SVG, PNG, JPG)", extensions: LINK_TYPES }] });
  if (!path) return;
  const file = await tauri.core.invoke("import_media", { path });
  checkpoint();
  const o = await placeImage(extOf(file.name), file.data, at);
  const [mtime] = await tauri.core.invoke("file_mtimes", { paths: [path] });
  o.link = { path, mtime };
  const withSource = await tauri.dialog.ask(
    "Die Grafik aktualisiert sich, sobald die Datei neu gespeichert wird.\n\nSoll auch die Originaldatei (z. B. das Origin-Projekt) verknüpft und eingebettet werden? Dann öffnet „Original bearbeiten“ sie per Rechtsklick.",
    { title: "Verknüpfte Grafik", okLabel: "Originaldatei wählen …", cancelLabel: "Nein" },
  );
  if (withSource) await attachSource(o, false);
}

async function attachSource(o, undoable = true) {
  const path = await tauri.dialog.open({ multiple: false, title: "Originaldatei wählen (z. B. Origin-Projekt)" });
  if (!path) return;
  const file = await tauri.core.invoke("import_media", { path });
  if (undoable) checkpoint();
  const name = `media/source-${o.id}-${file.name.replace(/[^\w.-]/g, "_")}`;
  addMedia(name, file.data);
  const [mtime] = await tauri.core.invoke("file_mtimes", { paths: [path] });
  o.source = { path, file: name, mtime };
  showFileName();
}

// Original öffnen: am verknüpften Ort, sonst die eingebettete Kopie (im Temp-Ordner, wird ebenfalls beobachtet).
async function editSource(o) {
  try {
    const [exists] = await tauri.core.invoke("existing_files", { paths: [o.source.path] });
    if (!exists) {
      const m = media.get(o.source.file);
      if (!m) throw new Error("Die Originaldatei ist weder am verknüpften Ort noch eingebettet.");
      o.source.path = await tauri.core.invoke("write_temp", { name: o.source.file.split("/").pop().replace(/^source-[^-]+-/, ""), data: await mediaData(o.source.file) });
      [o.source.mtime] = await tauri.core.invoke("file_mtimes", { paths: [o.source.path] });
    }
    await tauri.core.invoke("open_file", { path: o.source.path });
  } catch (err) {
    await tauri.dialog.message(String(err?.message ?? err), { title: "Original bearbeiten", kind: "error" });
  }
}

// Alle zwei Sekunden prüfen, ob sich verknüpfte Dateien geändert haben (einfacher als ein Dateiwächter, reicht hier).
async function checkLinks() {
  const watched = doc.objects.flatMap((o) => [o.link && { o, kind: "link", ref: o.link }, o.source && { o, kind: "source", ref: o.source }].filter(Boolean));
  if (!watched.length) return;
  const times = await tauri.core.invoke("file_mtimes", { paths: watched.map((w) => w.ref.path) });
  for (const [i, w] of watched.entries()) {
    if (!times[i] || times[i] === w.ref.mtime) continue;
    try {
      const file = await tauri.core.invoke("import_media", { path: w.ref.path });
      w.ref.mtime = times[i];
      if (w.kind === "link") {
        addMedia(w.o.src, file.data);
        const el = elOf(w.o);
        if (el) updateEl(w.o, el);
      } else addMedia(w.o.source.file, file.data);
      showFileName();
    } catch {
      // Datei wird vielleicht gerade noch geschrieben: beim nächsten Durchgang erneut versuchen.
    }
  }
}
if (tauri) setInterval(() => checkLinks().catch(() => {}), 2000);

// ---------- Startseite: zuletzt geöffnete Präsentationen ----------
// recent.json im App-Datenordner: [{ path, title, opened, thumb }], thumb ist ein kleines JPEG des Überblicks.

const startEl = document.getElementById("start");
let recent = [];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Vorschaubild des Überblicks auf einer Leinwand zeichnen: Hintergrund, Formen, Bilder und Texte (vereinfacht).
// Ohne step: Überblick fürs Startbild. Mit step: Ausschnitt dieses Pfadschritts wie beim Präsentieren
// (eingeblendete Objekte, Kapiteldeckel) – für die Referentenansicht.
async function thumbnail(step = null, W = 320, H = 180) {
  let ov = byId.get(doc.path[0]);
  let cam = null;
  let hidden = new Set();
  const aspect = aspectRatio();
  if (step !== null) {
    if (doc.path[step] === undefined) return null;
    cam = stepCamera(step);
    const ch = cam.w / aspect;
    ov = { x: cam.cx - cam.w / 2, y: cam.cy - ch / 2, w: cam.w, h: ch };
    hidden = hiddenAt(step);
  }
  if (!ov) return null;
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = doc.theme.background;
  ctx.fillRect(0, 0, W, H);
  const bg = doc.background?.src && media.get(doc.background.src);
  if (bg) {
    const img = await loadImage(bg.url).catch(() => null);
    if (img) {
      const k = Math.max(W / img.width, H / img.height);
      ctx.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
    }
  }
  const k = Math.min(W / ov.w, H / ov.h);
  const ox = (W - ov.w * k) / 2 - ov.x * k;
  const oy = (H - ov.h * k) / 2 - ov.y * k;
  for (const o of doc.objects) {
    if (o.hidden || o.type === "frame" || hidden.has(o.id)) continue;
    if (cam ? (o.cover || o.inside) && zoomFade(o, cam, aspect) < 0.5 : o.inside) continue;
    const w = o.w * k;
    const h = o.h * k;
    if (w < 0.5 && h < 0.5) continue;
    ctx.save();
    ctx.translate(ox + (o.x + o.w / 2) * k, oy + (o.y + o.h / 2) * k);
    if (o.rot) ctx.rotate((o.rot * Math.PI) / 180);
    ctx.globalAlpha = o.opacity ?? 1;
    if (o.type === "image" && media.get(o.src)) {
      const img = await loadImage(media.get(o.src).url).catch(() => null);
      const c = o.crop ?? { x: 0, y: 0, w: 1, h: 1 };
      if (img) ctx.drawImage(img, c.x * img.width, c.y * img.height, c.w * img.width, c.h * img.height, -w / 2, -h / 2, w, h);
    } else if (o.type === "shape" || o.type === "icon") {
      const svg = o.type === "icon" ? iconSvg(o.name).replace(/currentColor/g, o.color ?? doc.theme.text) : shapeSvg(o.shape, o.fill, o.points, 0);
      if (svg) {
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '))}`;
        const img = await loadImage(url).catch(() => null);
        if (img) ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = o.fill;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
    } else if (o.type === "text" && o.size * k >= 1.5) {
      // Zeile für Zeile, formatierte Abschnitte (o.spans) mit eigener Fettung, Kursivschrift und Farbe.
      const base = { b: textWeight(o) >= 600, i: textItalic(o), c: o.color || doc.theme.text };
      const fontOf = (st) => `${st.i ? "italic " : ""}${st.b ? 700 : textWeight(o)} ${o.size * k}px ${fontStack(textFont(o))}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      let at = 0;
      o.text.split("\n").forEach((line, li) => {
        const cuts = new Set([0, line.length]);
        for (const r of o.spans ?? []) for (const c of [r.s - at, r.e - at]) if (c > 0 && c < line.length) cuts.add(c);
        const pts = [...cuts].sort((a, b) => a - b);
        const segs = pts.slice(0, -1).map((p, n) => {
          const r = o.spans?.find((r) => r.s <= at + p && r.e >= at + pts[n + 1]) ?? {};
          const st = { b: r.b ?? base.b, i: r.i ?? base.i, c: r.c ?? base.c };
          ctx.font = fontOf(st);
          const t = line.slice(p, pts[n + 1]);
          return { t, st, w: ctx.measureText(t).width };
        });
        const total = segs.reduce((s, g) => s + g.w, 0);
        let x = o.align === "center" ? -total / 2 : o.align === "right" ? w / 2 - total : -w / 2;
        for (const g of segs) {
          ctx.font = fontOf(g.st);
          ctx.fillStyle = g.st.c;
          ctx.fillText(g.t, x, -h / 2 + li * o.size * k * 1.25);
          x += g.w;
        }
        at += line.length + 1;
      });
    }
    ctx.restore();
  }
  return canvas.toDataURL("image/jpeg", 0.75);
}

async function loadRecent() {
  try {
    recent = JSON.parse(await tauri.core.invoke("load_recent"));
  } catch {
    recent = [];
  }
}

function storeRecent() {
  tauri?.core.invoke("save_recent", { json: JSON.stringify(recent) }).catch(() => {});
}

// Nach dem Öffnen und Speichern: Eintrag nach vorn, mit frischem Vorschaubild.
async function rememberRecent(path) {
  if (!path) return;
  await document.fonts.ready;
  const thumb = await thumbnail().catch(() => null);
  recent = [{ path, title: doc.title, opened: Date.now(), thumb }, ...recent.filter((r) => r.path !== path)].slice(0, 24);
  storeRecent();
}

function relativeDate(ms) {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return "heute";
  if (days < 2) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return new Date(ms).toLocaleDateString("de-DE");
}

async function showStart() {
  if (presenting) return;
  await loadRecent();
  const exists = await tauri?.core.invoke("existing_files", { paths: recent.map((r) => r.path) }).catch(() => null);
  const grid = document.getElementById("recent-grid");
  grid.replaceChildren();
  recent.forEach((r, i) => {
    const missing = exists && !exists[i];
    const card = document.createElement("div");
    card.className = `recent-card${missing ? " missing" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.title = missing ? `Nicht gefunden: ${r.path}` : r.path;
    const folder = r.path.split(/[\\/]/).slice(-2, -1)[0] ?? "";
    card.innerHTML = `<img class="thumb" alt=""><div class="meta"><span class="name"></span><span class="where"></span></div><button class="remove" title="Aus der Liste entfernen" aria-label="Aus der Liste entfernen">×</button>`;
    if (r.thumb) card.querySelector(".thumb").src = r.thumb;
    card.querySelector(".name").textContent = r.title || r.path.split(/[\\/]/).pop();
    card.querySelector(".where").textContent = missing ? "Datei nicht gefunden" : `${relativeDate(r.opened)} · ${folder}`;
    const open = async () => {
      if (missing || !(await confirmDiscard())) return;
      hideStart();
      // PowerPoint und Offline-Prezis stehen ebenfalls in der Liste und werden erneut importiert.
      await (/\.(pptx|zip)$/i.test(r.path) ? importPath(r.path) : openPath(r.path));
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => e.key === "Enter" && e.target === card && open());
    card.querySelector(".remove").addEventListener("click", (e) => {
      e.stopPropagation();
      recent = recent.filter((x) => x !== r);
      storeRecent();
      showStart();
    });
    grid.append(card);
  });
  document.getElementById("start-empty").hidden = recent.length > 0;
  await showTemplates();
  startEl.hidden = false;
}

// ---------- Vorlagen ----------
// Eingebaute Vorlagen (templates.js) und eigene: „Export ▾“ → „Als Vorlage speichern“ legt die aktuelle
// Präsentation in den Vorlagen-Ordner der App. Eine Vorlage öffnet sich als neue, ungespeicherte Präsentation.

function templateCard(name, note, colors, onOpen, onRemove) {
  const card = document.createElement("div");
  card.className = "recent-card template-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.title = note;
  card.innerHTML = `<div class="tpl-swatch"><span></span><span></span></div><div class="meta"><span class="name"></span><span class="where"></span></div>`;
  const [bg, a, b] = colors;
  const sw = card.querySelector(".tpl-swatch");
  sw.style.background = bg;
  sw.children[0].style.background = a;
  sw.children[1].style.background = b;
  card.querySelector(".name").textContent = name;
  card.querySelector(".where").textContent = note;
  card.addEventListener("click", onOpen);
  card.addEventListener("keydown", (e) => e.key === "Enter" && e.target === card && onOpen());
  if (onRemove) {
    const x = Object.assign(document.createElement("button"), { className: "remove", title: "Vorlage löschen", textContent: "×" });
    x.setAttribute("aria-label", "Vorlage löschen");
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      onRemove();
    });
    card.append(x);
  }
  return card;
}

async function showTemplates() {
  const grid = document.getElementById("template-grid");
  grid.replaceChildren();
  for (const t of TEMPLATES) {
    const th = THEMES.find((x) => x.id === t.theme);
    grid.append(templateCard(t.name, t.note, [th.background, th.accent, th.accent2], () => startFromTemplate(t.doc(), null)));
  }
  const own = await tauri?.core.invoke("list_templates").catch(() => []);
  for (const path of own ?? []) {
    const name = path.split(/[\\/]/).pop().replace(/\.weitblick$/i, "");
    grid.append(
      templateCard(name, "Eigene Vorlage", ["#3c7a73", "#f28c38", "#fffaf4"], () => startFromTemplate(null, path), async () => {
        if (!(await tauri.dialog.ask(`Vorlage „${name}“ löschen?`, { title: "Vorlage löschen", kind: "warning" }))) return;
        await tauri.core.invoke("delete_template", { path }).catch(() => {});
        showTemplates();
      }),
    );
  }
}

async function startFromTemplate(built, path) {
  if (!(await confirmDiscard())) return;
  hideStart();
  if (presenting) await stopPresentation();
  try {
    if (path) {
      const result = await tauri.core.invoke("open_presentation", { path });
      loadDocument(JSON.parse(result.json), null, result.media);
    } else {
      loadDocument(built, null);
      // Schriften des Stils nachladen; ohne Internet bleibt die Ersatzschrift.
      for (const f of new Set(Object.values(doc.theme.fonts))) await embedGoogleFont(f, styleStatus);
      buildWorld();
    }
    markSaved(); // eine frische Vorlage ist noch keine ungesicherte Änderung
  } catch (err) {
    await tauri.dialog.message(String(err?.message ?? err), { title: "Vorlage", kind: "error" });
  }
}

async function saveAsTemplate() {
  if (isEditing()) document.activeElement.blur();
  try {
    const dir = await tauri.core.invoke("template_dir");
    const name = (doc.title || "Vorlage").replace(/[\\/:*?"<>|]/g, "_").trim() || "Vorlage";
    await writePresentation(`${dir}/${name}.weitblick`, JSON.stringify({ ...doc, version: FORMAT_VERSION }), currentPath);
    await tauri.dialog.message(`„${name}“ steht jetzt unter „Start“ bei den Vorlagen.`, { title: "Als Vorlage gespeichert", kind: "info" });
  } catch (err) {
    await tauri.dialog.message(String(err?.message ?? err), { title: "Vorlage speichern fehlgeschlagen", kind: "error" });
  }
}

function hideStart() {
  startEl.hidden = true;
}

document.getElementById("btn-start").addEventListener("click", showStart);
document.getElementById("start-close").addEventListener("click", hideStart);
startEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    hideStart();
  }
});
startEl.querySelector(".start-actions").addEventListener("click", async (e) => {
  const what = e.target.closest("button")?.dataset.start;
  if (!what) return;
  hideStart();
  if (what === "new") await newDocument();
  if (what === "open") await openFile();
  if (what === "demo" && (await confirmDiscard())) loadDocument(structuredClone(demo), null);
});

// ---------- Fotos (Openverse) ----------
// Frei lizenzierte Bilder suchen; das gewählte wird eingebettet (danach offline) und bekommt
// einen kleinen Urhebervermerk darunter, mit dem Bild gruppiert.

const photoGrid = sidebar.querySelector(".photo-grid");
const photoStatus = sidebar.querySelector(".photo-status");
const photoMore = document.getElementById("photo-more");
let photoQuery = "";
let photoPage = 1;

const LICENSES = { cc0: "CC0", pdm: "gemeinfrei" };
function creditLine(r) {
  const lic = LICENSES[r.license] ?? `CC ${r.license.toUpperCase()} ${r.license_version ?? ""}`.trim();
  return `Foto: ${r.title ? `„${r.title}“ ` : ""}${r.creator ? `von ${r.creator} ` : ""}· ${lic} · ${r.source ?? "Openverse"}`;
}

async function searchPhotos(query, more = false) {
  photoQuery = query.trim();
  if (!photoQuery) return;
  photoPage = more ? photoPage + 1 : 1;
  if (!more) photoGrid.replaceChildren();
  photoMore.hidden = true;
  photoStatus.textContent = "Suche …";
  try {
    const res = JSON.parse(await tauri.core.invoke("openverse_search", { query: photoQuery, page: photoPage }));
    for (const r of res.results) {
      const b = document.createElement("button");
      b.title = `${creditLine(r)}\nKlicken: einfügen · Ziehen: an eine Stelle legen`;
      const img = Object.assign(document.createElement("img"), { src: r.thumbnail, alt: r.title ?? "", loading: "lazy" });
      b.append(img);
      b.addEventListener("click", () => insertPhoto(r));
      dragToCanvas(b, (at) => insertPhoto(r, at));
      photoGrid.append(b);
    }
    photoStatus.textContent = res.result_count ? `${res.result_count} Treffer` : "Nichts gefunden – vielleicht auf Englisch suchen?";
    photoMore.hidden = photoPage >= Math.min(res.page_count, 20);
  } catch (err) {
    photoStatus.textContent = String(err?.message ?? err);
  }
}

async function insertPhoto(r, at = null) {
  photoStatus.textContent = "Lade Bild …";
  let file;
  try {
    file = await tauri.core.invoke("web_image", { url: r.url });
  } catch {
    // Manche Quellen liefern das Original nicht aus; dann die Vorschau von Openverse.
    try {
      file = await tauri.core.invoke("web_image", { url: r.thumbnail });
    } catch (err) {
      photoStatus.textContent = String(err?.message ?? err);
      return;
    }
  }
  checkpoint();
  const img = await placeImage(extOf(file.name), file.data, at);
  const g = `g-${Date.now().toString(36)}`;
  const size = img.w * 0.022;
  const credit = { id: newId("t"), type: "text", role: "body", text: creditLine(r), x: img.x, y: img.y + img.h + size * 0.4, w: img.w, h: size * 1.3, size, opacity: 0.7, group: g };
  img.group = g;
  doc.objects.push(credit);
  buildWorld();
  setSelection([img, credit]);
  photoStatus.textContent = "Eingefügt – der Urhebervermerk gehört dazu (Lizenz beachten).";
}

const photoSearch = document.getElementById("photo-search");
photoSearch.addEventListener("keydown", (e) => e.key === "Enter" && searchPhotos(photoSearch.value));
photoMore.addEventListener("click", () => searchPhotos(photoQuery, true));

// ---------- Aus der Seitenleiste auf die Leinwand ziehen ----------
// Eigene Zeigerlogik wie beim Pfad (Tauri fängt HTML-Drag-and-drop ab). Ein Klick fügt wie bisher in der Mitte ein.

let suppressClickUntil = 0;
sidebar.addEventListener("click", (e) => Date.now() < suppressClickUntil && e.stopPropagation(), true);

function dragToCanvas(el, insert) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    let ghost = null;
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
      if (!ghost) {
        ghost = el.cloneNode(true);
        ghost.classList.add("drag-ghost");
        document.body.append(ghost);
      }
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    };
    const up = (ev) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      if (!ghost) return;
      ghost.remove();
      suppressClickUntil = Date.now() + 100;
      if (!viewport.contains(document.elementFromPoint(ev.clientX, ev.clientY))) return;
      const r = viewport.getBoundingClientRect();
      insert(screenToWorld(ev.clientX - r.left, ev.clientY - r.top));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
}

// ---------- Pfadnummern an den Rahmen ----------
// Jeder Rahmen zeigt seine Schrittnummer(n); ein Klick darauf nimmt ihn in den Pfad auf oder heraus.

function updatePathBadges() {
  world.querySelectorAll(".path-badge").forEach((b) => b.remove());
  for (const o of doc.objects) {
    if (o.type !== "frame" || o.id === doc.path[0]) continue;
    const el = elOf(o);
    if (!el) continue;
    const nums = doc.path.flatMap((id, i) => (id === o.id ? [i] : []));
    const b = document.createElement("span");
    b.className = `path-badge${nums.length ? "" : " off"}`;
    b.dataset.frame = o.id;
    b.textContent = nums.length ? nums.join(" · ") : "+";
    b.title = nums.length ? "Pfadschritt – klicken nimmt den Rahmen aus dem Pfad" : "Nicht im Pfad – klicken hängt den Rahmen an";
    el.append(b);
  }
}

function togglePathFor(id) {
  checkpoint();
  if (doc.path.includes(id)) {
    doc.path = doc.path.filter((p, i) => i === 0 || p !== id);
    pathIndex = Math.min(pathIndex, doc.path.length - 1);
    buildPathList();
  } else addToPath(id);
}

// ---------- Rahmen um die Auswahl / Rahmen aufziehen ----------

function frameSelection() {
  const items = selection.filter((o) => o.type !== "frame");
  if (!items.length) return;
  checkpoint();
  setSelection(items);
  const f = frameAndAddToPath(items, "Neuer Rahmen");
  setSelection([f]);
}

let drawingFrame = false;
function setDrawFrame(on) {
  drawingFrame = on;
  viewport.classList.toggle("draw-frame", on);
  if (on) showToast("Rahmen aufziehen: auf der Leinwand ziehen (Esc bricht ab)");
}

// Aus einem gezogenen Rechteck einen Rahmen im Seitenverhältnis machen; was ganz darin liegt, gehört dazu.
function frameFromRect(b) {
  let w = b.w;
  let h = b.h;
  const ratio = aspectRatio();
  if (w / h < ratio) w = h * ratio;
  else h = w / ratio;
  checkpoint();
  const f = { id: newId("f"), type: "frame", x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h, title: "Neuer Rahmen" };
  for (const o of doc.objects) if (o.type !== "frame" && !o.frame && inside(o, f)) o.frame = f.id;
  doc.objects.splice(1, 0, f);
  growOverview(f);
  buildWorld();
  addToPath(f.id);
  select(f);
}

// ---------- Befehlssuche (Strg+K) und Tastenkürzel (?) ----------

function commands() {
  return [
    { label: "Neue Präsentation", keys: "Strg+N", run: newDocument },
    { label: "Öffnen …", keys: "Strg+O", run: openFile },
    { label: "Speichern", keys: "Strg+S", run: () => save() },
    { label: "Speichern unter …", keys: "Strg+Umschalt+S", run: saveAs },
    { label: "Startseite und Vorlagen", run: showStart },
    { label: "Als Vorlage speichern", run: saveAsTemplate },
    { label: "PDF exportieren …", run: printDeck },
    { label: "PowerPoint exportieren (Morph) …", run: () => exportPptx(true) },
    { label: "PowerPoint exportieren (klassisch) …", run: () => exportPptx(false) },
    { label: "Präsentieren", keys: "F5", run: () => startPresentation(false) },
    { label: "Ab aktuellem Schritt präsentieren", keys: "Umschalt+F5", run: () => startPresentation(true) },
    { label: "Text einfügen", run: () => addObject("text") },
    { label: "Rahmen einfügen", run: () => addObject("frame") },
    { label: "Rahmen aufziehen", keys: "R", run: () => setDrawFrame(true) },
    selection.length && { label: "Rahmen um Auswahl", run: frameSelection },
    { label: "Bild von der Festplatte einfügen …", run: chooseImages },
    { label: "Fotos suchen (Openverse)", run: () => (openSidebar("photos"), photoSearch.focus()) },
    { label: "Symbole", run: () => (openSidebar("icons"), document.getElementById("icon-search").focus()) },
    { label: "Formen", run: () => openSidebar("shapes") },
    { label: "Diagramme", run: () => openSidebar("diagrams") },
    { label: "Stil und Hintergrund", run: () => openSidebar("style") },
    { label: "Schriften", run: () => openSidebar("fonts") },
    { label: "Suchen", keys: "Strg+F", run: openSearch },
    { label: "Rückgängig", keys: "Strg+Z", run: undo },
    { label: "Wiederholen", keys: "Strg+Y", run: redo },
    { label: "Alles auswählen", keys: "Strg+A", run: selectAll },
    { label: "Kopieren", keys: "Strg+C", run: copySelection },
    { label: "Ausschneiden", keys: "Strg+X", run: cutSelection },
    { label: "Duplizieren", keys: "Strg+D", run: duplicateSelection },
    { label: "Löschen", keys: "Entf", run: deleteSelected },
    { label: "Gruppieren", keys: "Strg+G", run: groupSelection },
    { label: "Gruppierung aufheben", keys: "Strg+Umschalt+G", run: ungroupSelection },
    { label: "Format kopieren", keys: "Strg+Umschalt+C", run: copyFormat },
    { label: "Format einfügen", keys: "Strg+Umschalt+V", run: () => pasteFormat() },
    { label: "Ganz nach vorn", keys: "Strg+Umschalt+↑", run: () => reorder("front") },
    { label: "Ganz nach hinten", keys: "Strg+Umschalt+↓", run: () => reorder("back") },
    { label: "Als Pfadschritt anhängen", run: addSelectedToPath },
    { label: "Zum Überblick", keys: "Pos1", run: () => goTo(0) },
    { label: "Raster an/aus", keys: "Strg+#", run: toggleGrid },
    { label: "Minikarte an/aus", run: toggleMinimap },
    { label: "Seitenleiste an/aus", run: toggleSidebar },
    { label: "Tastenkürzel anzeigen", keys: "?", run: showShortcuts },
    { label: "Einführung zeigen", run: () => showTour(0) },
    ...(arrangeUnits().length > 1 ? arrangeMenuItems() : []).filter((c) => c.run).map((c) => ({ ...c, label: `Ausrichten: ${c.label}` })),
    ...SHAPES.map((s) => ({ label: `Form: ${s.label}`, run: () => addObject(s.id) })),
    ...DIAGRAMS.map((d) => ({ label: `Diagramm: ${d.label}`, run: () => insertDiagram(d.id) })),
  ].filter((c) => c && c.run);
}

// Weitere Tastenkürzel, die keine Befehle in der Liste sind.
const EXTRA_KEYS = [
  ["Pfeiltasten", "Auswahl verschieben (Umschalt: 10 px) · ohne Auswahl: blättern"],
  ["Strg/Umschalt+Klick", "Zur Auswahl hinzufügen"],
  ["Umschalt+Ziehen", "Auswahlrechteck"],
  ["Alt beim Ziehen", "Ohne Einrasten"],
  ["Doppelklick", "Text bearbeiten"],
  ["Strg+B / Strg+I", "Fett / kursiv"],
  ["Strg+K", "Befehlssuche"],
  ["Beim Präsentieren: B, W, L", "Schwarz, weiß, Laserpointer"],
];

function overlay(cls) {
  const o = document.createElement("div");
  o.className = `overlay ${cls}`;
  o.addEventListener("pointerdown", (e) => e.target === o && o.remove());
  o.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") o.remove();
  });
  document.body.append(o);
  return o;
}

function openPalette() {
  if (presenting || document.querySelector(".palette")) return;
  const all = commands();
  const o = overlay("palette-overlay");
  o.innerHTML = `<div class="palette" role="dialog" aria-label="Befehlssuche"><input type="search" placeholder="Was möchtest du tun? (z. B. Kreis, PDF, Rahmen)" /><ul role="listbox"></ul></div>`;
  const input = o.querySelector("input");
  const list = o.querySelector("ul");
  let hits = [];
  let at = 0;
  const run = (c) => {
    o.remove();
    c.run();
  };
  const show = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    hits = all.filter((c) => words.every((w) => c.label.toLowerCase().includes(w))).slice(0, 12);
    at = Math.min(at, Math.max(0, hits.length - 1));
    list.replaceChildren(
      ...hits.map((c, i) => {
        const li = document.createElement("li");
        li.className = i === at ? "on" : "";
        li.innerHTML = `<span></span><kbd></kbd>`;
        li.firstChild.textContent = c.label;
        li.lastChild.textContent = c.keys ?? "";
        li.addEventListener("click", () => run(c));
        return li;
      }),
    );
  };
  input.addEventListener("input", () => ((at = 0), show()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % Math.max(1, hits.length);
      show();
    } else if (e.key === "Enter" && hits[at]) run(hits[at]);
  });
  show();
  input.focus();
}

function showShortcuts() {
  if (document.querySelector(".shortcuts")) return;
  const o = overlay("shortcut-overlay");
  o.tabIndex = -1;
  const rows = [...commands().filter((c) => c.keys).map((c) => [c.keys, c.label]), ...EXTRA_KEYS];
  o.innerHTML = `<div class="shortcuts" role="dialog" aria-label="Tastenkürzel"><h2>Tastenkürzel</h2><dl></dl><p class="note">Strg+K findet jede Funktion. Esc schließt.</p></div>`;
  o.querySelector("dl").append(
    ...rows.flatMap(([k, v]) => [Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v })]),
  );
  o.focus();
}

// ---------- Minikarte ----------
// Zeigt die ganze Präsentation klein mit dem aktuellen Ausschnitt; Klicken oder Ziehen springt dorthin.

const minimap = document.createElement("canvas");
minimap.className = "minimap";
minimap.width = 200;
minimap.height = 120;
minimap.title = "Minikarte – klicken oder ziehen springt dorthin";
viewport.append(minimap);
let minimapOn = true;
try {
  minimapOn = localStorage.getItem("weitblick-minimap") !== "0";
} catch {
  // ohne Speicher: an
}
minimap.hidden = !minimapOn;
document.getElementById("btn-minimap").classList.toggle("on", minimapOn);
let minimapQueued = false;
let minimapBox = null;

function toggleMinimap() {
  minimapOn = !minimapOn;
  minimap.hidden = !minimapOn;
  document.getElementById("btn-minimap").classList.toggle("on", minimapOn);
  try {
    localStorage.setItem("weitblick-minimap", minimapOn ? "1" : "0");
  } catch {}
  drawMinimap();
}

function queueMinimap() {
  if (!minimapOn || minimapQueued) return;
  minimapQueued = true;
  requestAnimationFrame(() => {
    minimapQueued = false;
    drawMinimap();
  });
}

// shortcut: Kameradrehung wird in der Minikarte nicht gezeigt, nur der Ausschnitt; bei Bedarf als gedrehtes Rechteck zeichnen.
// Die Objekte liegen gezeichnet in minimapCache; bei einer Kamerabewegung kommt nur das Rechteck neu dazu.
const minimapCache = Object.assign(document.createElement("canvas"), { width: minimap.width, height: minimap.height });
let minimapStale = true;
function staleMinimap() {
  minimapStale = true;
  queueMinimap();
}

function drawMinimap() {
  if (!minimapOn || presenting) return;
  if (minimapStale) drawMinimapObjects();
  if (!minimapBox) return;
  const ctx = minimap.getContext("2d");
  const { k, ox, oy } = minimapBox;
  ctx.drawImage(minimapCache, 0, 0);
  const ch = (camera.w * viewport.clientHeight) / viewport.clientWidth;
  ctx.strokeStyle = "#f28c38";
  ctx.lineWidth = 2;
  ctx.strokeRect(ox + (camera.cx - camera.w / 2) * k, oy + (camera.cy - ch / 2) * k, camera.w * k, ch * k);
}

function drawMinimapObjects() {
  minimapStale = false;
  const ctx = minimapCache.getContext("2d");
  const W = minimap.width;
  const H = minimap.height;
  const shown = doc.objects.filter((o) => !o.hidden);
  const ov = byId.get(doc.path[0]);
  const all = ov ? [ov, ...shown] : shown;
  if (!all.length) return;
  const x1 = Math.min(...all.map((o) => o.x));
  const y1 = Math.min(...all.map((o) => o.y));
  const x2 = Math.max(...all.map((o) => o.x + o.w));
  const y2 = Math.max(...all.map((o) => o.y + o.h));
  const k = Math.min((W - 8) / (x2 - x1), (H - 8) / (y2 - y1));
  const ox = (W - (x2 - x1) * k) / 2 - x1 * k;
  const oy = (H - (y2 - y1) * k) / 2 - y1 * k;
  minimapBox = { k, ox, oy };
  ctx.fillStyle = doc.theme.background;
  ctx.fillRect(0, 0, W, H);
  for (const o of shown) {
    const r = [ox + o.x * k, oy + o.y * k, Math.max(1, o.w * k), Math.max(1, o.h * k)];
    if (o.type === "frame") {
      ctx.strokeStyle = doc.theme.accent2;
      ctx.lineWidth = 1;
      ctx.strokeRect(...r);
    } else {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = o.type === "text" ? o.color || doc.theme.text : o.type === "image" ? "#8a8f98" : o.fill || o.color || doc.theme.accent;
      ctx.fillRect(...r);
      ctx.globalAlpha = 1;
    }
  }
}

function minimapJump(e) {
  if (!minimapBox) return;
  const r = minimap.getBoundingClientRect();
  const { k, ox, oy } = minimapBox;
  camera.stop();
  cameraBusy();
  camera.set({ w: camera.w, cx: ((e.clientX - r.left) * (minimap.width / r.width) - ox) / k, cy: ((e.clientY - r.top) * (minimap.height / r.height) - oy) / k });
}
minimap.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  minimap.setPointerCapture(e.pointerId);
  minimapJump(e);
});
minimap.addEventListener("pointermove", (e) => minimap.hasPointerCapture(e.pointerId) && minimapJump(e));
minimap.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

// ---------- Einführung beim ersten Start ----------

const TOUR = [
  "Mausrad zoomt, Ziehen auf freier Fläche verschiebt die Ansicht. Die Minikarte unten rechts zeigt, wo du bist.",
  "Rahmen sind die Stationen deiner Präsentation. Taste R drücken und ziehen zeichnet einen Rahmen – er kommt gleich in den Pfad.",
  "Formen, Symbole und Fotos (◫ Einfügen) ziehst du aus der Seitenleiste direkt an ihren Platz.",
  "Die Nummer an einem Rahmen ist sein Pfadschritt. Ein Klick darauf nimmt ihn in den Pfad auf oder heraus.",
  "Strg+K findet jede Funktion, ? zeigt alle Tastenkürzel. Mit F5 geht's los. Viel Spaß!",
];

function showTour(i) {
  document.querySelector(".tour")?.remove();
  if (i >= TOUR.length) {
    try {
      localStorage.setItem("weitblick-tour", "done");
    } catch {}
    return;
  }
  const card = document.createElement("div");
  card.className = "tour";
  card.setAttribute("role", "status");
  card.innerHTML = `<span class="tour-step"></span><p></p><div><button class="tour-skip">Überspringen</button><button class="tour-next primary"></button></div>`;
  card.querySelector(".tour-step").textContent = `Tipp ${i + 1} von ${TOUR.length}`;
  card.querySelector("p").textContent = TOUR[i];
  card.querySelector(".tour-next").textContent = i === TOUR.length - 1 ? "Fertig" : "Weiter";
  card.querySelector(".tour-next").addEventListener("click", () => showTour(i + 1));
  card.querySelector(".tour-skip").addEventListener("click", () => showTour(TOUR.length));
  viewport.append(card);
}

// ---------- Start ----------

doc.fonts ??= [];
buildSidebar();
fillFontSelect();
loadSystemFonts();
loadStyleKits();
buildWorld();
buildPathList();
updateToolbar();
markSaved();
camera.set(frameState(doc.path[0]));
try {
  if (localStorage.getItem("weitblick-tour") !== "done") showTour(0);
} catch {}

// Per Doppelklick auf eine .weitblick-Datei gestartet? Dann gleich diese öffnen, sonst die Startseite zeigen.
tauri?.core
  .invoke("startup_file")
  .then(async (path) => (path ? openPath(path) : (await offerRecovery()) || showStart()))
  .catch(() => {});
