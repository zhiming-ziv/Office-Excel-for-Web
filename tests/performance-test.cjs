/* 可重复的大表格基准：先运行 --before，再在构建新版本后运行。 */
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: require('./browser-path.cjs') });
  const results = [];
  try {
    for (const dense of [false, true]) {
      const page = await browser.newPage({ locale: 'zh-CN', colorScheme: 'light', viewport: { width: 1400, height: 800 } });
      await page.goto('http://127.0.0.1:4173/');
      await page.waitForFunction(() => window.__excelTool);
      await page.addInitScript((dense) => {
        if (sessionStorage.getItem('performance-seeded')) return;
        sessionStorage.setItem('performance-seeded', '1');
        const rows = dense ? 500 : 2000, cols = 100;
        const data = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) =>
          dense || (r % 100 === 0 && c === 0) ? { v: r * cols + c } : null));
        localStorage.setItem('excel-tool:theme', 'light');
        localStorage.setItem('excel-tool:autosave:v1', JSON.stringify({ name: '性能.xlsx', savedAt: Date.now() + 1000,
          sheets: [{ name: '性能', index: 0, status: 1, row: rows, column: cols, data, config: {} }] }));
      }, dense);
      const start = Date.now();
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__excelTool?.luckysheet.flowdata()?.length >= 500);
      const openMs = Date.now() - start;
      const measure = await page.evaluate(async () => {
        const l = window.__excelTool.luckysheet;
        const start = performance.now();
        document.querySelector('#btn-theme').click();
        const themeMs = performance.now() - start;
        const objects = l.flowdata().reduce((n, row) => n + row.filter(Boolean).length, 0);
        const editStart = performance.now();
        l.setCellValue(1, 1, '性能校验');
        const editMs = performance.now() - editStart;
        let maxDelay = 0, last = performance.now();
        const timer = setInterval(() => { const now = performance.now(); maxDelay = Math.max(maxDelay, now - last - 20); last = now; }, 20);
        await new Promise((resolve) => setTimeout(resolve, 2500));
        clearInterval(timer);
        return { themeMs, editMs, objects, maxEventLoopDelayMs: maxDelay,
          heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
          autosave: window.__excelTool.getAutosaveState?.() };
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__excelTool?.luckysheet.flowdata()?.[1]?.[1]?.v === '性能校验');
      assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[1][1].v), '性能校验');
      results.push({ type: dense ? '密集 500×100' : '稀疏 2000×100', openMs, ...measure });
      await page.close();
    }
    const out = path.join(__dirname, '..', '.e2e-downloads');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, process.argv.includes('--before') ? 'performance-before.json' : 'performance-after.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
