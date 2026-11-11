/* 文件往返验证：导入、编辑、下载、重新导入均检查实际属性。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { chromium } = require('playwright-core');
(async () => {
  const out = path.join(__dirname, '..', '.e2e-downloads', 'fidelity');
  fs.mkdirSync(out, { recursive: true });
  const fixture = new ExcelJS.Workbook();
  const ws = fixture.addWorksheet('属性往返');
  ws.getCell('A1').value = '批注';
  ws.getCell('A1').note = '第一行批注\n第二行 <原文> & 符号';
  for (const [address, rotation] of [['B1', 45], ['C1', -45], ['D1', 90], ['E1', -90], ['F1', 'vertical']]) {
    ws.getCell(address).value = address;
    ws.getCell(address).alignment = { textRotation: rotation };
  }
  ws.getCell('G8').note = '没有单元格值的批注';
  ws.getRow(3).hidden = true;
  ws.getRow(3).height = 18;
  ws.getColumn(3).hidden = true;
  ws.getColumn(3).width = 22;
  ws.autoFilter = 'A1:F8';
  ws.getCell('A2').dataValidation = { type: 'whole', operator: 'between', formulae: [1, 10] };
  const source = path.join(out, 'source.xlsx');
  await fixture.xlsx.writeFile(source);
  const browser = await chromium.launch({ executablePath: require('./browser-path.cjs') });
  try {
    const page = await browser.newPage({ colorScheme: 'light', acceptDownloads: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await page.setInputFiles('#file-input', source);
    await page.waitForFunction(() => window.__excelTool?.luckysheet.flowdata()?.[0]?.[0]?.ps?.value?.includes('第一行'));
    assert.match(await page.textContent('#compatibility-notice'), /筛选条件/);
    assert.match(await page.textContent('#compatibility-notice'), /数据验证/);
    const state = () => page.evaluate(() => {
      const l = window.__excelTool.luckysheet;
      return { note: l.flowdata()[0][0].ps.value, emptyNote: l.flowdata()[7][6].ps.value, config: l.getconfig() };
    });
    let current = await state();
    assert.equal(current.note, ws.getCell('A1').note);
    assert.equal(current.emptyNote, '没有单元格值的批注');
    assert.ok(Object.hasOwn(current.config.rowhidden, '2'));
    assert.ok(Object.hasOwn(current.config.colhidden, '2'));
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.click('#btn-theme');
      await page.evaluate(() => {
        const l = window.__excelTool.luckysheet;
        l.setCellValue(1, 0, { v: '编辑后', ps: { value: '新批注', isshow: false }, tr: 2 });
        l.setCellFormat(1, 0, 'tr', 2);
      });
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
      const file = path.join(out, theme + '.xlsx');
      await download.saveAs(file);
      const saved = new ExcelJS.Workbook();
      await saved.xlsx.readFile(file);
      const sheet = saved.worksheets[0];
      const noteText = (cell) => typeof cell.note === 'string' ? cell.note : cell.note?.texts.map((t) => t.text).join('');
      assert.equal(noteText(sheet.getCell('A1')), ws.getCell('A1').note);
      assert.equal(noteText(sheet.getCell('A2')), '新批注');
      assert.equal(noteText(sheet.getCell('G8')), '没有单元格值的批注');
      assert.equal(sheet.getCell('A2').alignment.textRotation, -45);
      for (const address of ['B1', 'C1', 'D1', 'E1', 'F1']) assert.equal(sheet.getCell(address).alignment.textRotation, ws.getCell(address).alignment.textRotation);
      assert.equal(sheet.getRow(3).hidden, true);
      assert.equal(sheet.getRow(3).height, 18);
      assert.equal(sheet.getColumn(3).hidden, true);
      assert.equal(sheet.getColumn(3).width, 22);
      assert.equal(sheet.getCell('A2').fill?.fgColor?.argb, undefined);
      await page.setInputFiles('#file-input', file);
      await page.waitForFunction((name) => window.__excelTool.getFileName() === name &&
        window.__excelTool.luckysheet.flowdata()?.[1]?.[0]?.ps?.value === '新批注', theme + '.xlsx');
      current = await state();
      assert.equal(current.emptyNote, '没有单元格值的批注');
    }
    assert.deepEqual(errors, []);
    console.log('PASS 批注、空值批注、五种旋转、隐藏行列、主题剥离与重新导入');
    console.log('ERRORS: none');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
