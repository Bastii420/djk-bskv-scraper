const puppeteer = require('puppeteer');
const fs = require('fs');

async function testScrape() {
  const KLUB_NUMMER = '10009-001';
  const TARGET_URL = 'https://bskv.sportwinner.de/';

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

    console.log("Navigating...");
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

    console.log("Setting Klub-Nr...");
    await page.waitForSelector('#id-button-einstellungen', { timeout: 10000 });
    await page.evaluate(() => document.getElementById('id-button-einstellungen').click());
    
    await page.waitForSelector('#id-klub-nr', { visible: true });
    await page.evaluate((nr) => {
      const input = document.getElementById('id-klub-nr');
      input.value = nr;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, KLUB_NUMMER);
    
    await page.evaluate(() => document.getElementById('id-button-einstellungen-option-ok').click());
    
    await new Promise(r => setTimeout(r, 3000));

    console.log("Clicking league...");
    const leagueName = 'Männer - Bezirksoberliga MFR';
    const clicked = await page.evaluate((name) => {
      const elements = Array.from(document.querySelectorAll('a, span, li')).filter(el => el.textContent.trim() === name);
      if (elements.length === 0) return false;
      
      const target = elements[0];
      const dropdownMenu = target.closest('.dropdown-menu');
      if (dropdownMenu) {
        const isVisible = window.getComputedStyle(dropdownMenu).display !== 'none';
        if (!isVisible) {
          const parent = dropdownMenu.parentElement;
          if (parent) {
            const toggleBtn = parent.querySelector('[data-toggle="dropdown"], .dropdown-toggle');
            if (toggleBtn) toggleBtn.click();
          }
        }
      }
      target.click();
      return true;
    }, leagueName);

    if (!clicked) throw new Error("League not found");
    await new Promise(r => setTimeout(r, 2000));

    // Try to find the "Spielplan" tab or button
    console.log("Clicking DJK Abenberg match result...");
    const matchClicked = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#id-table-spielplan tbody tr'));
        for(let row of rows) {
            if(row.innerText.includes('DJK Abenberg')) {
                const tds = row.querySelectorAll('td');
                if (tds.length >= 5) {
                    tds[4].click();
                    return true;
                }
            }
        }
        return false;
    });

    console.log("Match clicked:", matchClicked);
    await new Promise(r => setTimeout(r, 4000));

    await page.screenshot({ path: 'screenshot_match2.png', fullPage: true });
    
    const tablesHtml3 = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('table')).map(t => t.outerHTML);
    });
    fs.writeFileSync('tables_dump3.html', tablesHtml3.join('\n\n<hr>\n\n'));

  } catch (err) {
    console.error(err);
  } finally {
    if (browser) await browser.close();
  }
}
testScrape();
