# Verhalten zoombarer Präsentationen: Beobachtungen und Funktionsliste

Grundlage für Weitblick. Beobachtet wurde nur das sichtbare Verhalten einer bestehenden Leinwand-Präsentationssoftware
beim Bearbeiten und Präsentieren. Übernommen wird kein Code, kein Design und keine Grafik, nur das Bedienprinzip.

## Grundmodell

- **Leinwand:** unbegrenzte Fläche, Inhalte liegen frei darauf.
- **Überblick:** erster Pfadschritt, zeigt die ganze Leinwand.
- **Rahmen:** Ausschnitte, die beim Präsentieren den Bildausschnitt bestimmen. Sie lassen sich verschachteln.
- **Pfad:** nummerierte Schritte, als Liste in einer Seitenleiste und als Markierungen auf der Leinwand.
- **Schrittarten:** Kamerafahrt zu einem Rahmen, oder Animationsschritt (die Kamera steht, ein Objekt wird ein- oder ausgeblendet).

## Präsentieren

- Weiter und zurück mit Pfeiltasten oder Knöpfen, dazu ein Fortschrittsbalken.
- Verschachtelte Rahmen werden in beide Richtungen genutzt: hinein zum Detail, wieder heraus zum Ganzen.
- Ein Klick auf ein Objekt zoomt dorthin, auch außerhalb des Pfads. „Zurück“ springt wieder in den Pfad.

## Kamerafahrten (gemessen mit 10 Bildern/s)

| Fahrt | Dauer | Verlauf |
|---|---|---|
| Überblick → Rahmen darin | ca. 1,3 s | direkt, Zoom und Verschiebung gleichzeitig |
| zu einem weit entfernten Nachbarrahmen | ca. 1,6 s | im Bogen: heraus bis beide sichtbar sind, dann hinein |
| in einen Unterrahmen | ca. 0,7 s | direkt hinein |
| zwischen gleich großen Geschwistern | ca. 0,5 s | nur Verschieben, kein Zoom |

- Kein Drehen beobachtet.
- Die Dauer wächst mit Entfernung und Zoomunterschied, immer mit der Kurve langsam – schnell – langsam (ease-in-out).

**Umsetzung in Weitblick:** `src/camera.js` nutzt den optimalen Zoom-und-Verschiebe-Pfad nach van Wijk & Nuij (2003).
Er ergibt von selbst nahe Ziele direkt und ferne im Bogen. Die Dauer liegt zwischen 0,5 und 1,6 s, je nach Pfadlänge, mit ease-in-out.

## Editor

- Werkzeugleiste: Stil, Text, Medien, Formen, fertige Inhaltsblöcke, Animation.
- Seitenleiste links mit dem Pfad, Vorschaubildern und Übergangsart je Schritt.
- Schwebende Leisten für Textformat (Schrift, Größe, fett/kursiv, Farben, Ausrichtung, Liste) und Rahmen (Übergang, Hintergrund, Rand).
- Untere Leiste: Verschieben/Auswählen, vor/zurück, Überblick, Zoom −/+ mit Prozentanzeige. Dazu Sprechernotizen.
- Ein Klick auf einen Pfadschritt startet auch im Editor die Kamerafahrt.

## Ergänzung: Seitenleisten und Menüs (zweite Beobachtung)

- **Stil/Text:** Benannte Textstile mit je einer Schrift plus fett/kursiv für Titel, Untertitel und Textkörper,
  dazu ein Hinweis auf ein eigenes Farbschema. Gespeichert wird der Stil unter einem Namen.
- **Hintergrund:** Hintergrundfarbe, Hintergrundbild (eigenes oder aus einer Bilddatenbank), Bildanpassung
  (Füllen), **Hintergrund-Parallaxe** (das Hintergrundbild bewegt sich langsamer als die Leinwand) und das
  Seitenverhältnis der Präsentation (16:9).
- **Formen** sind in Gruppen sortiert: Einfach (u. a. Halbkreis, rechtwinkliges Dreieck, Parallelogramm),
  Diagramme (Flussdiagramm-Formen wie Zylinder, Dokument, Ordner, Puzzleteil), Pfeile (links, rechts, doppelt,
  Fahne), Akzente (Stern, Funkeln, Zacken, Tropfen, Sprechblasen, Wolke, Herz, Plus, Zahnrad) und
  Linien zeichnen (Linie, Pfeillinie).
- **Inhaltsblöcke** als Katalog mit Suche: Tabelle, Zeitstrahl, Ziel, Gewinne & Verluste, Liste,
  Datenvisualisierung (z. B. Venn), Karte, Prozess, Plan (Baum), Team, Information. Die Karten-Kategorie hat
  eigene Varianten (Welt- und Regionskarten mit Markierungen).
- Ein ausgewählter Block zeigt eine kleine Leiste mit wenigen Aktionen (Inhalt anordnen, Animation, Ersetzen).
- Die Pfadliste zeigt **Vorschaubilder** der Schritte statt nur Namen.

### Abgleich mit Weitblick (Stand dieser Beobachtung)

| Bereich | Weitblick hat | Fehlt noch |
|---|---|---|
| Stil | 8 Paletten, Schrift je Rolle, eigene Farben | fett/kursiv je Rolle, eigene Stile speichern |
| Hintergrund | Farbe über den Stil | Hintergrundbild, Parallaxe, Seitenverhältnis |
| Formen | 13 Formen in einer Gruppe | Gruppen, Flussdiagramm-Formen, Sprechblase, Wolke, Herz, Linien mit Pfeilspitzen |
| Inhaltsblöcke | Prozess, Kreislauf, Zeitstrahl, Pyramide, Mindmap, Vergleich, Kacheln, Aufzählung | Tabelle, Ziel, Venn/Diagramme, Karte, Baum/Organigramm, Team |
| Pfadliste | Namen, Animationsschritte | Vorschaubilder |

## Funktionsliste

**Muss:** Leinwand mit Zoom und Verschieben · Text, Bild, Formen · verschachtelte Rahmen · Pfad mit Seitenleiste ·
Präsentieren mit Kamerafahrten und freiem Erkunden · Speichern als eine Datei · Rückgängig.

**Soll:** Animationsschritte · Sprechernotizen und Referentenansicht · Themen · PDF-Export.

**Kann:** Vorlagen und Inhaltsblöcke · weitere Übergänge (Drehen, Überblenden) · Video und Audio · Installationspakete.
