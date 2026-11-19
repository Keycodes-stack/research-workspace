// Browser integration checks for the Halden page, run against the local stack (backend :8001, gateway :8080,
// web :3000). Needs Playwright and a Chromium build; see docs/STATUS.md.
//   PLAYWRIGHT_MODULE=file:///path/to/node_modules/playwright/index.mjs node halden-browser.mjs <token-file> <out-dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Playwright is resolved from PLAYWRIGHT_MODULE (a file URL) or the 'playwright' package.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const [tokenFile, outDir] = process.argv.slice(2);
if (!tokenFile || !outDir) {
  console.error('usage: node halden-browser.mjs <token-file> <out-dir>');
  process.exit(2);
}
const token = readFileSync(tokenFile, 'utf8').trim();
const WEB = 'http://localhost:3000/halden.html?api=http://localhost:8080';
const API = 'http://localhost:8080';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
};
const hash = (route) => `${WEB}#${route}`;

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/dell/AppData/Local/ms-playwright/chromium-1187/chrome-win/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
const apiCalls = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('request', (r) => { if (r.url().startsWith(API + '/')) apiCalls.push(r.url().replace(API, '').split('?')[0]); });
await page.addInitScript((t) => localStorage.setItem('kc_token', t), token);

// Delays every API call while `slow` is true, so the loading state can be seen.
let slow = false;
await page.route(`${API}/**`, async (route) => {
  if (slow) await new Promise((r) => setTimeout(r, 1500));
  await route.continue();
});
const waitLive = () => page.waitForFunction(() => !document.querySelector('#main .skel'), null, { timeout: 20000 }).catch(() => undefined);

// 1. Home: skeleton during a slow first load, then live content.
slow = true;
await page.goto(hash('home'), { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
const skelHome = await page.locator('#main .skel').count();
check('home: skeleton is shown while the first load is slow', skelHome > 0, `${skelHome} placeholder blocks`);
slow = false;
await waitLive();
const liveHome = await page.locator('#main .skel').count();
check('home: skeleton is replaced by live content', liveHome === 0, `${liveHome} placeholder blocks left`);
await page.screenshot({ path: join(outDir, 'live_home.png') });

// 2. Each screen's skeleton on a fresh page load (nothing cached yet).
for (const route of ['radar', 'board', 'list', 'sources', 'projects']) {
  slow = true;
  await page.goto('about:blank');                     // a real reload: nothing is cached yet
  await page.goto(hash(route), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const n = await page.locator('#main .skel').count();
  check(`${route}: skeleton shows on first load`, n > 0, `${n} blocks`);
  await page.screenshot({ path: join(outDir, `skeleton_${route}.png`) });
  slow = false;
  await waitLive();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `live_${route}.png`) });
}

// 3. Cache: a revisit inside the window is served from memory, not requested again.
await page.goto('about:blank');
await page.goto(hash('home'), { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
apiCalls.length = 0;
await page.evaluate(() => { location.hash = '#radar'; });
await page.waitForTimeout(1200);
const firstRadar = apiCalls.filter((c) => c.endsWith('/signals')).length;
await page.evaluate(() => { location.hash = '#home'; });
await page.waitForTimeout(600);
await page.evaluate(() => { location.hash = '#radar'; });
await page.waitForTimeout(1200);
const secondRadar = apiCalls.filter((c) => c.endsWith('/signals')).length;
check('first Radar visit requests signals once', firstRadar === 1, `requests: ${firstRadar}`);
check('revisiting Radar inside 60 s does not request signals again', secondRadar === firstRadar, `requests: ${firstRadar} then ${secondRadar}`);
const skelRevisit = await page.locator('#main .skel').count();
check('revisiting Radar shows data at once (no skeleton)', skelRevisit === 0, `${skelRevisit} blocks`);

// 4. Methodologies still works (no API).
await page.evaluate(() => { location.hash = '#methods'; });
await page.waitForTimeout(500);
const rows = await page.locator('tr[data-act="methodPick"]').count();
check('methodologies lists 8 methods', rows === 8, `${rows} rows`);

// 5. No page or console errors.
check('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
