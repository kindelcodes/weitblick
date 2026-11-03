// Kamera über der Leinwand.
// Zustand: Mittelpunkt (cx, cy) in Leinwand-Koordinaten und sichtbare Breite w.
// Der Zoom ergibt sich daraus: zoom = Bildschirmbreite / w.

const RHO = Math.SQRT2; // Wie stark weite Fahrten herauszoomen (van Wijk & Nuij 2003)
const MIN_MS = 500;
const MAX_MS = 1600;
const MS_PER_UNIT = 700; // Dauer pro Einheit der Pfadlänge S

export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Liefert eine Funktion s -> {cx, cy, w} und die Pfadlänge S.
// Nahe Ziele (eins im anderen) ergeben eine fast gerade Fahrt,
// weit entfernte einen Bogen: erst heraus, dann wieder hinein.
export function flightPath(from, to) {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const u1 = Math.hypot(dx, dy);
  const w0 = from.w;
  const w1 = to.w;

  if (u1 < 1e-6 * Math.max(w0, w1)) {
    const k = w1 > w0 ? 1 : -1;
    const S = Math.abs(Math.log(w1 / w0)) / RHO;
    return {
      S,
      at: (s) => ({
        cx: from.cx + dx * (S ? s / S : 1),
        cy: from.cy + dy * (S ? s / S : 1),
        w: w0 * Math.exp(k * RHO * s),
      }),
    };
  }

  const rho2 = RHO * RHO;
  const rho4 = rho2 * rho2;
  const b = (wi, sign) => (w1 * w1 - w0 * w0 + sign * rho4 * u1 * u1) / (2 * wi * rho2 * u1);
  const r = (bi) => Math.log(-bi + Math.sqrt(bi * bi + 1));
  const r0 = r(b(w0, 1));
  const r1 = r(b(w1, -1));
  const S = (r1 - r0) / RHO;

  return {
    S,
    at: (s) => {
      const u = (w0 / rho2) * (Math.cosh(r0) * Math.tanh(RHO * s + r0) - Math.sinh(r0));
      const f = u / u1;
      return {
        cx: from.cx + dx * f,
        cy: from.cy + dy * f,
        w: (w0 * Math.cosh(r0)) / Math.cosh(RHO * s + r0),
      };
    },
  };
}

export function flightDuration(S) {
  return Math.min(MAX_MS, Math.max(MIN_MS, S * MS_PER_UNIT));
}

export class Camera {
  constructor(onChange) {
    this.cx = 0;
    this.cy = 0;
    this.w = 1000;
    this.onChange = onChange;
    this.anim = null;
  }

  get state() {
    return { cx: this.cx, cy: this.cy, w: this.w };
  }

  set(state) {
    this.cx = state.cx;
    this.cy = state.cy;
    this.w = state.w;
    this.onChange();
  }

  stop() {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = null;
  }

  // Weiche Fahrt zu einem Zielzustand.
  flyTo(target, done) {
    this.stop();
    const path = flightPath(this.state, target);
    const duration = flightDuration(path.S);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      this.set(t < 1 ? path.at(easeInOut(t) * path.S) : target);
      if (t < 1) {
        this.anim = requestAnimationFrame(step);
      } else {
        this.anim = null;
        if (done) done();
      }
    };
    this.anim = requestAnimationFrame(step);
  }
}

// Kamerazustand, der ein Rechteck mit etwas Rand in den Bildschirm einpasst.
export function fitRect(rect, screenW, screenH, margin = 0.08) {
  // Ein noch nicht sichtbares Fenster hat Größe 0; dann mit 16:9 rechnen statt mit NaN.
  const aspect = screenW > 0 && screenH > 0 ? screenW / screenH : 16 / 9;
  const w = Math.max(rect.w, rect.h * aspect) * (1 + 2 * margin);
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, w };
}
