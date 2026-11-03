# Weitblick

Präsentationen auf einer großen, zoombaren Leinwand, offline, für Windows und Linux.

Statt Folie für Folie liegt alles auf einer Leinwand. **Rahmen** markieren Ausschnitte,
ein **Pfad** legt die Reihenfolge fest, und die Kamera fliegt weich von Rahmen zu Rahmen.
Weit entfernte Ziele fliegt sie im Bogen an (erst heraus-, dann hineinzoomen), nahe Ziele direkt.

> Frühes Entwicklungsstadium. Es fehlen u. a. Sprechernotizen und PDF-Export.

## Installieren

Fertige Pakete gibt es unter [Releases](https://github.com/kindelcodes/weitblick/releases):

- **Windows:** `Weitblick_…_x64-setup.exe` (ohne Administratorrechte) oder `Weitblick_…_x64_de-DE.msi`
- **Linux:** `Weitblick_…_amd64.AppImage` (ausführbar machen und starten), `.deb` für Debian/Ubuntu, `.rpm` für Fedora/openSUSE

Nach der Installation öffnen sich `.weitblick`-Dateien per Doppelklick in Weitblick.
Die Pakete baut GitHub Actions ([.github/workflows/build.yml](.github/workflows/build.yml)) bei jedem Push;
ein Tag `v…` legt zusätzlich einen Release-Entwurf an.

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
| Breite der Seitenleisten | an der Kante ziehen (orange Linie), Doppelklick setzt zurück; wird gemerkt |
| Hilfslinien | beim Verschieben rasten Kanten und Mitten an anderen Objekten ein (orange Linie); Alt beim Ziehen: frei |
| Raster | Knopf # unten oder Strg+#: Objekte rasten am Raster ein, das Raster wird als Linien angezeigt |
| Rechtsklick | auf ein Objekt: Kopieren, Anordnen, Rahmen, Pfad, Animation, Löschen; auf die freie Leinwand: Einfügen, Text/Rahmen/Form hier, Alles auswählen, Stil |
| Gruppieren / auflösen | Strg+G / Strg+Umschalt+G oder Rechtsklick; ein Klick wählt dann die ganze Gruppe, der orange Anfasser am gestrichelten Kasten skaliert sie gemeinsam |
| Planet mit Monden | Einfügen → Diagramme: Kugel, Umlaufbahn und vier Monde als *ein* gruppierter Block |
| Ebenen | Formatleiste ⤒ ↑ ↓ ⤓ oder Strg+↑/↓ (eine Ebene), Strg+Umschalt+↑/↓ (ganz nach vorn/hinten) |
| Zum Rahmen hinzufügen / lösen | Rahmen und Objekte gemeinsam auswählen → „▣+ Rahmen“ (der Rahmen wächst mit); Objekt auswählen → „▣− Rahmen“. Beim gewählten Rahmen ist sein Inhalt gestrichelt markiert |
| Ecken abrunden | Regler ◜ in der Formatleiste (Rechtecke, Vielecke, Pfeile, Rahmen, Bilder) |
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
| Neue Präsentation | „Neu“ oder Strg+N |
| Stil, Formen, Symbole, Diagramme, Schriften | „◫ Einfügen“ öffnet die Seitenleiste rechts: 8 Stile und eigene Stilkits, Hintergrund (Farbe, Bild, Parallaxe, Seitenverhältnis), 38 Formen in 6 Gruppen (inkl. Weltkarte), über 2.000 Symbole, 15 Inhaltsblöcke, Google-Schriften |
| Eigenes Stilkit | Stil-Reiter: Farben, Schriften und fett/kursiv je Rolle einstellen, Namen eingeben, „Speichern“; steht danach in jeder Präsentation bereit |
| Bild als Hintergrund | Bild auswählen, „▤ Als Hintergrund“ in der Formatleiste |
| Vorschau eines Pfadschritts | Maus über den Eintrag in der Pfadliste halten |
| Schriftart | Formatleiste: Standard-, eingebettete und alle Systemschriften |
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
  und unter `media/fonts/` eingebettete Google-Schriften (woff2, lateinische Zeichen). Welche Schrift
  welche Datei nutzt, steht in `presentation.json` unter `fonts`.

Symbole stammen aus [Lucide](https://lucide.dev) (ISC-Lizenz, `src/vendor/`) und sind in der App enthalten.
Die Weltkarte beruht auf [Natural Earth](https://www.naturalearthdata.com) (gemeinfrei) über das Paket
`world-atlas`; die Wortmarke nutzt Comfortaa (SIL Open Font License, `src/assets/`).

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
