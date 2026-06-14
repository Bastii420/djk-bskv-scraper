const puppeteer = require('puppeteer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// ==========================================
// KONFIGURATION
// ==========================================

// 1. VEREINS-SETUP
// Trage hier deine Klubnummer ein. Das Skript klickt automatisch auf das Zahnrad
// und trägt diese Nummer ein, damit der Verein geladen wird.
const KLUB_NUMMER = '10009-001';

// 2. ZU SCRAPENDE LIGEN (Wie in deinem Screenshot)
const LEAGUES = [
  'Männer - Bezirksoberliga',
  'Männer - Bezirksliga Süd-West',
  'Männer - Kreisliga Süd',
  'Männer - Kreisklasse A Süd',
  'Frauen - Kreisliga Süd-West',
  'Jugend U 14 - Bezirksliga'
];

const TARGET_URL = 'https://bskv.sportwinner.de/';
const OUTPUT_FILE = path.join(__dirname, '..', 'bskv_data.json'); 

async function scrapeTable() {
  console.log(`[${new Date().toISOString()}] Starte BSKV Scraper für ${LEAGUES.length} Ligen...`);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if(['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`Navigiere zu ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

    // 1. Verein über Zahnrad einstellen
    if (KLUB_NUMMER) {
      console.log(`Richte Verein über Zahnrad ein (Klubnummer: ${KLUB_NUMMER})...`);
      
      // Auf Zahnrad klicken (mit evaluate, da puppeteer den Knopf sonst als 'nicht klickbar' blockiert)
      await page.waitForSelector('#id-button-einstellungen', { timeout: 10000 });
      await page.evaluate(() => document.getElementById('id-button-einstellungen').click());
      
      // Warten bis das Modal sichtbar ist und das Feld existiert
      await page.waitForSelector('#id-klub-nr', { visible: true });
      
      // Feld leeren und neue Nummer eintragen
      // Evaluieren ist oft sicherer als page.type, um das onChange/onInput Event sauber zu triggern
      await page.evaluate((nr) => {
        const input = document.getElementById('id-klub-nr');
        input.value = nr;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, KLUB_NUMMER);
      
      // Auf 'Ok' klicken
      await page.evaluate(() => document.getElementById('id-button-einstellungen-option-ok').click());
      
      // Warten, bis die SPA die neuen Vereinsdaten geladen hat
      console.log('Warte auf das Laden der Vereinsdaten...');
      await new Promise(r => setTimeout(r, 3000)); 
    }

    const allLeaguesData = {};

    // 2. Ligen durchlaufen
    for (const leagueName of LEAGUES) {
      console.log(`\nVerarbeite Liga: "${leagueName}"`);
      
      // Clevere Funktion im Browser: Sucht den Link, öffnet notfalls das Dropdown und klickt ihn
      const clicked = await page.evaluate((name) => {
        const elements = Array.from(document.querySelectorAll('a, span, li')).filter(el => el.textContent.trim() === name);
        if (elements.length === 0) return false;
        
        const target = elements[0];
        
        // Prüfen, ob der Link in einem Dropdown ist, das aktuell zu ist
        const dropdownMenu = target.closest('.dropdown-menu');
        if (dropdownMenu) {
          // Ist das Dropdown sichtbar?
          const isVisible = window.getComputedStyle(dropdownMenu).display !== 'none';
          if (!isVisible) {
            // Finde den Toggle-Button für dieses Menü und klicke ihn
            const parent = dropdownMenu.parentElement;
            if (parent) {
              const toggleBtn = parent.querySelector('[data-toggle="dropdown"], .dropdown-toggle');
              if (toggleBtn) toggleBtn.click();
            }
          }
        }
        
        // Jetzt auf die Liga selbst klicken
        target.click();
        return true;
      }, leagueName);

      if (!clicked) {
        console.error(`  -> Liga "${leagueName}" im Menü nicht gefunden! Überspringe...`);
        continue;
      }

      // Warten bis die Seite die Tabelle neu geladen hat
      await new Promise(r => setTimeout(r, 2000));
      await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});

      console.log('  -> Extrahiere Tabelle...');
      const tableData = await page.evaluate(() => {
        // Finde die eigentliche Ligatabelle (und ignoriere Spielpläne, Schnittlisten etc.)
        const tables = Array.from(document.querySelectorAll('table'));
        let targetTable = null;
        
        for (const table of tables) {
          const headers = Array.from(table.querySelectorAll('th'));
          // Die Ligatabelle hat eine Spalte "Mannschaft" (im Gegensatz zu "Spieler" in der Schnittliste)
          // und eine Spalte "TP" (Tabellenpunkte) oder "Sp." (Spiele)
          if (headers.some(th => th.textContent.includes('Mannschaft'))) {
            targetTable = table;
            break;
          }
        }

        if (!targetTable) return [];

        const rows = Array.from(targetTable.querySelectorAll('tr'));
        const data = [];
        
        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll('td');
          // Nur Zeilen mit Daten berücksichtigen (keine Zwischenüberschriften)
          if (cells.length >= 4) {
            const platzText = cells[0].innerText.trim();
            
            // Wenn in der ersten Spalte eine Zahl steht, ist es ein Team!
            if (!isNaN(parseInt(platzText))) {
              data.push({
                platz: parseInt(platzText),
                // Entfernt das "\nSC" oder "\nAL" was manchmal noch im HTML in der gleichen Zelle steckt
                mannschaft: cells[1].innerText.split('\n')[0].trim(),
                spiele: parseInt(cells[2].innerText.trim()) || 0,
                // cells[3] ist in der Regel "TP" (Tabellenpunkte wie "25 - 7"), cells[4] ist "MP"
                punkte: cells[3] ? cells[3].innerText.trim() : '',
                mp: cells[4] ? cells[4].innerText.trim() : ''
              });
            }
          }
        }
        return data;
      });

      console.log(`  -> ${tableData.length} Teams gefunden.`);
      
      // 2.2 Spielplan aufrufen und auslesen
      console.log('  -> Navigiere zum Spielplan...');
      const spielplanClicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, span, button, li'));
        for(let l of links) {
            if(l.textContent.trim() === 'Spielplan') {
                l.click();
                return true;
            }
        }
        return false;
      });

      let gamesData = [];
      if (spielplanClicked) {
        await new Promise(r => setTimeout(r, 2000));
        await page.waitForSelector('#id-table-spielplan', { timeout: 10000 }).catch(() => {});
        
        console.log('  -> Extrahiere Spielplan...');
        gamesData = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('#id-table-spielplan tbody tr'));
          const games = [];
          
          for (let row of rows) {
            // "1. Spieltag" Header überspringen
            if (row.classList.contains('groupBy')) continue;
            
            const cells = row.querySelectorAll('td');
            if (cells.length >= 5) {
              games.push({
                nr: cells[0].innerText.trim(),
                datumZeit: cells[1].innerText.trim(),
                heim: cells[2].innerText.trim(),
                gast: cells[3].innerText.trim(),
                ergebnis: cells[4].innerText.trim()
              });
            }
          }
          return games;
        });
        console.log(`  -> ${gamesData.length} Spiele gefunden.`);
      } else {
        console.log('  -> Link "Spielplan" nicht gefunden.');
      }

      // Datenstruktur anpassen, um beide Informationen zu halten
      allLeaguesData[leagueName] = {
        standings: tableData,
        games: gamesData
      };
    }

    // JSON speichern
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allLeaguesData, null, 2));
    console.log(`\n[Erfolg] Daten für ${Object.keys(allLeaguesData).length} Ligen lokal in ${OUTPUT_FILE} gespeichert!`);

    // Neu: An Firebase senden
    try {
      const firebaseResponse = await fetch('https://djk-abenberg-default-rtdb.europe-west1.firebasedatabase.app/bskv_data.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allLeaguesData)
      });
      if (firebaseResponse.ok) {
        console.log(`[Erfolg] Daten erfolgreich an Firebase Cloud Datenbank gesendet!`);
      } else {
        console.error(`[Fehler] Firebase Upload fehlgeschlagen:`, firebaseResponse.statusText);
      }
    } catch (e) {
      console.error(`[Fehler] Firebase Upload fehlgeschlagen:`, e.message);
    }
    
  } catch (error) {
    console.error('Fehler beim Scrapen:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ==========================================
// SCHEDULING LOGIK
// ==========================================

const isTestMode = process.argv.includes('--test');

if (isTestMode) {
  scrapeTable();
} else {
  cron.schedule('0 3 * * 1-5', () => scrapeTable());
  cron.schedule('*/30 * * * 0,6', () => scrapeTable());
  console.log('BSKV-Scraper Service gestartet (Multi-Liga Modus)!');
}

module.exports = { scrapeTable };
