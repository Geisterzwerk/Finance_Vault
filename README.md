# Finance Vault

Persönliches Finanz-Cockpit als iPhone-Web-App (PWA): Crypto mit Ø-Kaufpreis und Gewinn/Verlust, Konten, Ziele mit Meilensteinen, Crypto-Steuerbericht per 31.12. für Basel-Landschaft und Rechnungen.

- **Verschlüsselt:** Alle Daten liegen AES-256-verschlüsselt auf dem Gerät (PIN → PBKDF2-SHA256, 600'000 Iterationen → AES-GCM)
- **Lokal:** Kein Konto, keine Cloud. Der optionale eigene Server sieht nur Termine und BingX-Trades
- **Nichts zu installieren:** HTML/CSS/JavaScript, kein Build. Bibliotheken liegen fest versioniert unter `vendor/`

> ⚠️ **PIN vergessen = Daten weg.** Es gibt bewusst keine Hintertür. PIN sicher notieren und regelmässig ein Backup machen.

## Struktur

```
finance-vault/
├── index.html             inkl. Content-Security-Policy
├── manifest.webmanifest, sw.js (Offline + Updates)
├── css/style.css          Design (Navy & Gold), App-Gerüst fürs iPhone
├── icons/
├── vendor/                tesseract.js 5.1.1 (+deu), jsQR 1.4.0, pdf.js 3.11.174 – Prüfsummen in SHA256SUMS
└── js/
    ├── app.js             Start, Sperrbildschirm, Navigation, Kurse, Meilensteine, Auto-Sperre, Update-Hinweis
    ├── version.js         App-Version
    ├── vault.js           Verschlüsselter Speicher (IndexedDB + Web Crypto), Backup, PIN-Bremse
    ├── store.js           App-Zustand, Demo-Daten, Standard-Ziele
    ├── calc.js            Bestand, Ø-Preis, Gewinne, Nettovermögen, Stichtag
    ├── prices.js          CoinGecko: Live- und historische Kurse in CHF
    ├── bingx.js           BingX-Kontoauszüge (Spot/Fund) mit Saldo-Abgleich und Zeitzone
    ├── importer.js        Allgemeiner CSV-Import (Relai, andere)
    ├── ledger.js          Bestände über öffentliche Adressen
    ├── taxpack.js         Jahresabschluss, Steuerpaket, Prüfung Steuererklärung
    ├── scan.js, scanui.js Dokumentscanner, OCR, QR-Rechnung, PDF
    ├── server.js          Anbindung an den eigenen Server
    ├── backup.js          Automatisches Server-Backup, Wiederherstellung auf neuem Gerät
    ├── libs.js            Lädt die Bibliotheken aus vendor/
    ├── ui.js              Formatierung, Sheets, Auswahlknöpfe, Konfetti
    ├── views-main.js      Übersicht, Invest, Coin-Detail, Konten, Ziele
    ├── views-more.js      Steuern, Rechnungen, Vault (Import, Prüfen, Einstellungen)
    └── views-docs.js      Inbox, Dokumente, Ledger, Jahresabschluss, Archiv
```

## Sicherheit

- **Verschlüsselung:** AES-GCM-256 mit zufälligem IV pro Speichervorgang, Schlüssel per PBKDF2-SHA256 (600'000 Iterationen) aus dem PIN, nicht exportierbar, nur im Arbeitsspeicher. Ältere Vaults werden beim Entsperren automatisch umgeschlüsselt (atomar).
- **PIN-Bremse:** Nach 5 Fehlversuchen 30 s Wartezeit, danach jeweils doppelt so lang (max. 1 h).
- **PIN oder Passphrase:** Ein 6-stelliger Zahlen-PIN ist bequem, lässt sich aber bei einer gestohlenen Datei offline in Minuten durchprobieren. Darum: Backups zusätzlich mit separatem **Backup-Passwort** (mind. 10 Zeichen). Wer es maximal sicher will, wählt auch als PIN eine Passphrase.
- **Sperren:** Nach der eingestellten Zeit im Hintergrund wird gesperrt und der entschlüsselte Zustand aus dem Arbeitsspeicher entfernt. Im App-Umschalter sind Beträge verdeckt.
- **Kein fremder Code:** Content-Security-Policy erlaubt nur Skripte vom eigenen Ursprung (kein Inline-JS, kein `eval`). Alle Bibliotheken liegen in `vendor/` – kein CDN.
- **Belege:** Nur PDF und Bilder werden im Browser geöffnet. SVG/HTML-Dateien könnten Skripte enthalten und werden deshalb nie im App-Ursprung angezeigt.
- **PDF:** pdf.js läuft mit `isEvalSupported: false` (Schutz vor CVE-2024-4367).
- **Nie gespeichert:** Seed Phrase, private Schlüssel, Passwörter von Börsen. Ledger nur über öffentliche Adressen.

## Testen in VS Code

Rechtsklick auf `index.html` → **Open with Live Server** (oder `python -m http.server 8000`). Test-PIN festlegen, dann **Vault › Einstellungen › Demo-Daten laden**.

## GitHub und iPhone

```powershell
git init
git add .
git commit -m "Finance Vault v2.1"
git branch -M main
git remote add origin https://github.com/Geisterzwerk/Finance_Vault.git
git push -u origin main
```

GitHub → Settings › Pages → Branch `main`, `/ (root)`. Dann `https://geisterzwerk.github.io/Finance_Vault/` in Safari öffnen → Teilen → Zum Home-Bildschirm.

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

- **Transfer:** Bestand und Ø-Preis bleiben. «Gebühr CHF» zählt nur zu den Gebühren; eine Netzwerkgebühr in Coins («Netzwerkgebühr in Coins») verlässt den Bestand, die Kostenbasis bleibt (Ø steigt leicht).
- **Reward/Rebate:** Kostenbasis CHF 0 (konservativ: späterer Verkauf zeigt den vollen Erlös als Gewinn).
- **Duplikate:** BingX über den Zeilenschlüssel des Auszugs, CSV über Transaktions-ID bzw. Zeilen-Hash – gleiche Zeilen innerhalb derselben Datei zählen als eigene Buchungen. Gelöschte Import-Buchungen kommen bei einem erneuten Import nicht zurück.

## Steuern

Bestand per 31.12., 23:59 Uhr. Steuerkurse aus der ESTV-Kursliste (ICTax) eintragen oder Ersatzkurse laden. «Jahr abschliessen» friert den Snapshot ein. Bericht als PDF oder CSV. Organisationshilfe, keine Steuerberatung.

## Dokumente, Scanner, Inbox (Phase 2)

- **Vault › Dokument scannen:** Foto aufnehmen → Ecken werden geschätzt und lassen sich ziehen → Perspektive korrigiert → Kontrast (Dokument, S/W, Farbe) → mehrere Seiten → PDF.
- **QR-Rechnung:** Empfänger, IBAN, Referenz und Betrag direkt aus dem Swiss-QR-Code.
- **Texterkennung (OCR, Deutsch):** Betrag, Datum, Fälligkeit, Rechnungsnummer, Absender. Vorschlag für Kategorie, Steuerrelevanz und E-Tax-Ziffer.
- **Finance Inbox:** «Später» legt Scans zum Prüfen ab. Dokumente werden verschlüsselt nach Jahr abgelegt, Suche auch im erkannten Text.
- OCR, QR und PDF-Lesen laufen **auf dem Gerät**. Die Bibliotheken (tesseract.js, jsQR, pdf.js) liegen im Repo unter `vendor/` und werden beim ersten Gebrauch offline gecacht. Deine Dokumente verlassen das Gerät nie.
- **Erinnerungen:** Vault › Einstellungen › «Erinnerungen in Kalender übernehmen» erzeugt Kalendertermine mit Alarm (31.12., 2.1., Januar-Dokumente, monatliches Update, alle offenen Rechnungen). Diese melden sich auch bei geschlossener App.

## Steuern (Phase 3)

- **Jahresabschluss:** Vom 31.12. bis Ende März erscheint er auf der Übersicht. Datencheck pro Quelle (BingX, Relai, Konten, Ledger, Zuordnungen, Steuerkurse) mit Sprung zum Aktualisieren. Erst wenn alles grün ist: Snapshot 31.12., 23:59 Uhr einfrieren.
- **Steuerpaket (ZIP):** Übersicht «Was muss ich wo eintragen?» (HTML), Crypto-Steuerbericht (CSV), alle steuerrelevanten Belege nach Ordnern, Steuererklärung und Veranlagung.
- **Steuerzahlungen:** Rechnungen mit Kategorie «Steuern», Steuerart (Staat BL, Gemeinde, Bund) und Steuerjahr → Soll, bezahlt, offen.
- **Archiv:** Eingereichte Erklärung und Veranlagung pro Jahr; abgeschlossene Jahre bleiben erhalten. Checklisten-Punkte aus dem Vorjahr werden markiert.

## Automatik und Prüfung (Phase 4)

- **Ledger-Abgleich:** öffentliche Adressen für BTC, ETH (+LINK, ONDO), AVAX, SOL, XRP, SUI, NEAR, KAS, SEI. Vergleich App-Bestand mit Ledger + Rest auf BingX, Ausgleich auf Knopfdruck. Bei Bitcoin alle verwendeten Adressen eintragen (xpub wird nicht unterstützt). Die Endpunkte sind öffentlich und konnten hier nicht live getestet werden.
- **Prüfung der Steuererklärung:** PDF aus E-Tax BL hochladen → Finance Vault sucht Coins, Beträge, Abzüge und Konten im Text und zeigt eine Ampel. Keine Garantie, sondern Hinweise.

## Stand

| Phase | Inhalt | Stand |
|---|---|---|
| 1 Fundament | PIN, Verschlüsselung, Konten, Import, Duplikate, Ø-Preis, Live-Kurse, Dashboard, Ziele | ✅ |
| Extra | BingX-Kontoauszug mit Saldo-Abgleich, Rechnungen, Crypto-Steuerbericht | ✅ |
| 2 Dokumente | Scanner, QR-Rechnung, OCR, Finance Inbox, Kalender-Erinnerungen | ✅ |
| 3 Steuern | Jahresabschluss, Steuerpaket, Steuerzahlungen, Archiv | ✅ |
| 4 Automatik | Ledger-Abgleich, Prüfung Steuererklärung | ✅ |
| 5 Server | Eigener Server (Docker, Tailscale): Push-Mitteilungen, BingX-API-Trades | ✅ siehe `finance-vault-server/README.md` |
