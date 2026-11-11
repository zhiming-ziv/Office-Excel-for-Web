/* 主题切换专项验证：浅色/深色截图 + 数据注入/剥离正确性 + 持久化 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('未找到 Chrome，请设置环境变量 CHROME_PATH 指向 chrome.exe');
const APP = 'http://127.0.0.1:4173/';
const SAMPLE = path.resolve(__dirname, '../sample.xlsx');
const OUT = path.join(__dirname, '..', '.e2e-downloads');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const savedPath = path.join(OUT, 'dark-saved.xlsx');
  fs.rmSync(savedPath, { force: true });

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    colorScheme: 'light', // 默认浅色，与未表态用户一致
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });

  // 1. 默认浅色
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const t0 = await page.evaluate(() => ({
    theme: window.__excelTool.getTheme(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    btnTitle: document.querySelector('#btn-theme').title,
    sunDisplay: getComputedStyle(document.querySelector('.icon-sun')).display,
    moonDisplay: getComputedStyle(document.querySelector('.icon-moon')).display,
    ls: localStorage.getItem('excel-tool:theme'),
  }));
  console.log('STEP1 初始浅色:', JSON.stringify(t0));
  assert.equal(t0.theme, 'light');
  await page.screenshot({ path: path.join(OUT, 'theme-light.png') });

  // 2. 切换到深色
  await page.click('#btn-theme');
  await page.waitForTimeout(900);
  const t1 = await page.evaluate(() => {
    const ls = window.__excelTool.luckysheet;
    const cell = ls.flowdata()[0][0];
    return {
      theme: window.__excelTool.getTheme(),
      htmlAttr: document.documentElement.getAttribute('data-theme'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      btnTitle: document.querySelector('#btn-theme').title,
      sunDisplay: getComputedStyle(document.querySelector('.icon-sun')).display,
      moonDisplay: getComputedStyle(document.querySelector('.icon-moon')).display,
      ls: localStorage.getItem('excel-tool:theme'),
      cellBg: cell && cell.bg,
      cellFc: cell && cell.fc,
    };
  });
  console.log('STEP2 切换深色:', JSON.stringify(t1));
  assert.equal(t1.theme, 'dark');
  assert.equal(t1.cellBg, 'rgba(30, 31, 36, 1)');
  assert.equal(t1.cellFc, 'rgba(215, 218, 224, 1)');
  await page.screenshot({ path: path.join(OUT, 'theme-dark-blank.png') });

  // 3. 深色下打开样例：显式样式必须保留，无样式单元格才是注入色
  await page.setInputFiles('#file-input', SAMPLE);
  await page.waitForTimeout(3000);
  const t2 = await page.evaluate(() => {
    const ls = window.__excelTool.luckysheet;
    const s0 = ls.getLuckysheetfile()[0];
    const cell = (r, c) => (s0.data && s0.data[r] && s0.data[r][c]) || null;
    return {
      sheets: ls.getLuckysheetfile().map((s) => s.name),
      b1: cell(0, 1) && { v: cell(0, 1).v, bl: cell(0, 1).bl, fc: cell(0, 1).fc, bg: cell(0, 1).bg },
      b2: cell(1, 1) && { v: cell(1, 1).v, bg: cell(1, 1).bg, fc: cell(1, 1).fc },
      d2f: cell(1, 3) && cell(1, 3).f,
      mergeA5: !!(cell(4, 0) && cell(4, 0).mc),
    };
  });
  console.log('STEP3 深色打开样例（样式保留/注入）:', JSON.stringify(t2));
  assert.equal(t2.b1.bg, '#217346');
  assert.equal(t2.b1.fc, '#FFFFFF');
  assert.equal(t2.b2.bg, 'rgba(30, 31, 36, 1)');
  await page.screenshot({ path: path.join(OUT, 'theme-dark-sample.png') });

  // 4. 深色下编辑并保存，校验产物无注入色
  let target = null;
  for (let x = 170; x <= 800 && !target; x += 40) {
    await page.mouse.click(x, 220);
    await page.waitForTimeout(150);
    const sel = await page.evaluate(() => {
      const s = window.__excelTool.luckysheet.getluckysheet_select_save();
      return s && s.length ? { r: s[0].row_focus, c: s[0].column_focus } : null;
    });
    if (sel && sel.r === 2 && sel.c === 0) target = x;
  }
  assert.ok(target, '必须成功定位待编辑单元格');
  if (target) {
    await page.mouse.dblclick(target, 220);
    await page.waitForTimeout(300);
    await page.keyboard.type('darkedit9');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
  }
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#btn-save'),
  ]);
  await download.saveAs(savedPath);

  // 等草稿落库后检查草稿是否被注入色污染
  await page.waitForTimeout(1600);
  const draft = await page.evaluate(() => localStorage.getItem('excel-tool:autosave:v1') || '');
  assert.ok(draft);
  assert.ok(!draft.includes('__theme') && !draft.includes('rgba(30, 31, 36, 1)'), '草稿不得包含主题注入');
  console.log('STEP4 草稿 pollution:', draft.includes('1e1f24') ? 'FAIL(含注入色)' : 'OK(无注入色)',
    '| 保存文件:', download.suggestedFilename());

  // 5. 解包校验保存产物
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(savedPath));
  const styles = await zip.file('xl/styles.xml').async('string');
  const sheet1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const shared = await zip.file('xl/sharedStrings.xml').async('string');
  const fonts = styles.match(/<fonts[\s\S]*?<\/fonts>/)[0];
  const fills = styles.match(/<fills[\s\S]*?<\/fills>/)[0];
  assert.ok(!styles.includes('1E1F24'), '导出不得包含主题注入色');
  assert.ok(fills.includes('217346'), '必须保留用户背景色');
  assert.ok(shared.includes('darkedit9'), '必须保存编辑内容');
  assert.ok(sheet1.includes('B2*C2'), '必须保存公式');
  console.log('STEP5 保存产物校验:',
    'INJECTED_COLOR=' + (styles.includes('1E1F24') ? 'FAIL(存在)' : 'OK(无)'),
    'BOLD=' + (fonts.includes('<b/>') || fonts.includes('<b val="1"/>')),
    'GREEN_FILL=' + fills.includes('217346'),
    'EDIT_TEXT=' + (shared.includes('darkedit9') ? 'OK(已写入)' : 'FAIL(未找到)'),
    'D2_FORMULA=' + sheet1.includes('B2*C2'));

  // 6. 刷新：主题持久化（含防闪屏属性）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const t3 = await page.evaluate(() => ({
    theme: window.__excelTool.getTheme(),
    cellBg: window.__excelTool.luckysheet.flowdata() && window.__excelTool.luckysheet.flowdata()[0] && window.__excelTool.luckysheet.flowdata()[0][0],
  }));
  console.log('STEP6 刷新后主题持久化:', t3.theme, '| A1注入bg:', t3.cellBg && t3.cellBg.bg);
  await page.screenshot({ path: path.join(OUT, 'theme-dark-restored.png') });

  // 7. 切回浅色：注入应被剥离，数据回到无样式
  await page.click('#btn-theme');
  await page.waitForTimeout(900);
  const t4 = await page.evaluate(() => {
    const cell = window.__excelTool.luckysheet.flowdata()[0][0];
    return { theme: window.__excelTool.getTheme(), cellBg: cell && cell.bg, cellFc: cell && cell.fc };
  });
  console.log('STEP7 切回浅色:', JSON.stringify(t4));
  assert.equal(t3.theme, 'dark');
  assert.equal(t4.theme, 'light');
  assert.equal(t4.cellBg, '#217346');
  await page.screenshot({ path: path.join(OUT, 'theme-light-2.png') });

  console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none');
  await browser.close();
  assert.deepEqual(errors, [], '浏览器运行错误');
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
