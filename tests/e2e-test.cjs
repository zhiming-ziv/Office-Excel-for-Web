/* 端到端冒烟测试：打开带样式/公式/合并单元格的 xlsx -> 真实键盘编辑 -> 保存 -> python 解包校验 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');

const CHROME = require('./browser-path.cjs');
const APP = 'http://127.0.0.1:4173/';
const SAMPLE = path.resolve(__dirname, '../sample.xlsx');
const DOWNLOAD_DIR = path.join(__dirname, '..', '.e2e-downloads');

async function zipCheck(file) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const read = async (p) => (await zip.file(p).async('string'));
  const styles = await read('xl/styles.xml');
  const wbxml = await read('xl/workbook.xml');
  const sheet1 = await read('xl/worksheets/sheet1.xml');
  const shared = await read('xl/sharedStrings.xml').catch(() => '');
  const fonts = styles.match(/<fonts[\s\S]*?<\/fonts>/)[0];
  const fills = styles.match(/<fills[\s\S]*?<\/fills>/)[0];
  const names = [...wbxml.matchAll(/<sheet [^>]*?name="([^"]+)"/g)].map((m) => m[1]);
  const states = [...wbxml.matchAll(/<sheet [^>]*?(?:name="([^"]+)")?[^>]*?(state="([a-z]+)")?/g)];
  const cellRe = /<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
  const cells = {};
  for (const m of sheet1.matchAll(cellRe)) {
    const attrs = m[2];
    const inner = m[3];
    const t = (attrs.match(/t="([a-z]+)"/) || [])[1] || '';
    const f = (inner.match(/<f>([^<]*)<\/f>/) || [])[1] || '';
    const v = (inner.match(/<v>([^<]*)<\/v>/) || [])[1] || '';
    cells[m[1]] = [m[1], t, f, v];
  }
  const merges = [...sheet1.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((m) => m[1]);
  const sst = [...shared.matchAll(/<si><t[^>]*>([^<]*)<\/t><\/si>/g)].map((m) => m[1]);
  const cellText = (addr) => {
    const c = cells[addr];
    if (!c) return null;
    if (c[1] === 's' && /^\d+$/.test(c[3])) return sst[Number(c[3])];
    return c[3];
  };
  return [
    'SHEETS: ' + JSON.stringify(names),
    'BOLD_FONT: ' + (fonts.includes('<b/>') || fonts.includes('<b val="1"/>')),
    'GREEN_FILL: ' + fills.includes('217346'),
    'WHITE_FONT: ' + fonts.includes('FFFFFF'),
    'MERGES: ' + JSON.stringify(merges),
    'D2_FORMULA: ' + (cells['D2'] ? cells['D2'][2] : null),
    'E3_FORMULA: ' + (cells['E3'] ? cells['E3'][2] : null),
    'A5_TEXT: ' + cellText('A5'),
    'COLWIDTH: ' + sheet1.includes('customWidth'),
    'A3_TEXT: ' + cellText('A3'),
  ].join('\n');
}

(async () => {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const savedPath = path.join(DOWNLOAD_DIR, 'saved.xlsx');
  fs.rmSync(savedPath, { force: true });

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text());
  });

  // 1. 打开应用
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(DOWNLOAD_DIR, '.e2e-01-blank.png') });
  console.log('STEP1 空白工作簿渲染:', (await page.evaluate(() => !!document.querySelector('.luckysheet'))) ? 'OK' : 'FAIL');

  // 2. 打开示例 xlsx
  await page.setInputFiles('#file-input', SAMPLE);
  await page.waitForTimeout(3500);
  const afterOpen = await page.evaluate(() => {
    const ls = window.__excelTool.luckysheet;
    const file = ls.getLuckysheetfile();
    const s0 = file[0];
    const cell = (r, c) => (s0.data && s0.data[r] && s0.data[r][c]) || null;
    return {
      fileName: document.querySelector('#file-name').textContent,
      sheets: file.map((s) => s.name),
      b1: cell(0, 1) && { v: cell(0, 1).v, bl: cell(0, 1).bl, fc: cell(0, 1).fc },
      d2f: cell(1, 3) && cell(1, 3).f,
      mergeA5: cell(4, 0) && cell(4, 0).mc,
    };
  });
  console.log('STEP2 打开文件（含样式字段）:', JSON.stringify(afterOpen));
  assert.deepEqual(afterOpen.sheets, ['销售表', '人员']);
  assert.equal(afterOpen.b1.bl, 1);
  assert.equal(afterOpen.d2f, '=B2*C2');
  assert.equal(afterOpen.mergeA5.cs, 2);
  await page.screenshot({ path: path.join(DOWNLOAD_DIR, '.e2e-02-opened.png') });

  // 3. 模拟真实用户编辑：动态定位到第 3 行（索引2）A 列，输入 999
  let target = null;
  for (let x = 170; x <= 800 && !target; x += 40) {
    await page.mouse.click(x, 220);
    await page.waitForTimeout(200);
    const sel = await page.evaluate(() => {
      const s = window.__excelTool.luckysheet.getluckysheet_select_save();
      return s && s.length ? { r: s[0].row_focus, c: s[0].column_focus } : null;
    });
    if (sel && sel.r === 2 && sel.c === 0) target = x;
  }
  console.log('STEP3a 定位第3行A列:', target ? 'OK(x=' + target + ')' : 'FAIL');
  assert.ok(target, '必须成功定位待编辑单元格');
  if (target) {
    await page.mouse.dblclick(target, 220);
    await page.waitForTimeout(400);
    await page.keyboard.type('999');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    const edited = await page.evaluate(() => {
      const s0 = window.__excelTool.luckysheet.getLuckysheetfile()[0];
      return { a3: s0.data[2][0] && s0.data[2][0].v, d3: s0.data[2][3] && s0.data[2][3].v };
    });
    console.log('STEP3b 键盘编辑后:', JSON.stringify(edited));
  }

  // 4. 保存为 xlsx
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#btn-save'),
  ]);
  await download.saveAs(savedPath);
  console.log('STEP4 下载:', download.suggestedFilename());

  // 5. 校验下载的 xlsx 内容
  const savedCheck = await zipCheck(savedPath);
  console.log('STEP5 保存文件校验:\n' + savedCheck);
  for (const expected of ['BOLD_FONT: true', 'GREEN_FILL: true', 'WHITE_FONT: true',
    'D2_FORMULA: B2*C2', 'E3_FORMULA: SUM(D2:D3)', 'COLWIDTH: true', 'A3_TEXT: 钢笔999']) {
    assert.ok(savedCheck.includes(expected), '导出校验失败：' + expected);
  }

  // 6. 自动保存草稿 + 状态栏
  const draft = await page.evaluate(() => localStorage.getItem('excel-tool:autosave:v1'));
  assert.ok(draft, '草稿必须存在');
  console.log('STEP6 草稿:', draft ? 'OK(' + draft.length + ' chars)' : 'MISSING',
    '| 状态栏:', await page.evaluate(() => document.querySelector('#status-text').textContent));

  // 7. 刷新页面验证草稿恢复
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const restored = await page.evaluate(() => {
    const ls = window.__excelTool.luckysheet;
    const s0 = ls.getLuckysheetfile()[0];
    return { name: s0.name, c3: s0.data && s0.data[2] && s0.data[2][2] ? s0.data[2][2].v : null,
             d2: s0.data && s0.data[2] && s0.data[2][3] ? s0.data[2][3].v : null };
  });
  console.log('STEP7 刷新后草稿恢复:', JSON.stringify(restored));
  assert.equal(restored.name, '销售表');
  assert.equal(restored.c3, 25);
  assert.equal(restored.d2, 200);

  await page.screenshot({ path: path.join(DOWNLOAD_DIR, '.e2e-03-final.png') });
  console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none');
  await browser.close();
  assert.deepEqual(errors, [], '浏览器运行错误');
})().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
