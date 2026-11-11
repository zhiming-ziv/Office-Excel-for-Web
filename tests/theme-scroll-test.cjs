/* 深色稀疏网格：滚动、回收空白主题对象、缩放与显式颜色。 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: require('./browser-path.cjs') });
  try {
    const page = await browser.newPage({ locale: 'zh-CN', colorScheme: 'dark', viewport: { width: 1400, height: 800 } });
    await page.addInitScript(() => {
      localStorage.setItem('excel-tool:autosave:v1', JSON.stringify({ name: '滚动.xlsx', sheets: [{
        name: '滚动', index: 0, status: 1, row: 2000, column: 100, defaultRowHeight: 19, defaultColWidth: 73,
        config: { rowlen: { 2: 40 }, columnlen: { 2: 120 }, rowhidden: { 3: 0 }, colhidden: { 3: 0 } },
        celldata: [{ r: 0, c: 0, v: { v: '保留', bg: '#ff0000' } }],
      }] }));
    });
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__excelTool?.luckysheet.flowdata()?.[1]?.[1]?.__themeBg);
    const scrollTo = async (top, left) => {
      await page.evaluate(([top, left]) => {
        const y = document.querySelector('#luckysheet-scrollbar-y');
        const x = document.querySelector('#luckysheet-scrollbar-x');
        y.scrollTop = top;
        x.scrollLeft = left;
      }, [top, left]);
      await page.waitForTimeout(500);
    };
    await scrollTo(10000, 2000);
    const state = await page.evaluate(() => {
      const grid = window.__excelTool.luckysheet.flowdata();
      return { first: grid[0][0], oldBlank: grid[1][1], visibleBlank: grid[502][30],
        count: grid.reduce((n, row) => n + row.filter(Boolean).length, 0),
        top: document.querySelector('#luckysheet-cell-main').scrollTop };
    });
    assert.ok(state.top >= 9900, '测试必须真实滚动到远处');
    assert.equal(state.first.bg, '#ff0000');
    assert.equal(state.oldBlank, null);
    assert.equal(state.visibleBlank?.__themeBg, true);
    assert.ok(state.count < 5000, '空白主题对象数量应有界');
    await scrollTo(0, 0);
    await page.waitForFunction(() => window.__excelTool.luckysheet.flowdata()[1][1]?.__themeBg);
    assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[502][30]), null);
    await page.click('#btn-theme');
    assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][0].bg), '#ff0000');
    console.log('PASS 深色远距离滚动补绘、空白对象回收、用户颜色保留');
    console.log('ERRORS: none');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
