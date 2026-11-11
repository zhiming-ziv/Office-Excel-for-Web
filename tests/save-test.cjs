/* 保存专项：xls/xlsm 转 xlsx 命名、冻结行列导出、打开文件覆盖确认、CSV 保存命名 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME = require('./browser-path.cjs');

const APP = 'http://127.0.0.1:4173/';
const OUT = path.join(__dirname, '..', '.e2e-downloads', 'save-test');
const SAMPLE = path.resolve(__dirname, '../sample.xlsx');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  →  ' + detail : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const xlsmPath = path.join(OUT, 'sample.xlsm');
  const csvPath = path.join(OUT, 'confirm.csv');
  fs.copyFileSync(SAMPLE, xlsmPath);
  fs.writeFileSync(csvPath, '名称,数量\n确认测试,1\n', 'utf8');

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const fileName = () => page.textContent('#file-name');
  const saveTo = async (file) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
    await download.saveAs(file);
    return download.suggestedFilename();
  };

  /* 1. 打开 .xlsm 后保存，文件名与内容格式必须一致 */
  await page.setInputFiles('#file-input', xlsmPath);
  await page.waitForTimeout(3500);
  check('打开 .xlsm', (await fileName()) === 'sample.xlsm', await fileName());
  const name1 = await saveTo(path.join(OUT, 'xlsm-saved.xlsx'));
  check('xlsm 保存为 .xlsx', name1 === 'sample.xlsx', name1);
  check('保存后标题同步为 .xlsx', (await fileName()) === 'sample.xlsx', await fileName());

  /* 2. 冻结首行 → 保存 → 必须写入 pane 视图 */
  const freezeBtn = await page.$('#luckysheet-icon-freezen-menu');
  const box = await freezeBtn.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  const point = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.luckysheet-cols-menuitem-content'))
      .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 2);
    const target = items.find((e) => e.textContent.trim() === '冻结首行');
    if (!target) return null;
    const r = target.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (point) await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(800);
  const frozen = await page.evaluate(() => window.__excelTool.luckysheet.getLuckysheetfile()[0].frozen);
  check('冻结首行已生效', !!point && frozen && frozen.type === 'row', JSON.stringify(frozen));

  const frozenFile = path.join(OUT, 'frozen-saved.xlsx');
  await saveTo(frozenFile);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(frozenFile));
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const pane = (sheetXml.match(/<pane\b[^>]*>/g) || []).find((p) => /state="frozen"/.test(p)) || '';
  check('冻结视图写入 xlsx', /ySplit="1"/.test(pane), pane || '未找到 pane');

  /* 3. 打开新文件覆盖确认：取消不改变当前工作簿 */
  let msg = '';
  const dismissDialog = page.waitForEvent('dialog').then(async (d) => {
    msg = d.message();
    await d.dismiss();
  });
  await page.setInputFiles('#file-input', csvPath);
  await dismissDialog;
  await page.waitForTimeout(900);
  check('覆盖确认文案', msg.includes('覆盖自动保存的草稿'), msg);
  check('取消后保留当前工作簿', (await fileName()) === 'sample.xlsx', await fileName());

  const acceptDialog = page.waitForEvent('dialog').then((d) => d.accept());
  await page.setInputFiles('#file-input', csvPath);
  await acceptDialog;
  await page.waitForTimeout(2500);
  check('确认后打开新文件', (await fileName()) === 'confirm.xlsx', await fileName());
  const a1 = await page.evaluate(() => {
    const s = window.__excelTool.luckysheet.getLuckysheetfile()[0];
    return s.data && s.data[0] && s.data[0][0] ? s.data[0][0].v : null;
  });
  check('CSV 内容已载入', a1 === '名称', String(a1));

  /* 4. CSV 打开后保存仍输出 .xlsx */
  const name4 = await saveTo(path.join(OUT, 'csv-saved.xlsx'));
  check('CSV 保存为 .xlsx', name4 === 'confirm.xlsx', name4);

  const pass = results.filter((r) => r.ok).length;
  console.log('\n================ 汇总 ================');
  console.log(`通过 ${pass} / ${results.length}`);
  results.filter((r) => !r.ok).forEach((r) => console.log('  ✗ ' + r.name + '  ' + r.detail));
  console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ results, errors }, null, 1));
  await browser.close();
  process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 2);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
