# Update auf v2.10.0 – Server-Backup

## 1. App hochladen
```bash
git add -A
git commit -m "Finance Vault v2.10.0"
git push
```
App auf dem iPhone öffnen → oben «Neue Version verfügbar» antippen (oder App ganz schliessen und neu öffnen).

## 2. Server aktualisieren (auf v2.1.0)
Ordner `finance-vault-server` durch die neue Version ersetzen – **`.env` und `data/` behalten**. Dann:

```bash
cd finance-vault-server
```

```bash
sudo chown -R 10001:10001 data
```

```bash
docker compose up -d --build
```

Optional in `.env` ergänzen (siehe `.env.example`): Grenzen und Aufbewahrung für Server-Backups (`FV_BACKUP_...`). Die Standardwerte passen meistens.

## 3. Server-Backup einrichten (einmalig)
1. App › Vault › Einstellungen › **Server-Backup** › «Server-Backup einrichten».
2. Backup-Passwort festlegen (mind. 10 Zeichen, z. B. vier zufällige Wörter).
3. **Backup-Passwort und PIN auf Papier notieren** und zu Hause aufbewahren – nicht nur auf dem iPhone. Ohne beides lässt sich kein Backup öffnen (auch nicht von dir).
4. Einmal unter «Sicherungen» › «Testen» prüfen, dass es sich öffnen lässt.

Ab dann sichert die App selbständig: höchstens einmal täglich, nur nach Änderungen. Der Server behält 7 Tage täglich, 5 Wochen wöchentlich, 12 Monate monatlich, 3 Jahre jährlich – ältere werden automatisch gelöscht.

## 4. Neues iPhone (oder Daten weg)
1. Tailscale installieren und anmelden, Finance Vault (GitHub-Pages-Adresse) in Safari öffnen › Teilen › «Zum Home-Bildschirm».
2. Auf dem Laptop:
   ```bash
   docker compose exec finance-vault python server.py pair
   ```
3. In der App: **«Vom Server wiederherstellen»** › Server-Adresse + Kopplungscode › Backup-Passwort + PIN › entsperren.

Alles ist zurück (Daten + Dokumente), die Server-Verbindung wird übernommen, das alte Gerät wird vom Server getrennt. Danach einmal «Mitteilungen aktivieren» (Push-Erlaubnis gilt pro Gerät).

## 5. Was weiterhin von Hand bleibt
- Bank- und VIAC-Kontostände (keine offene Schnittstelle) – monatliche Erinnerung.
- Fälle, die nicht eindeutig sind (z. B. Auszahlung an eine fremde Adresse) – unter «Bitte zuordnen», meist mit einem Tipp erledigt.
- Ab und zu `data/backups/` vom Laptop auf eine externe Festplatte kopieren (falls der Laptop selbst kaputt geht).
