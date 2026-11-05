# Scanner-Update (v2.2)

Neu: automatische Erkennung auch bei weissem Blatt auf hellem Grund, Lupe beim Ziehen,
Ecken greifen relativ (kein Springen), Abstand zum Bildschirmrand, sauberer Weissabgleich.

## 1. Dateien kopieren
`js/scan.js` (ersetzen) und `js/scanui.js` (neu) in den Ordner `js` deines Projekts kopieren.

## 2. `js/views-docs.js` anpassen
a) Ganz oben, unter den anderen `import`-Zeilen, einfügen:

    import { openScanner } from './scanui.js';
    export { openScanner };

b) Die alte Scanner-Funktion löschen: alles von der Zeile

    export function openScanner() {

bis direkt **vor** die Zeile

    // ---------- Ergebnis prüfen und ablegen ----------

(die Kommentarzeile selbst bleibt stehen).

## 3. `css/style.css` – ganz ans Ende einfügen

    .cropstage { padding: 4px 22px 6px; display: flex; justify-content: center; touch-action: none; overscroll-behavior: contain; -webkit-user-select: none; user-select: none; }
    .cropstage canvas { touch-action: none; display: block; }
    .cropstage img { max-width: 100%; max-height: 58vh; border-radius: 10px; display: block; }

## 4. `sw.js`
- `VERSION` erhöhen, z. B. `fv-v2.2.0`
- In der Liste `FILES` nach `'./js/scan.js',` ergänzen: `'./js/scanui.js',`

## 5. Hochladen
    git add .
    git commit -m "Scanner verbessert"
    git push

App auf dem iPhone 2x ganz schliessen und öffnen.
