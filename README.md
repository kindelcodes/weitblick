# Weitblick

Präsentationen auf einer großen, zoombaren Leinwand, offline, für Windows und Linux.

Statt Folie für Folie liegt alles auf einer Leinwand. **Rahmen** markieren Ausschnitte,
ein **Pfad** legt die Reihenfolge fest, und die Kamera fliegt weich von Rahmen zu Rahmen.
Weit entfernte Ziele fliegt sie im Bogen an (erst heraus-, dann hineinzoomen), nahe Ziele direkt.

> Frühes Entwicklungsstadium. Es fehlen u. a. Sprechernotizen und PDF-Export.

## Bedienung

| Aktion | Eingabe |
|---|---|
| Zoomen | Mausrad (zur Mausposition hin) |
| Verschieben | auf leerer Fläche ziehen |
| Weiter / zurück im Pfad | Pfeiltasten, Leertaste, Bild ↑/↓ |
| Überblick | Pos1 |
| Zu einem Rahmen fliegen | Doppelklick in den Rahmen |
| Objekt auswählen / bewegen | anklicken und ziehen (Rahmen an ihrer Kante) |
| Mehrere auswählen | Umschalt+Klick, Umschalt+Ziehen auf leerer Fläche (Auswahlrechteck), Strg+A |
| Kopieren / Ausschneiden / Einfügen / Duplizieren | Strg+C / Strg+X / Strg+V / Strg+D; Rahmen nehmen ihren Inhalt mit |
| Bild aus der Zwischenablage | Strg+V (z. B. nach einem Bildschirmfoto) |
| Drehen | runder Anfasser über dem Objekt, Umschalt rastet in 15°-Schritten ein |
| Größe ändern | Anfasser unten rechts, Umschalt hält das Seitenverhältnis |
| Text bearbeiten | Doppelklick auf den Text, Esc beendet |
| Löschen | Entf |
| Farbe, Schrift, Fett, Kursiv, Ausrichtung | Formatleiste über der Leinwand, sobald etwas ausgewählt ist; Strg+B / Strg+I |
| Pfadschritt umbenennen | Doppelklick auf den Eintrag in der Pfadliste, Enter übernimmt |
| Pfad umsortieren | Eintrag in der Pfadliste nach oben/unten ziehen |
| Objekt als Pfadschritt (auch mehrmals) | Objekt auswählen, „+ Pfad“ |
| Animationsschritt | Objekt(e) auswählen, „✦ Einblenden“ oder „✧ Ausblenden“ in der Formatleiste; der Schritt landet direkt hinter dem aktuellen Pfadschritt, die Kamera bleibt dabei stehen |
| Rückgängig / Wiederholen | Strg+Z / Strg+Y (oder Strg+Umschalt+Z) |
| Bild einfügen | Knopf „Bild“ oder Bilddatei auf die Leinwand ziehen; Bilder behalten beim Vergrößern ihr Seitenverhältnis (Umschalt hebt das auf) |
| Speichern / Speichern unter / Öffnen | Strg+S / Strg+Umschalt+S / Strg+O |
| Präsentieren von vorn / ab aktuellem Schritt | F5 / Umschalt+F5 |
| Beim Präsentieren: Objekt heranzoomen | Klick darauf, „zurück“ kehrt in den Pfad zurück |
| Präsentation beenden | Esc |

## Dateiformat `.weitblick`

Eine ZIP-Datei mit:

- `presentation.json`: Leinwand, Objekte, Rahmen, Pfad und Thema. Hat ein Feld `version` für spätere Formatänderungen.
  Ab Version 2 kann ein Pfadeintrag statt einer Objekt-id auch ein Animationsschritt sein:
  `{ "type": "fade-in" | "fade-out", "targets": ["id", …] }`.
- `media/`: eingefügte Bilder in Originalform (unkomprimiert abgelegt, weil sie schon komprimiert sind)

## Bauen

Voraussetzungen: [Rust](https://rustup.rs) und die [Tauri-Voraussetzungen](https://tauri.app/start/prerequisites/)
(unter Windows die Visual Studio C++ Build Tools, unter Linux `webkit2gtk` und Co.).

```sh
cargo install tauri-cli --version "^2" --locked
cargo tauri dev                 # zum Entwickeln
cargo tauri build               # Installationspakete (.msi, .deb, .AppImage …)
```

Ohne Node.js: Die Oberfläche ist reines HTML/CSS/JavaScript in `src/`, die Dateifunktionen liegen in Rust (`src-tauri/src/lib.rs`).

## Aufbau

- `src/camera.js`: Kamera und Kamerafahrten („smooth zoom and pan“ nach van Wijk & Nuij, 2003)
- `src/main.js`: Darstellung, Bearbeiten, Pfad, Speichern und Öffnen
- `src/demo.js`: Beispielpräsentation
- `docs/verhalten.md`: beobachtetes Verhalten zoombarer Präsentationen, aus dem die Funktionsliste abgeleitet ist

## Lizenz

MIT, siehe [LICENSE](LICENSE).
