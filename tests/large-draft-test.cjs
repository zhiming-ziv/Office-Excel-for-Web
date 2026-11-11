/* 大草稿迁移、事务失败、重试和刷新恢复。 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: require('./browser-path.cjs') });
  try {
    const page = await browser.newPage({ locale: 'zh-CN', colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const data = Array.from({ length: 1000 }, () => Array(40).fill(null));
      data[0][0] = { v: '旧草稿' };
      data[999][39] = { v: '末尾数据', bg: '#ff0000' };
      localStorage.setItem('excel-tool:autosave:v1', JSON.stringify({ name: '大草稿.xlsx', sheets: [
        { name: 'Sheet1', index: 0, status: 1, row: 1000, column: 40, data, config: {} },
      ] }));
      window.originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('模拟配额不足', 'QuotaExceededError'); };
    });
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__excelTool?.getAutosaveState().failed);
    assert.equal(await page.evaluate(() => localStorage.getItem('excel-tool:autosave:v1').includes('旧草稿')), true);
    assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), true);
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = window.originalPut;
      window.__excelTool.luckysheet.setCellValue(0, 1, '迁移后');
    });
    await page.waitForFunction(() => !window.__excelTool.getAutosaveState().pending && !window.__excelTool.getAutosaveState().writing);
    assert.equal(await page.evaluate(() => localStorage.getItem('excel-tool:autosave:v1')), null);
    const read = () => page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('excel-tool-drafts', 1);
      request.onerror = () => reject(request.error.message);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('drafts');
        const get = tx.objectStore('drafts').get('current');
        tx.oncomplete = () => { resolve(get.result); db.close(); };
      };
    }));
    const migrated = await read();
    assert.equal(migrated.sheets[0].data, undefined);
    assert.ok(migrated.sheets[0].celldata.length < 10);
    assert.ok(JSON.stringify(migrated).includes('末尾数据'));
    await page.evaluate(() => {
      window.originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = window.originalPut.apply(this, args);
        this.transaction.abort();
        return request;
      };
      window.__excelTool.luckysheet.setCellValue(0, 2, '事务失败内容');
    });
    await page.waitForFunction(() => window.__excelTool.getAutosaveState().failed);
    assert.deepEqual(await read(), migrated);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__excelTool?.luckysheet.flowdata()?.[0]?.[1]?.v === '迁移后');
    assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][2]?.v), undefined);
    assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[999][39].v), '末尾数据');
    await page.evaluate(() => window.__excelTool.luckysheet.setCellValue(0, 2, '重试成功'));
    await page.waitForFunction(() => !window.__excelTool.getAutosaveState().pending && !window.__excelTool.getAutosaveState().writing);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__excelTool?.luckysheet.flowdata()?.[0]?.[2]?.v === '重试成功');
    // 新建小工作簿后，旧的大草稿不得在下次启动时覆盖新内容。
    await page.click('#btn-new');
    await page.waitForFunction(() => window.__excelTool.luckysheet.flowdata()?.[0]?.[0]?.v == null);
    await page.evaluate(() => window.__excelTool.luckysheet.setCellValue(0, 0, '新的小草稿'));
    await page.waitForFunction(() => !window.__excelTool.getAutosaveState().pending && !window.__excelTool.getAutosaveState().writing);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__excelTool?.luckysheet.flowdata()?.[0]?.[0]?.v === '新的小草稿');
    assert.deepEqual(errors, []);
    console.log('PASS 大草稿迁移失败保留旧副本、事务回滚、重试、末尾数据和刷新恢复');
    console.log('ERRORS: none');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
