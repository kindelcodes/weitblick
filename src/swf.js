// Flash-Vektorgrafik (SWF) → SVG, für die Grafiken aus Offline-Prezis. Prezi legt dort nur einfache Bilder ab:
// Formen (DefineShape1–4) und ihre Platzierung (PlaceObject2/3), ohne Animation oder Skript.
// Bitmap-Füllungen, Texte und Farbtransformationen werden ausgelassen.

class Bits {
  constructor(bytes) {
    this.b = bytes;
    this.pos = 0; // in Bytes
    this.bit = 0; // Bitposition im aktuellen Byte
  }
  align() {
    if (this.bit) {
      this.bit = 0;
      this.pos++;
    }
  }
  u8() {
    this.align();
    return this.b[this.pos++];
  }
  u16() {
    this.align();
    const v = this.b[this.pos] | (this.b[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  ub(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((this.b[this.pos] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) {
        this.bit = 0;
        this.pos++;
      }
    }
    return v >>> 0;
  }
  sb(n) {
    const v = this.ub(n);
    return n && v & (1 << (n - 1)) ? v - 2 ** n : v;
  }
  fb(n) {
    return this.sb(n) / 65536;
  }
  rect() {
    this.align();
    const n = this.ub(5);
    const r = { x0: this.sb(n), x1: this.sb(n), y0: this.sb(n), y1: this.sb(n) };
    this.align();
    return r;
  }
  matrix() {
    this.align();
    const m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (this.ub(1)) {
      const n = this.ub(5);
      m.a = this.fb(n);
      m.d = this.fb(n);
    }
    if (this.ub(1)) {
      const n = this.ub(5);
      m.b = this.fb(n);
      m.c = this.fb(n);
    }
    const n = this.ub(5);
    m.e = this.sb(n);
    m.f = this.sb(n);
    this.align();
    return m;
  }
  rgb(alpha) {
    const c = [this.u8(), this.u8(), this.u8()];
    return { c, a: alpha ? this.u8() / 255 : 1 };
  }
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// tint: { color: "#rrggbb", alpha } – Prezis „solidColorBlend“ mischt jede Farbe zu alpha auf color.
function colorCss({ c, a }, tint) {
  let [r, g, b] = c;
  if (tint) {
    const t = [1, 3, 5].map((i) => parseInt(tint.color.slice(i, i + 2), 16));
    [r, g, b] = [r, g, b].map((v, i) => Math.round(v + (t[i] - v) * tint.alpha));
  }
  return { color: `rgb(${r},${g},${b})`, opacity: a };
}

function readFill(r, alpha) {
  const type = r.u8();
  if (type === 0x00) return { type: "solid", rgba: r.rgb(alpha) };
  if (type === 0x10 || type === 0x12 || type === 0x13) {
    const m = r.matrix();
    const head = r.u8();
    const stops = [];
    for (let k = 0; k < (head & 15); k++) stops.push({ at: r.u8() / 255, rgba: r.rgb(alpha) });
    if (type === 0x13) r.u16(); // Brennpunkt
    return { type: type === 0x10 ? "linear" : "radial", m, stops };
  }
  if (type >= 0x40 && type <= 0x43) {
    r.u16();
    r.matrix();
    return { type: "none" };
  }
  throw new Error(`SWF-Füllung ${type} unbekannt`);
}

function readFills(r, alpha) {
  let n = r.u8();
  if (n === 0xff) n = r.u16();
  return Array.from({ length: n }, () => readFill(r, alpha));
}

function readLines(r, alpha, shape4) {
  let n = r.u8();
  if (n === 0xff) n = r.u16();
  const lines = [];
  for (let i = 0; i < n; i++) {
    const width = r.u16();
    if (!shape4) {
      lines.push({ width, rgba: r.rgb(alpha) });
      continue;
    }
    // LINESTYLE2: Kappen, Ecken, ggf. Gehrung und eine eigene Füllung
    r.ub(2);
    const join = r.ub(2);
    const hasFill = r.ub(1);
    r.ub(9);
    r.ub(2);
    if (join === 2) r.u16();
    if (hasFill) {
      const f = readFill(r, alpha);
      lines.push({ width, rgba: f.rgba ?? f.stops?.[0]?.rgba ?? { c: [0, 0, 0], a: 1 } });
    } else lines.push({ width, rgba: r.rgb(alpha) });
  }
  return lines;
}

// Eine Form lesen: Kanten je Füllung (fill0 rückwärts, fill1 vorwärts) und je Linienstil, in Twips.
function readShape(r, code) {
  const id = r.u16();
  const bounds = r.rect();
  if (code === 83) {
    r.rect();
    r.u8();
  }
  const alpha = code >= 32;
  const shape4 = code === 83;
  const layers = [];
  let fills = readFills(r, alpha);
  let lines = readLines(r, alpha, shape4);
  let layer = { fills, lines, fillEdges: new Map(), lineEdges: new Map() };
  layers.push(layer);
  r.align();
  let fillBits = r.ub(4);
  let lineBits = r.ub(4);
  let x = 0;
  let y = 0;
  let f0 = 0;
  let f1 = 0;
  let ln = 0;
  const push = (map, key, e) => map.set(key, [...(map.get(key) ?? []), e]);
  const edge = (e) => {
    if (f1) push(layer.fillEdges, f1, e);
    if (f0) push(layer.fillEdges, f0, { x0: e.x1, y0: e.y1, cx: e.cx, cy: e.cy, x1: e.x0, y1: e.y0 });
    if (ln) push(layer.lineEdges, ln, e);
  };
  for (;;) {
    if (r.ub(1)) {
      const straight = r.ub(1);
      const n = r.ub(4) + 2;
      if (straight) {
        let dx = 0;
        let dy = 0;
        if (r.ub(1)) {
          dx = r.sb(n);
          dy = r.sb(n);
        } else if (r.ub(1)) dy = r.sb(n);
        else dx = r.sb(n);
        edge({ x0: x, y0: y, x1: x + dx, y1: y + dy });
        x += dx;
        y += dy;
      } else {
        const cx = x + r.sb(n);
        const cy = y + r.sb(n);
        const ax = cx + r.sb(n);
        const ay = cy + r.sb(n);
        edge({ x0: x, y0: y, cx, cy, x1: ax, y1: ay });
        x = ax;
        y = ay;
      }
      continue;
    }
    const flags = r.ub(5);
    if (!flags) break;
    if (flags & 1) {
      const n = r.ub(5);
      x = r.sb(n);
      y = r.sb(n);
    }
    if (flags & 2) f0 = r.ub(fillBits);
    if (flags & 4) f1 = r.ub(fillBits);
    if (flags & 8) ln = r.ub(lineBits);
    if (flags & 16) {
      fills = readFills(r, alpha);
      lines = readLines(r, alpha, shape4);
      layer = { fills, lines, fillEdges: new Map(), lineEdges: new Map() };
      layers.push(layer);
      r.align();
      fillBits = r.ub(4);
      lineBits = r.ub(4);
    }
  }
  return { id, bounds, layers };
}

// Kanten einer Füllung zu geschlossenen Pfaden verketten (Endpunkt = Anfangspunkt der nächsten Kante).
function chain(edges) {
  const left = new Set(edges);
  const byStart = new Map();
  for (const e of edges) byStart.set(`${e.x0},${e.y0}`, [...(byStart.get(`${e.x0},${e.y0}`) ?? []), e]);
  let d = "";
  for (const first of edges) {
    if (!left.has(first)) continue;
    let e = first;
    d += `M${e.x0} ${e.y0}`;
    while (e) {
      left.delete(e);
      d += e.cx !== undefined ? `Q${e.cx} ${e.cy} ${e.x1} ${e.y1}` : `L${e.x1} ${e.y1}`;
      e = (byStart.get(`${e.x1},${e.y1}`) ?? []).find((n) => left.has(n));
    }
    d += "Z";
  }
  return d;
}

let gradientId = 0;
function shapeSvg(shape, tint) {
  let defs = "";
  let body = "";
  for (const layer of shape.layers) {
    for (const [i, edges] of [...layer.fillEdges].sort((a, b) => a[0] - b[0])) {
      const f = layer.fills[i - 1];
      if (!f || f.type === "none") continue;
      let paint;
      if (f.type === "solid") {
        const c = colorCss(f.rgba, tint);
        paint = `fill="${c.color}"${c.opacity < 1 ? ` fill-opacity="${c.opacity.toFixed(3)}"` : ""}`;
      } else {
        const gid = `g${++gradientId}`;
        const stops = f.stops.map((s) => {
          const c = colorCss(s.rgba, tint);
          return `<stop offset="${s.at.toFixed(3)}" stop-color="${c.color}" stop-opacity="${c.opacity.toFixed(3)}"/>`;
        }).join("");
        const m = f.m;
        const geo = f.type === "linear" ? 'x1="-16384" y1="0" x2="16384" y2="0"' : 'cx="0" cy="0" r="16384"';
        defs += `<${f.type}Gradient id="${gid}" gradientUnits="userSpaceOnUse" ${geo} gradientTransform="matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})">${stops}</${f.type}Gradient>`;
        paint = `fill="url(#${gid})"`;
      }
      body += `<path d="${chain(edges)}" ${paint} fill-rule="evenodd"/>`;
    }
    for (const [i, edges] of layer.lineEdges) {
      const l = layer.lines[i - 1];
      if (!l) continue;
      const c = colorCss(l.rgba, tint);
      const d = edges.map((e) => `M${e.x0} ${e.y0}${e.cx !== undefined ? `Q${e.cx} ${e.cy} ${e.x1} ${e.y1}` : `L${e.x1} ${e.y1}`}`).join("");
      body += `<path d="${d}" fill="none" stroke="${c.color}" stroke-opacity="${c.opacity.toFixed(3)}" stroke-width="${Math.max(l.width, 20)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  return { defs, body };
}

// base64-SWF → SVG-Text (Koordinaten in Twips) oder null. view: sichtbarer Ausschnitt in Pixeln {x, y, w, h};
// ohne Angabe die Bildgröße der SWF-Datei.
export async function swfToSvg(base64, { tint = null, view = null } = {}) {
  let bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (sig === "CWS") bytes = new Uint8Array([...bytes.subarray(0, 8), ...(await inflate(bytes.subarray(8)))]);
  else if (sig !== "FWS") return null;
  const r = new Bits(bytes);
  r.pos = 8;
  const frame = r.rect();
  r.u16();
  r.u16();
  const shapes = new Map();
  const placed = new Map(); // Tiefe → { id, m }
  while (r.pos < bytes.length) {
    const head = r.u16();
    const code = head >> 6;
    let len = head & 63;
    if (len === 63) {
      len = r.u16() | (r.u16() << 16);
    }
    const end = r.pos + len;
    if (code === 0) break;
    if ([2, 22, 32, 83].includes(code)) {
      const s = readShape(r, code);
      shapes.set(s.id, s);
    } else if (code === 26 || code === 70) {
      const flags = r.u8();
      if (code === 70) r.u8();
      const depth = r.u16();
      const prev = placed.get(depth);
      const id = flags & 2 ? r.u16() : prev?.id;
      const m = flags & 4 ? r.matrix() : (prev?.m ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      placed.set(depth, { id, m });
    } else if (code === 1) break; // nur das erste Bild
    r.pos = end;
    r.bit = 0;
  }
  let defs = "";
  let body = "";
  for (const [, p] of [...placed].sort((a, b) => a[0] - b[0])) {
    const s = shapes.get(p.id);
    if (!s) continue;
    const out = shapeSvg(s, tint);
    defs += out.defs;
    const m = p.m;
    body += `<g transform="matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})">${out.body}</g>`;
  }
  if (!body) return null;
  const v = view ? [view.x * 20, view.y * 20, view.w * 20, view.h * 20] : [frame.x0, frame.y0, frame.x1 - frame.x0, frame.y1 - frame.y0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${v.join(" ")}" preserveAspectRatio="none"><defs>${defs}</defs>${body}</svg>`;
}
