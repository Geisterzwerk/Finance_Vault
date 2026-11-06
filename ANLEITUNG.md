# Update auf v2.6.0 – alles automatisch

## 1. App hochladen
```bash
git add -A
git commit -m "Finance Vault v2.6.0"
git push
```
App auf dem iPhone öffnen → oben «Neue Version verfügbar» antippen (oder App ganz schliessen und neu öffnen).

## 2. Server aktualisieren (Ubuntu-Server oder Laptop)
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

Optional in `.env` ergänzen (siehe `.env.example`): `COINGECKO_API_KEY=...` (kostenloser Demo-Schlüssel, schnellerer Start).

## 3. In der App (einmalig)
1. **Server koppeln** (falls noch nicht): Vault › Einstellungen › Eigener Server. Kopplungscode: `docker compose exec finance-vault python server.py pair`
2. **Mitteilungen aktivieren** (gleiche Stelle).
3. **Ledger-Adressen** sind schon eingetragen – die App gibt sie automatisch an den Server weiter.
4. **Wertschriften mit Ticker** (optional): Invest › Konten › Depot öffnen › Positionen, z. B. `VWRL.SW 12`.

Ab dann: App öffnen genügt. Die Karte **Automatik** auf der Übersicht zeigt, ob Kurse, BingX und Ledger aktuell sind und ob der Abgleich stimmt.

## 4. Was weiterhin von Hand bleibt
- Bank- und VIAC-Kontostände (keine offene Schnittstelle) – monatliche Erinnerung.
- Fälle, die nicht eindeutig sind (z. B. Auszahlung an eine fremde Adresse) – unter «Bitte zuordnen», meist mit einem Tipp erledigt.
