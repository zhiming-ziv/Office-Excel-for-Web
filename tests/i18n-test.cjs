/* 多语言端到端：界面、实际下载、切换保存保护、持久化与布局。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const ExcelJS = require('exceljs');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.e2e-downloads', 'i18n');
const APP = 'http://127.0.0.1:4173/';
const KEY = 'excel-tool:language';
const ready = (page) => page.waitForFunction(() => window.__excelTool && !document.querySelector('#language-select').disabled);
const saved = (page) => page.waitForFunction(() => {
  const state = window.__excelTool?.getAutosaveState();
  return state && !state.pending && !state.writing && !state.failed;
});
const switchTo = async (page, language) => {
  await page.selectOption('#language-select', language);
  await page.waitForFunction((target) => document.documentElement.lang === target &&
    window.__excelTool?.getLanguage() === target && !document.querySelector('#language-select').disabled, language);
};
const download = async (page, name) => {
  const [file] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
  const target = path.join(OUT, name + '.xlsx');
  await file.saveAs(target);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(target);
  return book;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: require('./browser-path.cjs') });
  const errors = [];
  const monitor = (page) => page.on('pageerror', (e) => errors.push(e.message));
  try {
    // 每种语言都实际打开、编辑、下载、刷新恢复，避免只验证按钮翻译。
    for (const [locale, language, open, undo, untitled] of [
      ['zh-CN', 'zh-CN', '打开', '撤销', '未命名.xlsx'],
      ['zh-TW', 'zh-TW', '開啟', '撤銷', '未命名.xlsx'],
      ['en-US', 'en', 'Open', 'Undo', 'Untitled.xlsx'],
    ]) {
      const page = await browser.newPage({ locale, colorScheme: 'light', acceptDownloads: true, viewport: { width: 1280, height: 800 } });
      monitor(page);
      page.on('dialog', (d) => d.accept());
      await page.goto(APP, { waitUntil: 'networkidle' });
      await ready(page);
      assert.equal(await page.getAttribute('html', 'lang'), language);
      assert.equal(await page.textContent('#btn-open'), open);
      assert.equal(await page.getAttribute('#luckysheet-icon-undo', 'data-tips'), undo);
      assert.equal(await page.textContent('#file-name'), untitled);
      await page.setInputFiles('#file-input', path.join(ROOT, 'sample.xlsx'));
      await page.waitForFunction(() => window.__excelTool.getFileName() === 'sample.xlsx' && window.__excelTool.luckysheet.getLuckysheetfile().length === 2);
      await ready(page);
      await page.evaluate(() => {
        const l = window.__excelTool.luckysheet;
        l.setCellValue(9, 0, '多语言保真');
        l.setCellValue(9, 1, 0.25);
        l.setCellFormat(9, 1, 'ct', { fa: '0.00%', t: 'n' });
      });
      const book = await download(page, language);
      assert.equal(book.worksheets[0].getCell('A10').value, '多语言保真');
      assert.equal(book.worksheets[0].getCell('B10').value, 0.25);
      assert.equal(book.worksheets[0].getCell('B10').numFmt, '0.00%');
      assert.equal(book.worksheets[0].getCell('D2').value.formula, 'B2*C2');
      assert.equal(book.worksheets[1].name, '人员');
      await saved(page);
      await page.reload({ waitUntil: 'networkidle' });
      await ready(page);
      assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[9][0].v), '多语言保真');
      for (const width of [1280, 760, 480]) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(200);
        const layout = await page.evaluate(() => {
          const nodes = [...document.querySelectorAll('#topbar .actions > *')].filter((e) => !e.hidden);
          const rects = nodes.map((e) => e.getBoundingClientRect());
          return { inside: rects.every((r) => r.left >= 0 && r.right <= innerWidth + 1),
            overlap: rects.some((r, i) => rects.slice(i + 1).some((b) => r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom)) };
        });
        assert.equal(layout.inside, true, language + ' ' + width + ' 按钮应在窗口内');
        assert.equal(layout.overlap, false, language + ' ' + width + ' 按钮不应重叠');
        await page.screenshot({ path: path.join(OUT, `${language}-${width}-light.png`) });
      }
      await page.click('#btn-theme');
      await page.screenshot({ path: path.join(OUT, `${language}-480-dark.png`) });
      await page.close();
      console.log('PASS ' + language + ' 界面、引擎、导出、恢复与窄屏布局');
    }

    // 切换失败和取消：不能刷新，不能改语言，仍能编辑。
    const page = await browser.newPage({ locale: 'zh-CN', colorScheme: 'light' });
    monitor(page);
    let accept = true;
    page.on('dialog', (d) => accept ? d.accept() : d.dismiss());
    await page.goto(APP, { waitUntil: 'networkidle' });
    await ready(page);
    await page.evaluate(() => window.__excelTool.luckysheet.setCellValue(0, 0, '切换前尚未保存'));
    accept = false;
    await page.selectOption('#language-select', 'en');
    assert.equal(await page.inputValue('#language-select'), 'zh-CN');
    accept = true;
    for (const key of ['excel-tool:autosave:v1', KEY]) {
      await page.evaluate((key) => {
        window.originalSetItem ||= Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key) throw new DOMException('模拟保存失败', 'QuotaExceededError');
          return window.originalSetItem.call(this, name, value);
        };
      }, key);
      const origin = await page.evaluate(() => performance.timeOrigin);
      await page.selectOption('#language-select', 'en');
      await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('语言切换未完成'));
      assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
      assert.equal(await page.evaluate(() => localStorage.getItem('excel-tool:language')), null);
      assert.equal(await page.evaluate(() => document.querySelector('#app').inert), false);
      assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][0].v), '切换前尚未保存');
      await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    }
    await switchTo(page, 'en');
    assert.equal(await page.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][0].v), '切换前尚未保存');
    assert.equal(await page.textContent('#file-name'), '未命名.xlsx');
    await switchTo(page, 'zh-TW');
    await switchTo(page, 'zh-CN');
    assert.equal(await page.evaluate(() => localStorage.getItem('excel-tool:language')), 'zh-CN');
    // 人为延长文件读取，验证导入完成前不允许切换语言。
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        const buffer = await original.call(this);
        return new Promise((resolve) => { window.releaseImport = () => resolve(buffer); });
      };
    });
    await page.setInputFiles('#file-input', { name: '延迟导入.csv', mimeType: 'text/csv', buffer: Buffer.from('名称,金额\n测试,25', 'utf8') });
    await page.waitForFunction(() => typeof window.releaseImport === 'function');
    assert.equal(await page.isDisabled('#language-select'), true);
    await page.evaluate(() => {
      const select = document.querySelector('#language-select');
      select.value = 'en';
      select.dispatchEvent(new Event('change'));
    });
    assert.equal(await page.getAttribute('html', 'lang'), 'zh-CN');
    await page.evaluate(() => window.releaseImport());
    await page.waitForFunction(() => window.__excelTool.getFileName() === '延迟导入.xlsx' && !document.querySelector('#language-select').disabled);
    await page.close();
    console.log('PASS 切换取消、草稿失败、设置失败、成功重试与语言持久化');

    // 大草稿与历史中文警告：等待实际事务完成后才允许刷新。
    const large = await browser.newPage({ locale: 'en-US', colorScheme: 'dark' });
    monitor(large);
    large.on('dialog', (d) => d.accept());
    await large.addInitScript(() => {
      if (sessionStorage.getItem('i18n-seeded')) return;
      sessionStorage.setItem('i18n-seeded', '1');
      localStorage.setItem('excel-tool:language', 'zh-CN');
      localStorage.setItem('excel-tool:autosave:v1', JSON.stringify({ name: '原始文件名.xlsx', warnings: ['宏', '图片', '数据验证'],
        sheets: [{ name: '保留工作表名', index: 0, status: 1, row: 1000, column: 40, config: {},
          celldata: [{ r: 999, c: 39, v: { v: '末尾数据' } }] }] }));
    });
    await large.goto(APP, { waitUntil: 'networkidle' });
    await ready(large);
    await saved(large);
    await large.evaluate(() => {
      window.originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('模拟事务失败', 'QuotaExceededError'); };
      window.__excelTool.luckysheet.setCellValue(0, 0, '最新编辑');
    });
    await large.selectOption('#language-select', 'en');
    await large.waitForFunction(() => document.querySelector('#toast').textContent.includes('语言切换未完成'));
    assert.equal(await large.getAttribute('html', 'lang'), 'zh-CN');
    await large.evaluate(() => {
      IDBObjectStore.prototype.put = window.originalPut;
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = original.apply(this, args);
        if (args[1] === 'readwrite') tx.addEventListener('complete', (event) => {
          event.stopImmediatePropagation();
          setTimeout(() => tx.oncomplete?.(event), 500);
        });
        return tx;
      };
    });
    const origin = await large.evaluate(() => performance.timeOrigin);
    await large.selectOption('#language-select', 'en');
    await large.waitForTimeout(100);
    assert.equal(await large.evaluate(() => performance.timeOrigin), origin);
    await large.waitForFunction(() => window.__excelTool?.getLanguage() === 'en' && !document.querySelector('#language-select').disabled);
    assert.equal(await large.textContent('#file-name'), '原始文件名.xlsx');
    assert.equal(await large.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][0].v), '最新编辑');
    assert.equal(await large.evaluate(() => window.__excelTool.luckysheet.flowdata()[999][39].v), '末尾数据');
    const notice = await large.textContent('#compatibility-notice');
    assert.match(notice, /macros/);
    assert.match(notice, /images/);
    assert.match(notice, /data validation/);
    assert.doesNotMatch(notice, /宏|图片|数据验证/);
    await saved(large);
    const warnings = await large.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('excel-tool-drafts', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('drafts');
        const get = tx.objectStore('drafts').get('current');
        tx.oncomplete = () => { resolve(get.result.warnings); db.close(); };
      };
    }));
    assert.deepEqual(warnings, ['macros', 'images', 'validation']);
    // 较早的草稿还在提交时再次编辑并切换，必须保存后一版内容。
    await large.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = original.apply(this, args);
        if (args[1] === 'readwrite') tx.addEventListener('complete', (event) => {
          event.stopImmediatePropagation();
          setTimeout(() => tx.oncomplete?.(event), 500);
        });
        return tx;
      };
      window.__excelTool.luckysheet.setCellValue(0, 1, '较早版本');
    });
    await large.waitForFunction(() => window.__excelTool.getAutosaveState().writing);
    await large.evaluate(() => window.__excelTool.luckysheet.setCellValue(0, 2, '事务期间的新编辑'));
    await switchTo(large, 'zh-TW');
    assert.equal(await large.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][1].v), '较早版本');
    assert.equal(await large.evaluate(() => window.__excelTool.luckysheet.flowdata()[0][2].v), '事务期间的新编辑');
    await large.close();
    console.log('PASS IndexedDB 失败保护、等待事务提交、旧警告迁移与数据保留');
    assert.deepEqual(errors, []);
    console.log('ERRORS: none');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
