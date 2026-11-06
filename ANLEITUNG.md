# Update auf v2.3.0

## 1. Hochladen

```bash
git add -A
git commit -m "Finance Vault v2.3.0: Fixes, Sicherheit"
git push
```

## 2. Auf dem iPhone

1. App öffnen. Sie lädt die neue Version (ggf. einmal ganz schliessen und neu öffnen, oder oben «Neue Version verfügbar» antippen).
2. Entsperren. Der Vault wird dabei automatisch auf die stärkere Verschlüsselung (600'000 Iterationen) umgestellt – dauert ein bis zwei Sekunden.
3. **Neues Backup** erstellen: Vault › Einstellungen › Backup exportieren – jetzt mit Backup-Passwort (mind. 10 Zeichen, z. B. vier Wörter). Datei in «Dateien» sichern, Passwort getrennt notieren. Alte Backups sind nur PIN-geschützt → löschen.

### Nur falls der Spalt unter der Tab-Leiste bleibt

Die neue Statusleisten-Einstellung liest iOS **nur beim Hinzufügen zum Home-Bildschirm**. Achtung: Eine Home-Bildschirm-App hat auf dem iPhone ihren **eigenen Speicher** – beim Entfernen des Icons werden ihre Daten gelöscht.

1. Backup aus Schritt 3 muss vorhanden sein (und Backup-Passwort + PIN bekannt).
2. Icon entfernen › in Safari `https://geisterzwerk.github.io/Finance_Vault/` öffnen › Teilen › Zum Home-Bildschirm.
3. App öffnen › auf dem Willkommen-Bildschirm **«Backup wiederherstellen»** › Backup-Datei wählen › Passwort und PIN eingeben.

## 3. Künftige Updates

- Nach `git push` erkennt die App neue Versionen selbst, sobald du sie wieder öffnest: oben erscheint «Neue Version verfügbar – tippen zum Neuladen».
- In `sw.js` die `VERSION` und in `js/version.js` die `APP_VERSION` erhöhen (für einen sauberen Offline-Cache). Updates kommen aber auch an, wenn du es vergisst.

## 4. Server

Siehe `finance-vault-server/README.md`. Neu: Dockerfile mit Härtung, `server.py pair|status|revoke-all`, Host-Prüfung.
Nach dem Update auf Linux einmal `sudo chown -R 10001:10001 data` ausführen (Container läuft nicht mehr als root).
