/* 最终截图：深色 + 浅色主题下的工具栏下拉 / 取色面板 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const CHROME = require('./browser-path.cjs');
const APP = 'http://127.0.0.1:4173/';
const OUT = path.join(__dirname, '..', '.e2e-downloads');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'light', deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  const openAndShot = async (btnSel, menuId, name) => {
    const el = await page.$(btnSel);
    if (!el) return console.log('skip ' + name);
    const b = await el.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(620);
    const m = await page.evaluate((id) => {
      const e = document.getElementById(id);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, menuId);
    if (!m) { console.log('no menu ' + name); return; }
    await page.screenshot({
      path: path.join(OUT, name),
      clip: { x: Math.max(0, m.x - 8), y: Math.max(0, m.y - 8), width: Math.min(1600 - m.x, m.w + 16), height: Math.min(900 - m.y, m.h + 16) },
    });
    console.log('ok ' + name + ' ' + Math.round(m.w) + 'x' + Math.round(m.h));
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelectorAll('[id$="-menuButton"]').forEach((e) => e.remove()));
    await page.mouse.click(1250, 830);
    await page.waitForTimeout(320);
  };

  // 浅色主题
  await openAndShot('#luckysheet-icon-fmt-other', 'luckysheet-icon-fmt-other-menuButton', 'final-light-numformat.png');
  await openAndShot('#luckysheet-icon-text-color-menu', 'luckysheet-icon-text-color-menu-menuButton', 'final-light-textcolor.png');

  // 深色主题
  await page.click('#btn-theme');
  await page.waitForTimeout(900);
  await openAndShot('#luckysheet-icon-fmt-other', 'luckysheet-icon-fmt-other-menuButton', 'final-dark-numformat.png');
  await openAndShot('#luckysheet-icon-text-color-menu', 'luckysheet-icon-text-color-menu-menuButton', 'final-dark-textcolor.png');
  await openAndShot('#luckysheet-icon-border-menu', 'luckysheet-icon-border-menu-menuButton', 'final-dark-border.png');
  await page.screenshot({ path: path.join(OUT, 'final-dark-toolbar.png') });

  console.log('ERRORS:', errs.length ? JSON.stringify(errs) : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
