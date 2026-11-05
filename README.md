# Finance Vault

Persönliches Finanz-Cockpit als iPhone-Web-App (PWA): Crypto mit Ø-Kaufpreis und Gewinn/Verlust, Konten, Ziele mit Meilensteinen, Crypto-Steuerbericht per 31.12. für Basel-Landschaft und Rechnungen.

- **Verschlüsselt:** Alle Daten liegen AES-256-verschlüsselt auf dem Gerät (PIN → PBKDF2 → AES-GCM)
- **Lokal:** Kein Server, kein Konto, keine Finanzdaten im Internet
- **Nichts zu installieren:** HTML/CSS/JavaScript, kein pip, kein npm, kein Build

> ⚠️ **PIN vergessen = Daten weg.** Es gibt bewusst keine Hintertür. PIN sicher notieren und regelmässig ein Backup machen.

---

## 1. Struktur

```
finance-vault/
├── index.html             Grundgerüst, Tab-Leiste
├── manifest.webmanifest   App-Name, Icon (Home-Bildschirm)
├── sw.js                  Offline-Funktion (VERSION bei jeder Änderung erhöhen!)
├── css/style.css          Design (Navy & Gold)
├── icons/                 App-Icons
└── js/
    ├── app.js             Start, Sperrbildschirm, Navigation, Kurse, Meilensteine
    ├── vault.js           Verschlüsselter Speicher (IndexedDB + Web Crypto), Backup
    ├── store.js           App-Zustand, Demo-Daten, Standard-Ziele
    ├── calc.js            Berechnungslogik: Bestand, Ø-Preis, Gewinne, Nettovermögen, Stichtag
    ├── prices.js          CoinGecko: Live- und historische Kurse in CHF
    ├── importer.js        CSV-Import, Spalten-Zuordnung, Duplikaterkennung
    ├── ui.js              Formatierung, Sheets, Konfetti
    ├── views-main.js      Übersicht, Invest, Coin-Detail, Konten, Ziele
    └── views-more.js      Steuern, Rechnungen, Vault (Import, Prüfen, Einstellungen)
```

## 2. In VS Code testen

1. Ordner in VS Code öffnen → Rechtsklick auf `index.html` → **Open with Live Server**
   (oder im Terminal: `python -m http.server 8000` → <http://localhost:8000>)
2. PIN festlegen (Test-PIN, z. B. 123456)
3. **Vault › Einstellungen › Demo-Daten laden**
4. iPhone-Ansicht: `F12` → `Strg+Shift+M`

## 3. Auf GitHub und aufs iPhone

Neues Repository auf github.com erstellen (z. B. `finance-vault`, **Public**, ohne README), dann im Projektordner:

```powershell
git init
git add .
git commit -m "Finance Vault v1.0"
git branch -M main
git remote add origin https://github.com/Geisterzwerk/finance-vault.git
git push -u origin main
```

GitHub → **Settings › Pages** → Branch `main`, `/ (root)` → Save.
Adresse: `https://geisterzwerk.github.io/finance-vault/` → in **Safari** öffnen → Teilen → **Zum Home-Bildschirm** → «Als Web-App öffnen» an.

> Im Repo liegt nur Code. Deine Daten bleiben auf dem iPhone. Backups und CSV-Exporte sind per `.gitignore` ausgeschlossen. **Echte Exporte nie ins Repo legen.**

Updates: Code ändern → in `sw.js` `VERSION` erhöhen → `git push` → App 1–2× schliessen und öffnen.

## 4. Import

**Vault › Relai / BingX › Importieren** → CSV wählen → Spalten prüfen → **Prüfen** → **Importieren**

- Spalten werden automatisch erkannt (Deutsch/Englisch), alles ist anpassbar. Die Zuordnung wird pro Plattform gespeichert.
- Doppelte Transaktionen werden über Transaktions-ID bzw. Zeilen-Fingerabdruck erkannt und ignoriert.
- Käufe in USDT werden mit dem historischen USDT/CHF-Kurs (CoinGecko) in CHF umgerechnet.
- Unklare Zeilen (z. B. «Convert») landen unter **Bitte zuordnen**.
- Nur CSV. XLSX zuerst als CSV speichern.
- Die Vorlagen für Relai und BingX werden angepasst, sobald echte Beispiel-Exporte vorliegen.

## 5. Berechnung

Durchschnittskosten-Methode: Kauf erhöht Bestand und Kostenbasis (inkl. Gebühren), Verkauf bucht zum Ø-Preis aus und realisiert Gewinn/Verlust, Transfer ändert nichts, Reward hat Kostenbasis 0. Fehlt die Kaufhistorie, wird **kein** Ø-Preis erfunden.

## 6. Steuern

Crypto-Bestand per 31.12., 23:59 Uhr aus allen Transaktionen. Steuerkurse aus der ESTV-Kursliste (ICTax) eintragen oder Ersatzkurse laden (markiert). «Jahr abschliessen» friert den Snapshot ein. Bericht als PDF (Drucken › PDF) oder CSV. Checkliste mit E-Tax-BL-Ziffern aus der Steuererklärung 2023, jährlich prüfen.

Finance Vault ist eine Organisationshilfe, keine Steuerberatung.

## 7. Stand und nächste Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| 1 Fundament | PIN, Verschlüsselung, Konten, CSV-Import, Duplikate, Ø-Preis, Live-Kurse, Dashboard, Ziele mit Konfetti | ✅ |
| Extra | Rechnungen mit Status/Suche/Beleg, Crypto-Steuerbericht 31.12., Checkliste | ✅ Grundversion |
| 2 Dokumente | Scanner mit Zuschnitt, OCR, Finance Inbox, Push-Dienst für Erinnerungen | offen |
| 3 Steuern | Jahresabschluss mit Push, Steuerpaket, Steuerzahlungen, Archiv | offen |
| 4 Automatik | Ledger-Adressen-Sync, Prüfung der Steuererklärung, BingX-API | offen |
