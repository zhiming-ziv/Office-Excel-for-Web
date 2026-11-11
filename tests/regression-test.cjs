/* 数据完整性回归：多表、数字格式、用户颜色、边框、刷新与不支持的格式。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.e2e-downloads', 'regression');
const CHROME = require('./browser-path.cjs');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage({ locale: 'zh-CN', acceptDownloads: true, colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text());
    });
    const save = async (name) => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
      const file = path.join(OUT, name + '.xlsx');
      await download.saveAs(file);
      const book = new ExcelJS.Workbook();
      await book.xlsx.readFile(file);
      return book;
    };
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await page.setInputFiles('#file-input', path.join(ROOT, 'sample.xlsx'));
    await page.waitForFunction(() => window.__excelTool.luckysheet.getLuckysheetfile().length === 2);
    await page.waitForTimeout(800);
    const original = await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][0].v);
    await page.evaluate(() => window.__excelTool.luckysheet.setSheetActive(1));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__excelTool.luckysheet.setCellValue(2, 0, '第二表独有内容'));
    await page.waitForTimeout(1200);
    assert.match(await page.textContent('#status-text'), /人员/);
    let book = await save('多工作表');
    assert.equal(book.worksheets[0].getCell('A1').value, original);
    assert.equal(book.worksheets[1].getCell('A3').value, '第二表独有内容');
    const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
    assert.equal(csv.suggestedFilename(), '人员.csv');
    await csv.saveAs(path.join(OUT, '人员.csv'));
    assert.match(fs.readFileSync(path.join(OUT, '人员.csv'), 'utf8'), /第二表独有内容/);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    assert.match(await page.textContent('#status-text'), /人员/);
    book = await save('恢复多工作表');
    assert.equal(book.worksheets[0].getCell('A1').value, original);
    assert.equal(book.worksheets[1].getCell('A3').value, '第二表独有内容');
    console.log('PASS 多工作表保存、草稿恢复、状态栏与 CSV');

    await page.evaluate(() => {
      const l = window.__excelTool.luckysheet;
      l.setCellValue(8, 0, { v: 0.25, ct: { fa: '0.00%', t: 'n' }, bg: '#1e1f24', fc: '#d7dae0' });
      l.setCellFormat(8, 0, 'bg', '#1e1f24');
      l.setCellFormat(8, 0, 'fc', '#d7dae0');
      l.setCellValue(8, 1, { v: 45292, ct: { fa: 'yyyy-mm-dd', t: 'd' } });
      l.setCellValue(8, 2, { v: 12.5, ct: { fa: '¥#,##0.00', t: 'n' } });
      l.setCellFormat(10, 0, 'bd', { borderType: 'border-all', style: '1', color: '#ff0000',
        range: [{ row: [10, 11], column: [0, 1] }] });
      l.setCellFormat(10, 0, 'bd', { borderType: 'border-none',
        range: [{ row: [10, 10], column: [0, 0] }] });
      const cfg = l.getconfig();
      cfg.borderInfo.push({ rangeType: 'cell', value: { row_index: 12, col_index: 0,
        b: { style: 12, color: '#00ff00' } } });
    });
    book = await save('样式浅色');
    const ws = book.worksheets[1];
    assert.equal(ws.getCell('A9').numFmt, '0.00%');
    assert.equal(ws.getCell('B9').numFmt, 'yyyy-mm-dd');
    assert.equal(ws.getCell('C9').numFmt, '¥#,##0.00');
    assert.equal(ws.getCell('A9').fill.fgColor.argb, 'FF1E1F24');
    assert.equal(ws.getCell('A9').font.color.argb, 'FFD7DAE0');
    assert.equal(ws.getCell('A11').border?.left, undefined);
    assert.equal(ws.getCell('B11').border?.left, undefined);
    assert.equal(ws.getCell('B12').border.right.style, 'thin');
    assert.equal(ws.getCell('B12').border.right.color.argb, 'FFFF0000');
    assert.equal(ws.getCell('A13').border.bottom.style, 'double');
    console.log('PASS 百分比、日期、货币与边框叠加清除');

    await page.click('#btn-theme');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const l = window.__excelTool.luckysheet;
      l.setCellValue(14, 0, '深色显式颜色');
      l.setCellFormat(14, 0, 'bg', '#1e1f24');
      l.setCellFormat(14, 0, 'fc', '#d7dae0');
      l.setCellValue(15, 0, '无显式颜色');
    });
    book = await save('样式深色');
    for (const address of ['A9', 'A15']) {
      assert.equal(book.worksheets[1].getCell(address).fill.fgColor.argb, 'FF1E1F24');
      assert.equal(book.worksheets[1].getCell(address).font.color.argb, 'FFD7DAE0');
    }
    assert.notEqual(book.worksheets[1].getCell('A16').fill?.fgColor?.argb, 'FF1E1F24');
    await page.click('#btn-theme');
    book = await save('切回浅色');
    assert.equal(book.worksheets[1].getCell('A15').fill.fgColor.argb, 'FF1E1F24');
    console.log('PASS 用户同色样式保留、主题注入色剥离');

    await page.evaluate(() => {
      window.__excelTool.luckysheet.setCellValue(0, 0, '立即刷新内容');
      location.reload();
    });
    await page.waitForTimeout(1700);
    assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][0].v), '立即刷新内容');
    assert.equal(await page.evaluate(() => localStorage.getItem('excel-tool:autosave:v1').includes('__theme')), false);
    console.log('PASS 编辑后立即刷新恢复最新内容');

    let confirmations = 0;
    page.on('dialog', async (d) => { confirmations++; await d.dismiss(); });
    await page.setInputFiles('#file-input', { name: '旧文件.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) });
    await page.waitForTimeout(200);
    assert.match(await page.textContent('#toast'), /不支持旧版.*xls/);
    assert.equal(confirmations, 0);
    assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][0].v), '立即刷新内容');
    assert.deepEqual(errors, []);
    console.log('PASS 拒绝旧版 xls 且保留当前工作簿');
    console.log('ERRORS: none');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('ERRORS:', e); process.exitCode = 1; });
