/* CSV 专项：编码识别、数字保真、引号解析、公式注入防护、导出格式 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME = require('./browser-path.cjs');

const APP = 'http://127.0.0.1:4173/';
const OUT = path.join(__dirname, '..', '.e2e-downloads', 'csv-test');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  →  ' + detail : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const utf8Path = path.join(OUT, 'utf8-bom.csv');
  const gbkPath = path.join(OUT, 'gbk.csv');
  const utf16Path = path.join(OUT, 'utf16.csv');
  const numPath = path.join(OUT, 'numbers.csv');
  const quotePath = path.join(OUT, 'quotes.csv');
  const formulaPath = path.join(OUT, 'formula.csv');

  fs.writeFileSync(utf8Path, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('姓名,数量\n张三,2\n', 'utf8'),
  ]));
  // GBK：姓名,数量 / 张三,2
  fs.writeFileSync(gbkPath, Buffer.from([
    0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xca, 0xfd, 0xc1, 0xbf, 0x0a,
    0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0x32, 0x0a,
  ]));
  fs.writeFileSync(utf16Path, Buffer.from('\uFEFF姓名,数量\n张三,2\n', 'utf16le'));
  fs.writeFileSync(numPath, '00123,123456789012345678,0.5,42\n', 'utf8');
  fs.writeFileSync(quotePath, '"a,b","line1\nline2","say ""hi"""\n', 'utf8');
  fs.writeFileSync(formulaPath, '=1+1,-5,@cmd,+7,normal\n', 'utf8');

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text()); });

  const reset = async () => {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
  };
  const open = async (file) => {
    await page.setInputFiles('#file-input', file);
    await page.waitForTimeout(2200);
  };
  const cell = (r, c) => page.evaluate(({ r, c }) => {
    const s = window.__excelTool.luckysheet.getLuckysheetfile()[0];
    const v = s.data && s.data[r] && s.data[r][c];
    return v && v.v !== undefined ? v.v : null;
  }, { r, c });
  const exportCsv = async (file) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
    await download.saveAs(file);
    return download.suggestedFilename();
  };

  await page.goto(APP, { waitUntil: 'networkidle' });
  await reset();

  await open(utf8Path);
  check('UTF-8 BOM 导入', (await cell(0, 0)) === '姓名' && (await cell(0, 1)) === '数量');

  await reset();
  await open(gbkPath);
  check('GBK 编码识别', (await cell(0, 0)) === '姓名' && (await cell(1, 0)) === '张三');

  await reset();
  await open(utf16Path);
  check('UTF-16LE BOM 识别', (await cell(0, 0)) === '姓名' && (await cell(1, 0)) === '张三');

  await reset();
  await open(numPath);
  const n = [await cell(0, 0), await cell(0, 1), await cell(0, 2), await cell(0, 3)];
  check('前导零保留为文本', n[0] === '00123', String(n[0]));
  check('超长数字保持精度', n[1] === '123456789012345678', String(n[1]));
  check('普通数字仍转数值', n[2] === 0.5 && n[3] === 42, JSON.stringify(n.slice(2)));

  await reset();
  await open(quotePath);
  check('引号内逗号', (await cell(0, 0)) === 'a,b');
  check('引号内换行', (await cell(0, 1)) === 'line1\nline2');
  check('双引号转义', (await cell(0, 2)) === 'say "hi"');

  await reset();
  await open(formulaPath);
  const formulaOut = path.join(OUT, 'formula-out.csv');
  const formulaName = await exportCsv(formulaOut);
  const formulaText = fs.readFileSync(formulaOut, 'utf8');
  check('CSV 导出文件名去掉重复后缀', formulaName === 'formula.csv', formulaName);
  check('CSV 导出带 BOM', formulaText.charCodeAt(0) === 0xfeff, 'U+' + formulaText.charCodeAt(0).toString(16));
  check('公式注入已转义',
    formulaText.includes("'=1+1,-5,'@cmd,'+7,normal"),
    JSON.stringify(formulaText.replace(/^\uFEFF/, '')));

  await reset();
  await open(quotePath);
  const quoteOut = path.join(OUT, 'quotes-out.csv');
  await exportCsv(quoteOut);
  const quoteText = fs.readFileSync(quoteOut, 'utf8');
  check('导出保留必要引号',
    quoteText.includes('"a,b"') && quoteText.includes('"say ""hi"""'),
    JSON.stringify(quoteText.replace(/^\uFEFF/, '')));

  const pass = results.filter((r) => r.ok).length;
  console.log('\n================ 汇总 ================');
  console.log(`通过 ${pass} / ${results.length}`);
  results.filter((r) => !r.ok).forEach((r) => console.log('  ✗ ' + r.name + '  ' + r.detail));
  console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ results, errors }, null, 1));
  await browser.close();
  process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 2);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
