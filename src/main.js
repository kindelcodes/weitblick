import { Camera, fitRect } from "./camera.js";
import { demo } from "./demo.js";

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
let selected = null;
let nextId = 1;

const camera = new Camera(render);

// ---------- Darstellung ----------

function makeEl(o) {
  const el = document.createElement("div");
  el.className = `obj ${o.type}`;
  el.dataset.id = o.id;
  if (o.type === "frame" && o.hidden) el.classList.add("hidden-frame");
  if (o.type === "shape") el.classList.add(o.shape);
  if (o.type === "text") el.addEventListener("blur", () => finishEditing(el));
  updateEl(o, el);
  return el;
}

function updateEl(o, el = elOf(o)) {
  Object.assign(el.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` });
  if (o.type === "shape") el.style.background = o.fill;
  if (o.type === "text") {
    if (!el.isContentEditable) el.textContent = o.text;
    Object.assign(el.style, {
      fontSize: `${o.size}px`,
      color: o.color || doc.theme.text,
      textAlign: o.align || "left",
      fontWeight: o.weight || 400,
    });
  }
  el.classList.toggle("selected", o === selected);
  el.querySelector(".handle")?.remove();
  if (o === selected) {
    const h = document.createElement("div");
    h.className = "handle";
    el.append(h);
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
    li.querySelector(".label").textContent = byId.get(id)?.title ?? id;
    li.addEventListener("click", () => goTo(i));
    const remove = li.querySelector(".remove");
    if (i === 0) remove.remove();
    else
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        doc.path.splice(i, 1);
        if (pathIndex >= doc.path.length) pathIndex = doc.path.length - 1;
        buildPathList();
      });
    pathList.append(li);
  });
  markActive();
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
  camera.flyTo(frameState(doc.path[pathIndex]));
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

function select(o) {
  const prev = selected;
  selected = o;
  if (prev && byId.has(prev.id)) updateEl(prev);
  if (o) updateEl(o);
  updateToolbar();
}

function updateToolbar() {
  const isText = selected?.type === "text";
  document.querySelectorAll("[data-needs]").forEach((b) => {
    const need = b.dataset.needs;
    b.disabled = !selected || (need === "text" && !isText);
  });
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
  o.text = el.innerText;
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
  const vw = camera.w;
  const base = { x: 0, y: 0 };
  let o;
  if (kind === "text") {
    o = { ...base, id: newId("t"), type: "text", w: vw * 0.4, h: vw * 0.08, text: "Neuer Text", size: vw * 0.035 };
  } else if (kind === "frame") {
    o = { ...base, id: newId("f"), type: "frame", w: vw * 0.6, h: vw * 0.6 * (9 / 16), title: "Neuer Rahmen" };
  } else {
    o = { ...base, id: newId("s"), type: "shape", shape: kind, w: vw * 0.2, h: vw * 0.2, fill: doc.theme.accent };
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
  if (!selected || selected.id === doc.path[0]) return;
  const id = selected.id;
  doc.objects = doc.objects.filter((o) => o.id !== id);
  doc.path = doc.path.filter((p) => p !== id);
  selected = null;
  buildWorld();
  buildPathList();
  updateToolbar();
}

function changeTextSize(factor) {
  if (selected?.type !== "text") return;
  selected.size *= factor;
  updateEl(selected);
}

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
    gesture = { kind: "resize", start, o: selected, w: selected.w, h: selected.h, size: selected.size };
  } else {
    const o = e.button === 0 ? hitObject(e) : null;
    if (o) {
      select(o);
      // Ein Rahmen nimmt alles mit, was ganz in ihm liegt.
      const group = o.type === "frame" ? doc.objects.filter((p) => p !== o && !p.hidden && inside(p, o)) : [];
      gesture = { kind: "move", start, items: [o, ...group].map((p) => ({ p, x: p.x, y: p.y })) };
    } else {
      select(null);
      gesture = { kind: "pan", x: e.clientX, y: e.clientY, cx: camera.cx, cy: camera.cy };
      viewport.classList.add("dragging");
    }
  }
  viewport.setPointerCapture(e.pointerId);
});

viewport.addEventListener("pointermove", (e) => {
  if (!gesture) return;
  if (gesture.kind === "pan") {
    const z = zoom();
    camera.set({ w: camera.w, cx: gesture.cx - (e.clientX - gesture.x) / z, cy: gesture.cy - (e.clientY - gesture.y) / z });
    return;
  }
  const p = eventToWorld(e);
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
    o.w = Math.max(minSize, gesture.w + dx);
    // Kreise und Quadrate behalten mit gedrückter Umschalttaste ihr Seitenverhältnis.
    o.h = e.shiftKey ? o.w * (gesture.h / gesture.w) : Math.max(minSize, gesture.h + dy);
    updateEl(o);
  }
});

const endGesture = (e) => {
  const g = gesture;
  gesture = null;
  viewport.classList.remove("dragging");
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
  if (presenting) return;
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

const FORMAT_VERSION = 1;
const FILTERS = [{ name: "Weitblick-Präsentation", extensions: ["weitblick"] }];
const tauri = window.__TAURI__;

function showFileName() {
  const name = currentPath ? currentPath.split(/[\\/]/).pop() : "nicht gespeichert";
  document.getElementById("doc-title").textContent = `${doc.title} · ${name}`;
}

async function saveAs() {
  const path = await tauri.dialog.save({ filters: FILTERS, defaultPath: `${doc.title}.weitblick` });
  if (!path) return;
  currentPath = path.endsWith(".weitblick") ? path : `${path}.weitblick`;
  await save();
}

async function save() {
  if (!currentPath) return saveAs();
  if (isEditing()) document.activeElement.blur();
  try {
    await tauri.core.invoke("save_presentation", { path: currentPath, json: JSON.stringify(doc, null, 2) });
    showFileName();
  } catch (err) {
    await tauri.dialog.message(String(err), { title: "Speichern fehlgeschlagen", kind: "error" });
  }
}

async function openFile() {
  const path = await tauri.dialog.open({ filters: FILTERS, multiple: false });
  if (!path) return;
  try {
    const loaded = JSON.parse(await tauri.core.invoke("open_presentation", { path }));
    if (loaded.format !== "weitblick") throw new Error("Das ist keine Weitblick-Präsentation.");
    if (loaded.version > FORMAT_VERSION) throw new Error("Die Datei stammt aus einer neueren Weitblick-Version.");
    doc = loaded;
    currentPath = path;
    selected = null;
    pathIndex = 0;
    buildWorld();
    buildPathList();
    updateToolbar();
    showFileName();
    camera.set(frameState(doc.path[0]));
  } catch (err) {
    await tauri.dialog.message(String(err.message ?? err), { title: "Öffnen fehlgeschlagen", kind: "error" });
  }
}

// ---------- Präsentieren ----------

const appWindow = tauri?.window?.getCurrentWindow();
const progressBar = document.getElementById("progress-bar");
const stepLabel = document.getElementById("step-label");
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
  stepLabel.textContent = `${pathIndex + 1} / ${doc.path.length}`;
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
  if (e.ctrlKey && (e.key === "o" || e.key === "O")) {
    e.preventDefault();
    openFile();
    return;
  }
  if (isEditing()) {
    if (e.key === "Escape") document.activeElement.blur();
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
on("btn-add-rect", () => addObject("rect"));
on("btn-add-ellipse", () => addObject("ellipse"));
on("btn-text-smaller", () => changeTextSize(1 / 1.15));
on("btn-text-bigger", () => changeTextSize(1.15));
on("btn-delete", deleteSelected);
on("btn-open", openFile);
on("btn-save", save);

new ResizeObserver(() => {
  // Beim Präsentieren bleibt der aktuelle Rahmen eingepasst, auch wenn sich die Fenstergröße ändert.
  if (presenting && !offPath && !camera.anim) camera.set(frameState(doc.path[pathIndex]));
  else render();
}).observe(viewport);

// ---------- Start ----------

buildWorld();
buildPathList();
updateToolbar();
showFileName();
camera.set(frameState(doc.path[0]));
