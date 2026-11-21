// Bewegte Hintergründe: je eine Datei unter motion/ mit { id, label, build(layer, theme, strength) }.
// Animiert wird nur transform und opacity per CSS, das läuft auf der Grafikkarte und belastet die Leinwand nicht.
import verlauf from "./motion/verlauf.js";
import lichter from "./motion/lichter.js";
import sterne from "./motion/sterne.js";
import schnee from "./motion/schnee.js";

export const MOTIONS = [verlauf, lichter, sterne, schnee];
