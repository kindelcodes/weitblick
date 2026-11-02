# Weitblick

Präsentationen auf einer großen, zoombaren Leinwand, offline, für Windows und Linux.

Statt Folie für Folie liegt alles auf einer Leinwand. **Rahmen** markieren Ausschnitte,
ein **Pfad** legt die Reihenfolge fest, und die Kamera fliegt weich von Rahmen zu Rahmen.
Weit entfernte Ziele fliegt sie im Bogen an (erst heraus-, dann hineinzoomen), nahe Ziele direkt.

> Frühes Entwicklungsstadium. Es fehlen u. a. Rückgängig, Bilder und Farben.

## Bedienung

| Aktion | Eingabe |
|---|---|
| Zoomen | Mausrad (zur Mausposition hin) |
| Verschieben | auf leerer Fläche ziehen |
| Weiter / zurück im Pfad | Pfeiltasten, Leertaste, Bild ↑/↓ |
| Überblick | Pos1 |
| Zu einem Rahmen fliegen | Doppelklick in den Rahmen |
| Objekt auswählen / bewegen | anklicken und ziehen (Rahmen an ihrer Kante) |
| Größe ändern | Anfasser unten rechts, Umschalt hält das Seitenverhältnis |
| Text bearbeiten | Doppelklick auf den Text, Esc beendet |
| Löschen | Entf |
| Speichern / Speichern unter / Öffnen | Strg+S / Strg+Umschalt+S / Strg+O |
| Präsentieren von vorn / ab aktuellem Schritt | F5 / Umschalt+F5 |
| Beim Präsentieren: Objekt heranzoomen | Klick darauf, „zurück“ kehrt in den Pfad zurück |
| Präsentation beenden | Esc |

## Dateiformat `.weitblick`

Eine ZIP-Datei mit:

- `presentation.json`: Leinwand, Objekte, Rahmen, Pfad und Thema. Hat ein Feld `version` für spätere Formatänderungen.
- `media/`: Bilder und Videos in Originalform (geplant)

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
