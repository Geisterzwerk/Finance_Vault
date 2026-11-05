# Finance Vault

Persönliches Finanz-Cockpit als iPhone-Web-App (PWA): Crypto mit Ø-Kaufpreis und Gewinn/Verlust, Konten, Ziele mit Meilensteinen, Crypto-Steuerbericht per 31.12. für Basel-Landschaft und Rechnungen.

- **Verschlüsselt:** Alle Daten liegen AES-256-verschlüsselt auf dem Gerät (PIN → PBKDF2 → AES-GCM)
- **Lokal:** Kein Server, kein Konto, keine Finanzdaten im Internet
- **Nichts zu installieren:** HTML/CSS/JavaScript, kein pip, kein npm, kein Build

> ⚠️ **PIN vergessen = Daten weg.** Es gibt bewusst keine Hintertür. PIN sicher notieren und regelmässig ein Backup machen.

## Struktur

```
finance-vault/
├── index.html, manifest.webmanifest, sw.js (VERSION bei jeder Änderung erhöhen!)
├── css/style.css          Design (Navy & Gold)
├── icons/
└── js/
    ├── app.js             Start, Sperrbildschirm, Navigation, Kurse, Meilensteine
    ├── vault.js           Verschlüsselter Speicher (IndexedDB + Web Crypto), Backup
    ├── store.js           App-Zustand, Demo-Daten, Standard-Ziele
    ├── calc.js            Bestand, Ø-Preis, Gewinne, Nettovermögen, Stichtag
    ├── prices.js          CoinGecko: Live- und historische Kurse in CHF
    ├── bingx.js           BingX-Kontoauszüge (Spot/Fund) mit Saldo-Abgleich
    ├── importer.js        Allgemeiner CSV-Import (Relai, andere)
    ├── ui.js              Formatierung, Sheets, Konfetti
    ├── views-main.js      Übersicht, Invest, Coin-Detail, Konten, Ziele
    └── views-more.js      Steuern, Rechnungen, Vault (Import, Prüfen, Einstellungen)
```

## Testen in VS Code

Rechtsklick auf `index.html` → **Open with Live Server** (oder `python -m http.server 8000`). Test-PIN festlegen, dann **Vault › Einstellungen › Demo-Daten laden**.

## GitHub und iPhone

```powershell
git init
git add .
git commit -m "Finance Vault v1.1"
git branch -M main
git remote add origin https://github.com/Geisterzwerk/finance-vault.git
git push -u origin main
```

GitHub → Settings › Pages → Branch `main`, `/ (root)`. Dann `https://geisterzwerk.github.io/finance-vault/` in Safari öffnen → Teilen → Zum Home-Bildschirm.

> Im Repo liegt nur Code. **Echte Exporte (CSV) nie ins Repo legen** – `.gitignore` schliesst CSV, XLSX und Backups aus.

## BingX-Import

**Vault › BingX › Importieren** → alle Dateien des Konto-Auszugs auf einmal wählen (`Spot_Account.csv`, `Fund_Account.csv`, leere Futures/Wealth-Dateien dürfen mit).

- Spot-Trades werden aus den Zeilenpaaren mit gleicher Zeit erkannt (+ erhalten / − bezahlt), Sparplan-Käufe separat gezählt.
- CHF-Wert: Stablecoin-Seite × historischer USD/CHF-Kurs (CoinGecko).
- Auszahlungen → Transfer an die Standard-Wallet (Ledger). Bestand und Ø-Preis bleiben gleich.
- Rebates → Reward mit Kostenbasis 0. Interne Umbuchungen Spot ↔ Fund werden ignoriert.
- **Saldo-Abgleich:** Jede Zeile enthält den neuen Saldo. Fehlt Historie, wird sie sichtbar:
  - fehlende Gutschrift → Anfangsbestand ohne Kaufpreis (Ø-Preis bleibt offen, nichts erfunden)
  - fehlende Abbuchung bei Stablecoins → Ausgleich, bei anderen Coins → «Bitte zuordnen»
- Mehrfach importieren ist sicher: Rohzeilen werden zusammengeführt, alles wird neu berechnet, deine Zuordnungen bleiben erhalten.

## Berechnung

Durchschnittskosten-Methode. Kauf erhöht Bestand und Kostenbasis (inkl. Gebühren), Verkauf bucht zum Ø-Preis aus. Ist ein Teil der Kostenbasis unbekannt, wird kein Ø-Preis und kein realisierter Gewinn berechnet; angezeigt wird «≈ Ø des bekannten Teils».

## Steuern

Bestand per 31.12., 23:59 Uhr. Steuerkurse aus der ESTV-Kursliste (ICTax) eintragen oder Ersatzkurse laden. «Jahr abschliessen» friert den Snapshot ein. Bericht als PDF oder CSV. Organisationshilfe, keine Steuerberatung.

## Stand

| Phase | Inhalt | Stand |
|---|---|---|
| 1 Fundament | PIN, Verschlüsselung, Konten, Import, Duplikate, Ø-Preis, Live-Kurse, Dashboard, Ziele | ✅ |
| Extra | BingX-Kontoauszug mit Saldo-Abgleich, Rechnungen, Crypto-Steuerbericht | ✅ |
| 2 Dokumente | Scanner, OCR, Finance Inbox, Push-Erinnerungen | offen |
| 3 Steuern | Jahresabschluss mit Push, Steuerpaket, Steuerzahlungen, Archiv | offen |
| 4 Automatik | Ledger-Sync, Prüfung Steuererklärung, BingX-API | offen |
