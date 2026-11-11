/* 草稿自动保存失败 / 重试专项：配额写满时保留旧草稿、只提示一次、恢复后继续保存 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('未找到 Chrome，请设置环境变量 CHROME_PATH 指向 chrome.exe');

const APP = 'http://127.0.0.1:4173/';
const OUT = path.join(__dirname, '..', '.e2e-downloads', 'autosave');
const KEY = 'excel-tool:autosave:v1';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  →  ' + detail : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text()); });

  const edit = async (r, c, text) => {
    await page.evaluate(([r, c, text]) => window.__excelTool.luckysheet.setCellValue(r, c, text), [r, c, text]);
    await page.waitForTimeout(2000);
  };
  const draft = () => page.evaluate((k) => localStorage.getItem(k), KEY);
  const breakStorage = () => page.evaluate((k) => {
    const orig = Storage.prototype.setItem;
    window.__origSetItem = orig;
    Storage.prototype.setItem = function (key, val) {
      if (key === k) throw new DOMException('quota exceeded', 'QuotaExceededError');
      return orig.call(this, key, val);
    };
  }, KEY);
  const restoreStorage = () => page.evaluate(() => {
    if (window.__origSetItem) Storage.prototype.setItem = window.__origSetItem;
  });
  const toastState = () => page.evaluate(() => {
    const t = document.querySelector('#toast');
    return { text: t.textContent, isError: t.classList.contains('error'), shown: t.classList.contains('show') };
  });
  const unloadBlocked = () => page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    return !window.dispatchEvent(e);
  });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  check('页面与表格渲染', await page.evaluate(() => !!document.querySelector('.luckysheet')));

  // 1. 正常写入
  await edit(0, 0, '版本一');
  const d1 = await draft();
  check('首次自动保存成功', !!d1 && d1.includes('版本一'), d1 ? d1.length + ' 字符' : 'null');

  // 2. 写入失败：保留旧草稿并提示
  await breakStorage();
  await edit(0, 1, '版本二');
  const d2 = await draft();
  const t1 = await toastState();
  check('写入失败后保留上一次草稿', d2 === d1);
  check('失败时弹出错误提示', t1.shown && t1.isError && t1.text.includes('草稿自动保存失败'), JSON.stringify(t1));

  // 3. 同一段失败期间不重复提示
  await page.waitForTimeout(3000); // 等提示自动消失
  await edit(0, 2, '版本三');
  const d3 = await draft();
  const t2 = await toastState();
  check('连续失败仍保留旧草稿', d3 === d1);
  check('连续失败不重复提示', !t2.shown, JSON.stringify(t2));

  // 4. 恢复写入能力后自动保存继续
  await restoreStorage();
  await edit(0, 3, '版本四');
  const d4 = await draft();
  check('恢复后自动保存继续生效', !!d4 && d4.includes('版本四') && d4 !== d1);

  // 5. 恢复后再次失败应重新提示
  await breakStorage();
  await edit(0, 4, '版本五');
  const d5 = await draft();
  const t3 = await toastState();
  check('再次失败仍保留旧草稿', d5 === d4);
  check('再次失败重新提示', t3.shown && t3.isError, JSON.stringify(t3));
  check('失败后离开页面受保护', await unloadBlocked());

  // 6. 配额仍满时确认离开，刷新后从旧草稿恢复；新页面的 Storage 原型会恢复。
  page.on('dialog', (dialog) => dialog.accept());
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const restored = await page.evaluate(() => {
    const s = window.__excelTool.luckysheet.getLuckysheetfile()[0];
    const v = (r, c) => (s.data && s.data[r] && s.data[r][c] ? s.data[r][c].v : null);
    return { a1: v(0, 0), a4: v(0, 3), a5: v(0, 4) };
  });
  check('刷新后恢复失败前的草稿',
    restored.a1 === '版本一' && restored.a4 === '版本四' && restored.a5 == null,
    JSON.stringify(restored));

  const restoreToast = await page.evaluate(() => document.querySelector('#toast').textContent);
  check('刷新后提示已恢复上次内容', restoreToast.includes('已恢复上次编辑的内容'), restoreToast);

  // 刷新恢复后仍能继续编辑并自动保存
  await edit(0, 5, '刷新后版本');
  const d6 = await draft();
  check('刷新后可继续编辑并自动保存', !!d6 && d6.includes('刷新后版本') && d6.includes('版本四'));
  check('保存恢复后解除离开保护', !(await unloadBlocked()));

  // 再次刷新应恢复刷新后写入的最新内容
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const restored2 = await page.evaluate(() => {
    const s = window.__excelTool.luckysheet.getLuckysheetfile()[0];
    const v = (r, c) => (s.data && s.data[r] && s.data[r][c] ? s.data[r][c].v : null);
    return { a1: v(0, 0), a4: v(0, 3), f1: v(0, 5) };
  });
  check('二次刷新仍能恢复最新草稿',
    restored2.a1 === '版本一' && restored2.a4 === '版本四' && restored2.f1 === '刷新后版本',
    JSON.stringify(restored2));

  const pass = results.filter((r) => r.ok).length;
  console.log('\n================ 汇总 ================');
  console.log(`通过 ${pass} / ${results.length}`);
  results.filter((r) => !r.ok).forEach((r) => console.log('  ✗ ' + r.name + '  ' + r.detail));
  console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ results, errors }, null, 1));
  await browser.close();
  process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 2);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
