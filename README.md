# BSKV Scraper

Dieses Node.js-Backend holt automatisch und zeitgesteuert die aktuelle Ligatabelle von der BSKV Sportwinner-Webseite. Da es sich um eine Single Page Application handelt, navigiert das Skript mit Hilfe eines unsichtbaren Chrome-Browsers (Puppeteer) über den angegebenen Klickpfad bis zur Tabelle.

## 🛠️ Installation

1. Stelle sicher, dass [Node.js](https://nodejs.org/) installiert ist.
2. Wechsle in diesen Ordner (`backend`).
3. Installiere die Abhängigkeiten:
   ```bash
   npm install
   ```

## ⚙️ Konfiguration

Öffne die Datei `scraper.js` und passe ganz oben das Array `CLICK_PATH` an.

**Beispiel:**
```javascript
const CLICK_PATH = [
  'Mittelfranken',
  'Männer',
  'Bezirksliga Süd'
];
```
Das Skript sucht nacheinander nach Links oder Buttons mit genau diesem Text und klickt sie an, um zur finalen Tabelle zu navigieren.

## 🚀 Ausführung

**1. Testmodus (Sofortiger manueller Abruf):**
Um zu testen, ob dein Klickpfad funktioniert und die Daten extrahiert werden können:
```bash
npm run test
```
Die Daten werden danach im Hauptverzeichnis deiner App als `bskv_data.json` gespeichert.

**2. Live-Betrieb (Automatischer Service):**
Um das Skript dauerhaft mit den hinterlegten Zeitschaltuhren (Cron-Jobs) laufen zu lassen:
```bash
npm start
```

Das Skript holt die Tabelle dann automatisch ab:
- **Mo-Fr:** Einmal nachts (03:00 Uhr)
- **Sa-So:** Alle 30 Minuten
