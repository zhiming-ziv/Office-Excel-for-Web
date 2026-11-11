/* 临时验证：文件名就地重命名 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => fs.existsSync(p));
const OUT = path.join(__dirname, '..', '.e2e-downloads', 'rename');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errs.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const read = () => page.evaluate(() => document.querySelector('#file-name').textContent);
  console.log('初始:', await read());

  // 点击 -> 出现输入框
  await page.click('#file-name');
  const hasInput = await page.evaluate(() => !!document.querySelector('.fname-input'));
  const selected = await page.evaluate(() => {
    const i = document.querySelector('.fname-input');
    return i ? { start: i.selectionStart, end: i.selectionEnd, val: i.value } : null;
  });
  console.log('输入框出现:', hasInput, '| 选中范围:', JSON.stringify(selected));

  // 改名 + 回车
  await page.keyboard.press('Control+A');
  await page.keyboard.type('月度销售报表');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  console.log('回车后:', await read(), '| 输入框已移除:', !(await page.evaluate(() => !!document.querySelector('.fname-input'))));

  // Esc 取消
  await page.click('#file-name');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('不该生效');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log('Esc 取消后:', await read());

  // 空值提交回落默认名
  await page.click('#file-name');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('空值提交后:', await read());

  // 重新命名并保存，检查下载文件名
  await page.click('#file-name');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('报表-2026');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#btn-save')]);
  console.log('下载文件名:', dl.suggestedFilename());

  // 刷新后草稿是否保留新名字
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  console.log('刷新恢复后:', await read());

  // 输入中按 Ctrl+S 不应触发保存
  await page.click('#file-name');
  await page.keyboard.type('abc');
  const dlFired = await Promise.race([
    page.waitForEvent('download', { timeout: 1200 }).then(() => true).catch(() => false),
    page.keyboard.press('Control+S').then(() => false),
  ]);
  console.log('输入中 Ctrl+S 触发下载:', dlFired);
  await page.keyboard.press('Escape');

  await page.screenshot({ path: path.join(OUT, 'rename-final.png') });
  console.log('ERRORS:', errs.length ? JSON.stringify(errs) : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
