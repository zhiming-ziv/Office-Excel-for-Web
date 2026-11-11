/* ============================================================
 * 工具栏功能区逐项验证（深色主题）
 *  - 每一项都真实点击工具栏控件（真实鼠标事件），断言产生了预期效果
 *  - 数值/文本通过真实键盘输入写入
 *  - 每个用例使用独立的行区块，互不干扰
 * 用法：node toolbar-test.cjs [--shots]
 * ============================================================ */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME = require('./browser-path.cjs');
const APP = 'http://127.0.0.1:4173/';
const OUT = path.join(__dirname, '..', '.e2e-downloads', 'toolbar');
const SHOT = process.argv.includes('--shots');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  →  ' + detail : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.click('#btn-theme');
  await page.waitForTimeout(900);
  check('主题已切换为深色', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');

  const COL_W = 75, ROW_H = 20, ROW_OFF = 5;
  const org = await page.evaluate(() => {
    const r = document.querySelector('#luckysheet-cell-flow_0').getBoundingClientRect();
    return { x: r.left, y: r.top };
  });

  async function gridOrigin() {
    return page.evaluate(() => {
      const el = document.querySelector('#luckysheet-cell-flow_0');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
  }
  async function focusCell() {
    return page.evaluate(() => {
      const s = window.__excelTool.luckysheet.getluckysheet_select_save();
      return s && s[0] ? { r: s[0].row_focus, c: s[0].column_focus } : null;
    });
  }
  /* 带自校正的单元格点击：冻结/取消冻结会改变数据区原点，
     读回实际落点后按误差修正，保证点击的是目标单元格 */
  async function clickCell(r, c) {
    for (let i = 0; i < 3; i++) {
      const o = await gridOrigin();
      if (!o) break;
      await page.mouse.click(o.x + c * COL_W + COL_W / 2, o.y + ROW_OFF + r * ROW_H + ROW_H / 2);
      await page.waitForTimeout(180);
      const got = await focusCell();
      if (got && got.r === r && got.c === c) return true;
      if (got) {
        const o2 = await gridOrigin();
        await page.mouse.click(
          o2.x + c * COL_W + COL_W / 2 - (got.c - c) * COL_W,
          o2.y + ROW_OFF + r * ROW_H + ROW_H / 2 - (got.r - r) * ROW_H
        );
        await page.waitForTimeout(180);
        const got2 = await focusCell();
        if (got2 && got2.r === r && got2.c === c) return true;
      }
    }
    // 兜底：直接写选中态
    await page.evaluate(({ r, c }) => {
      window.__excelTool.luckysheet.setluckysheet_select_save([
        { row: [r, r], column: [c, c], row_focus: r, column_focus: c },
      ]);
    }, { r, c });
    await page.waitForTimeout(150);
    return false;
  }
  async function typeInto(r, c, text) {
    await clickCell(r, c);
    await page.keyboard.type(String(text));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(380);
  }
  async function selectRange(r1, c1, r2, c2) {
    await page.evaluate(({ r1, c1, r2, c2 }) => {
      window.__excelTool.luckysheet.setluckysheet_select_save([
        { row: [r1, r2], column: [c1, c2], row_focus: r1, column_focus: c1 },
      ]);
    }, { r1, c1, r2, c2 });
    await page.waitForTimeout(250);
  }
  async function cellAt(r, c) {
    return page.evaluate(({ r, c }) => {
      const g = window.__excelTool.luckysheet.flowdata();
      const v = g && g[r] && g[r][c];
      return v ? JSON.parse(JSON.stringify(v)) : null;
    }, { r, c });
  }
  async function config() {
    return page.evaluate(() => JSON.parse(JSON.stringify(window.__excelTool.luckysheet.getconfig())));
  }
  /* 冻结 / 筛选等状态记录在 sheet 对象上，而非 config */
  async function sheetState() {
    return page.evaluate(() => {
      const s = window.__excelTool.luckysheet.getLuckysheetfile()[0] || {};
      return {
        frozen: s.frozen || null,
        filter: s.filter || null,
        filter_select: s.filter_select || null,
        cfgFilter: (window.__excelTool.luckysheet.getconfig() || {}).filter || null,
        cfgFilterSelect: (window.__excelTool.luckysheet.getconfig() || {}).filter_select || null,
      };
    });
  }
  async function clickSel(sel) {
    await page.click(sel, { force: true });
    await page.waitForTimeout(420);
  }
  /* Luckysheet 的弹出菜单挂在 body 上且不会自动移除，
     残留的旧菜单会让「按文本找菜单项」匹配到隐藏节点，这里主动清理 */
  async function clearMenus() {
    await page.evaluate(() => {
      document.querySelectorAll('[id$="-menuButton"]').forEach((e) => e.remove());
    });
  }
  async function openMenu(btnSel, menuId) {
    await clearMenus();
    const el = await page.$(btnSel);
    if (!el) return false;
    const b = await el.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(520);
    return page.evaluate((id) => {
      const m = document.getElementById(id);
      return !!m && m.offsetHeight > 20;
    }, menuId);
  }
  /* 只在「当前可见」的菜单里找菜单项，优先精确匹配，再做前缀/包含匹配 */
  async function clickMenuText(text) {
    const pos = await page.evaluate((t) => {
      const vis = Array.from(document.querySelectorAll('.luckysheet-cols-menuitem-content')).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && e.offsetParent !== null;
      });
      const pick =
        vis.find((e) => e.textContent.trim() === t) ||
        vis.find((e) => e.textContent.trim().indexOf(t) === 0) ||
        vis.find((e) => e.textContent.trim().includes(t));
      if (!pick) return null;
      const r = pick.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, txt: pick.textContent.trim() };
    }, text);
    if (!pos) return false;
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(340);
    return true;
  }
  /* 关闭可能出现的模态对话框（ Luckysheet 校验类提示会拦住后续操作 ） */
  async function dismissDialog() {
    const info = await page.evaluate(() => {
      const dlg = document.querySelector('.luckysheet-modal-dialog');
      if (!dlg) return { state: 'none' };
      const cs = getComputedStyle(dlg);
      if (cs.display === 'none' || cs.visibility === 'hidden') return { state: 'hidden' };
      const txt = (dlg.textContent || '').trim().slice(0, 60);
      const btn = Array.from(dlg.querySelectorAll('button, a, span')).find((b) =>
        /关闭|确定|取消|OK|Close/.test((b.textContent || '').trim())
      );
      if (btn) { btn.click(); return { state: 'closed', txt }; }
      return { state: 'found-no-btn', txt };
    });
    if (info.state !== 'none' && info.state !== 'hidden') await page.waitForTimeout(260);
    return info;
  }
  async function closeMenus() {
    await page.keyboard.press('Escape');
    await page.mouse.click(1250, 820);
    await page.waitForTimeout(220);
    await clearMenus();
    await dismissDialog();
  }
  const shot = async (n) => { if (SHOT) await page.screenshot({ path: path.join(OUT, n + '.png') }); };

  /* ---------------- 1. 撤销 / 重做 ---------------- */
  await typeInto(0, 0, 'undo1');
  const v1 = await cellAt(0, 0);
  await clickSel('#luckysheet-icon-undo');
  const v2 = await cellAt(0, 0);
  await clickSel('#luckysheet-icon-redo');
  const v3 = await cellAt(0, 0);
  check('撤销', v1 && v1.v === 'undo1' && (!v2 || v2.v !== 'undo1'), `输入=${v1 && v1.v} → 撤销=${v2 && v2.v}`);
  check('重做', v3 && v3.v === 'undo1', `重做=${v3 && v3.v}`);

  /* ---------------- 2. 格式刷 ---------------- */
  await typeInto(2, 0, 'fmt');
  await clickCell(2, 0);
  await clickSel('#luckysheet-icon-bold');
  const srcBold = await cellAt(2, 0);
  await clickSel('#luckysheet-icon-paintformat');
  await clickCell(3, 1);
  await page.waitForTimeout(400);
  const dstCell = await cellAt(3, 1);
  check('格式刷', !!(srcBold && srcBold.bl) && !!(dstCell && dstCell.bl), `源 bl=${srcBold && srcBold.bl} → 目标 bl=${dstCell && dstCell.bl}`);

  /* ---------------- 3. 货币 ---------------- */
  await typeInto(4, 0, 1234.5);
  await clickCell(4, 0);
  await clickSel('#luckysheet-icon-currency');
  const cur = await cellAt(4, 0);
  check('货币格式', !!(cur && cur.ct && /¥|￥/.test(cur.ct.fa || '')), JSON.stringify(cur && cur.ct));

  /* ---------------- 4. 百分比 ---------------- */
  await typeInto(5, 0, 0.1234);
  await clickCell(5, 0);
  await clickSel('#luckysheet-icon-percent');
  const pct = await cellAt(5, 0);
  check('百分比格式', !!(pct && pct.ct && /%/.test(pct.ct.fa || '')), JSON.stringify(pct && pct.ct));

  /* ---------------- 5. 增减小数位 ---------------- */
  await typeInto(6, 0, 1.2345);
  await clickCell(6, 0);
  await clickSel('#luckysheet-icon-fmt-decimal-decrease');
  const dec1 = await cellAt(6, 0);
  await clickSel('#luckysheet-icon-fmt-decimal-increase');
  await clickSel('#luckysheet-icon-fmt-decimal-increase');
  const dec2 = await cellAt(6, 0);
  check('减少小数位', !!(dec1 && dec1.ct && /0\.0/.test(dec1.ct.fa || '')), JSON.stringify(dec1 && dec1.ct));
  check('增加小数位', !!(dec2 && dec2.ct && /0\.0000/.test(dec2.ct.fa || '')), JSON.stringify(dec2 && dec2.ct));

  /* ---------------- 6. 数字格式下拉 ---------------- */
  await typeInto(7, 0, 1234.5);
  await clickCell(7, 0);
  const fmtOpen = await openMenu('#luckysheet-icon-fmt-other', 'luckysheet-icon-fmt-other-menuButton');
  await shot('10-numformat-menu');
  const fmtPick = await clickMenuText('百分比');
  await page.waitForTimeout(420);
  const fmtCell = await cellAt(7, 0);
  check('数字格式下拉可打开', fmtOpen);
  check('数字格式下拉选择生效', fmtPick && fmtCell && fmtCell.ct && /%/.test(fmtCell.ct.fa || ''), JSON.stringify(fmtCell && fmtCell.ct));
  await closeMenus();

  /* ---------------- 7. 字体 / 字号 ---------------- */
  await typeInto(8, 0, 'font');
  await clickCell(8, 0);
  const ffOpen = await openMenu('#luckysheet-icon-font-family', 'luckysheet-icon-font-family-menuButton');
  const ffPick = await clickMenuText('Arial');
  await page.waitForTimeout(420);
  const ffCell = await cellAt(8, 0);
  check('字体下拉可打开', ffOpen);
  check('字体下拉选择生效', ffPick && ffCell && ffCell.ff === 'Arial', `ff=${ffCell && ffCell.ff}`);
  await closeMenus();

  await clickCell(8, 0);
  const fsOpen = await openMenu('#luckysheet-icon-font-size', 'luckysheet-icon-font-size-menuButton');
  const fsPick = await clickMenuText('20');
  await page.waitForTimeout(420);
  const fsCell = await cellAt(8, 0);
  check('字号下拉可打开', fsOpen);
  check('字号下拉选择生效', fsPick && fsCell && String(fsCell.fs) === '20', `fs=${fsCell && fsCell.fs}`);
  await closeMenus();

  /* ---------------- 8. 字形 ---------------- */
  await typeInto(9, 0, 'style');
  await clickCell(9, 0);
  await clickSel('#luckysheet-icon-bold');
  await clickSel('#luckysheet-icon-italic');
  await clickSel('#luckysheet-icon-underline');
  await clickSel('#luckysheet-icon-strikethrough');
  const st = await cellAt(9, 0);
  check('粗体', !!(st && st.bl));
  check('斜体', !!(st && st.it));
  check('下划线', !!(st && st.un));
  check('删除线', !!(st && st.cl));

  /* ---------------- 9. 文字颜色 / 单元格底色 ---------------- */
  await typeInto(10, 0, 'color');
  await clickCell(10, 0);
  const tcOpen = await openMenu('#luckysheet-icon-text-color-menu', 'luckysheet-icon-text-color-menu-menuButton');
  const tcHasSpectrum = await page.evaluate(() => {
    const el = document.querySelector('#luckysheet-icon-text-color-menu-menuButton');
    return !!el && !!el.querySelector('.sp-container');
  });
  await shot('20-textcolor-menu');
  const tcPick = await page.evaluate(() => {
    const el = document.querySelector('#luckysheet-icon-text-color-menu-menuButton');
    const sw = el.querySelectorAll('.sp-thumb-el');
    if (!sw.length) return false;
    sw[sw.length - 1].click();
    const ok = Array.from(el.querySelectorAll('button')).find((b) => b.textContent.trim() === '确定');
    if (ok) ok.click();
    return true;
  });
  await page.waitForTimeout(500);
  const tcCell = await cellAt(10, 0);
  check('文字颜色面板可打开（spectrum 插件正常）', tcOpen && tcHasSpectrum);
  check('文字颜色设置生效', tcPick && tcCell && !!tcCell.fc, `fc=${tcCell && tcCell.fc}`);
  await closeMenus();

  await typeInto(11, 0, 'bg');
  await clickCell(11, 0);
  const bgOpen = await openMenu('#luckysheet-icon-cell-color-menu', 'luckysheet-icon-cell-color-menu-menuButton');
  const bgHasSpectrum = await page.evaluate(() => {
    const el = document.querySelector('#luckysheet-icon-cell-color-menu-menuButton');
    return !!el && !!el.querySelector('.sp-container');
  });
  await shot('21-cellcolor-menu');
  const bgPick = await page.evaluate(() => {
    const el = document.querySelector('#luckysheet-icon-cell-color-menu-menuButton');
    const sw = el.querySelectorAll('.sp-thumb-el');
    if (!sw.length) return false;
    sw[1].click();
    const ok = Array.from(el.querySelectorAll('button')).find((b) => b.textContent.trim() === '确定');
    if (ok) ok.click();
    return true;
  });
  await page.waitForTimeout(500);
  const bgCell = await cellAt(11, 0);
  check('单元格底色面板可打开', bgOpen && bgHasSpectrum);
  check('单元格底色设置生效', bgPick && bgCell && !!bgCell.bg, `bg=${bgCell && bgCell.bg}`);
  await closeMenus();

  /* ---------------- 10. 边框 ---------------- */
  await typeInto(12, 0, 'bd');
  await clickCell(12, 0);
  const bdOpen = await openMenu('#luckysheet-icon-border-menu', 'luckysheet-icon-border-menu-menuButton');
  const bdPick = await clickMenuText('所有');
  await page.waitForTimeout(500);
  const cfg1 = await config();
  check('边框菜单可打开', bdOpen);
  check('边框菜单选择生效', bdPick && Array.isArray(cfg1.borderInfo) && cfg1.borderInfo.length > 0,
    `borderInfo=${cfg1.borderInfo ? cfg1.borderInfo.length : 0} 条`);
  await closeMenus();

  /* ---------------- 11. 合并单元格 ---------------- */
  await typeInto(14, 0, 'mg');
  await selectRange(14, 0, 14, 1);
  const mgOpen = await openMenu('#luckysheet-icon-merge-menu', 'luckysheet-icon-merge-menu-menuButton');
  const mgPick = await clickMenuText('全部合并');
  await page.waitForTimeout(500);
  const cfg2 = await config();
  const mgCount = cfg2.merge ? Object.keys(cfg2.merge).length : 0;
  check('合并菜单可打开', mgOpen);
  check('合并单元格生效', mgPick && mgCount > 0, `merge=${mgCount}`);
  await closeMenus();

  /* ---------------- 12. 水平 / 垂直对齐 ---------------- */
  await typeInto(16, 0, 'al');
  await clickCell(16, 0);
  const alOpen = await openMenu('#luckysheet-icon-align-menu', 'luckysheet-icon-align-menu-menuButton');
  const alPick = await clickMenuText('中间对齐');
  await page.waitForTimeout(420);
  const alCell = await cellAt(16, 0);
  check('水平对齐菜单可打开', alOpen);
  check('水平对齐生效', alPick && alCell && String(alCell.ht) === '0', `ht=${alCell && alCell.ht}`);
  await closeMenus();

  await clickCell(16, 0);
  const vlOpen = await openMenu('#luckysheet-icon-valign-menu', 'luckysheet-icon-valign-menu-menuButton');
  const vlPick = await clickMenuText('居中对齐');
  await page.waitForTimeout(420);
  const vlCell = await cellAt(16, 0);
  check('垂直对齐菜单可打开', vlOpen);
  check('垂直对齐生效', vlPick && vlCell && String(vlCell.vt) === '0', `vt=${vlCell && vlCell.vt}`);
  await closeMenus();

  /* ---------------- 13. 自动换行 / 文字旋转 ---------------- */
  await clickCell(16, 0);
  const twOpen = await openMenu('#luckysheet-icon-textwrap-menu', 'luckysheet-icon-textwrap-menu-menuButton');
  const twPick = await clickMenuText('自动换行');
  await page.waitForTimeout(420);
  const twCell = await cellAt(16, 0);
  check('自动换行菜单可打开', twOpen);
  check('自动换行生效', twPick && twCell && twCell.tb !== undefined && twCell.tb !== null && String(twCell.tb) !== '1', `tb=${twCell && twCell.tb}`);
  await closeMenus();

  await clickCell(16, 0);
  const rtOpen = await openMenu('#luckysheet-icon-rotation-menu', 'luckysheet-icon-rotation-menu-menuButton');
  const rtPick = await clickMenuText('竖排文字');
  await page.waitForTimeout(420);
  const rtCell = await cellAt(16, 0);
  check('文字旋转菜单可打开', rtOpen);
  check('文字旋转生效', rtPick && rtCell && rtCell.tr !== undefined && rtCell.tr !== null, `tr=${rtCell && rtCell.tr}`);
  await closeMenus();

  /* ---------------- 15. 函数菜单（求和） ---------------- */
  await typeInto(18, 0, 1);
  await typeInto(19, 0, 2);
  await typeInto(20, 0, 3);
  await selectRange(18, 0, 20, 0);
  const fnOpen = await openMenu('#luckysheet-icon-function-menu', 'luckysheet-icon-function-menu-menuButton');
  const fnPick = await clickMenuText('求和');
  await page.waitForTimeout(800);
  const fnDialog = await dismissDialog();
  await page.waitForTimeout(300);
  const sumCell = await cellAt(21, 0);
  check('函数菜单可打开', fnOpen);
  check('函数菜单-求和生效', fnPick && sumCell && /SUM/i.test(String(sumCell.f || '')), `A22: f=${sumCell && sumCell.f} v=${sumCell && sumCell.v} dialog=${fnDialog.state}:${fnDialog.txt || ''}`);
  await closeMenus();

  /* ---------------- 16. 排序 ---------------- */
  await typeInto(23, 0, 'B');
  await typeInto(24, 0, 'A');
  await selectRange(23, 0, 24, 0);
  const soOpen = await openMenu('#luckysheet-icon-autofilter', 'luckysheet-icon-autofilter-menuButton');
  const soPick = await clickMenuText('升序');
  await page.waitForTimeout(800);
  const s1 = await cellAt(23, 0);
  const s2 = await cellAt(24, 0);
  check('排序菜单可打开', soOpen);
  check('排序-升序生效', soPick && s1 && s2 && s1.v === 'A' && s2.v === 'B', `A24=${s1 && s1.v} A25=${s2 && s2.v}`);
  await closeMenus();

  /* ---------------- 17. 筛选 ---------------- */
  await typeInto(26, 0, 'h1');
  await typeInto(26, 1, 'h2');
  await typeInto(27, 0, 'a');
  await typeInto(27, 1, 'b');
  await selectRange(26, 0, 27, 1);
  const fltBefore = await sheetState();
  const fltOpen = await openMenu('#luckysheet-icon-autofilter', 'luckysheet-icon-autofilter-menuButton');
  const fltPick = await clickMenuText('筛选');
  await page.waitForTimeout(1000);
  await shot('31-filter-after');
  const fltAfter = await sheetState();
  const fltChanged = JSON.stringify(fltBefore) !== JSON.stringify(fltAfter);
  check('筛选菜单可打开', fltOpen);
  check('筛选生效', fltPick && fltChanged, `${JSON.stringify(fltBefore)} → ${JSON.stringify(fltAfter)}`);
  await closeMenus();

  /* ---------------- 18. 批注 ---------------- */
  await typeInto(29, 0, 'cmt');
  await clickCell(29, 0);
  const psOpen = await openMenu('#luckysheet-icon-postil', 'luckysheet-icon-postil-menuButton');
  const psPick = await clickMenuText('新建批注');
  await page.waitForTimeout(900);
  await shot('30-comment-after-click');
  const psState = await page.evaluate(() => {
    const L = window.__excelTool.luckysheet;
    const cfg = L.getconfig();
    const editor = document.querySelector('#luckysheet-postil-show, .luckysheet-postil-show, #luckysheet-rich-text-editor');
    return {
      comments: cfg.comments ? Object.keys(cfg.comments).length : 0,
      hasEditor: !!editor,
      editorVisible: editor ? editor.offsetHeight > 0 : false,
      anyNew: Array.from(document.querySelectorAll('body > div')).filter((d) => d.offsetHeight > 40 && /postil|comment/i.test(d.id + ' ' + d.className)).map((d) => d.id || d.className),
    };
  });
  check('批注菜单可打开', psOpen);
  check('新建批注已触发编辑器/批注记录', psPick && (psState.comments > 0 || psState.hasEditor), JSON.stringify(psState));
  await closeMenus();

  /* ---------------- 19. 更多 ---------------- */
  const moreBefore = await page.evaluate(() => {
    const el = document.querySelector('#luckysheet-icon-morebtn-div');
    return el ? { display: getComputedStyle(el).display, w: el.offsetWidth, h: el.offsetHeight } : null;
  });
  await clickSel('#luckysheet-icon-morebtn');
  await page.waitForTimeout(500);
  await shot('40-more');
  const moreAfter = await page.evaluate(() => {
    const el = document.querySelector('#luckysheet-icon-morebtn-div');
    return el ? { display: getComputedStyle(el).display, w: el.offsetWidth, h: el.offsetHeight } : null;
  });
  check('“更多”按钮可展开附加功能', !!moreAfter && moreAfter.w > 0 && moreAfter.h > 0, JSON.stringify({ before: moreBefore, after: moreAfter }));
  await closeMenus();

  /* ---------------- 20. 冻结（放最后：会改变数据区原点，影响其它用例的坐标） ---------------- */
  await clickCell(0, 4);
  const sheetBefore = await sheetState();
  const fzOpen = await openMenu('#luckysheet-icon-freezen-menu', 'luckysheet-icon-freezen-menu-menuButton');
  await shot('50-freezen-menu');
  const fzPick = await clickMenuText('冻结首行');
  await page.waitForTimeout(800);
  const sheetAfter = await sheetState();
  check('冻结菜单可打开', fzOpen);
  check('冻结首行生效', fzPick && !!sheetAfter.frozen && JSON.stringify(sheetAfter.frozen) !== JSON.stringify(sheetBefore.frozen),
    `sheet.frozen ${JSON.stringify(sheetBefore.frozen)} → ${JSON.stringify(sheetAfter.frozen)}`);
  await closeMenus();
  await clickCell(0, 4);
  await openMenu('#luckysheet-icon-freezen-menu', 'luckysheet-icon-freezen-menu-menuButton');
  await clickMenuText('取消冻结');
  await page.waitForTimeout(500);
  await closeMenus();

  /* ---------------- 21. 弹出层深色可读性（逐个打开再测） ---------------- */
  const MENU_IDS = [
    ['#luckysheet-icon-fmt-other', 'luckysheet-icon-fmt-other-menuButton'],
    ['#luckysheet-icon-font-family', 'luckysheet-icon-font-family-menuButton'],
    ['#luckysheet-icon-align-menu', 'luckysheet-icon-align-menu-menuButton'],
    ['#luckysheet-icon-border-menu', 'luckysheet-icon-border-menu-menuButton'],
    ['#luckysheet-icon-function-menu', 'luckysheet-icon-function-menu-menuButton'],
    ['#luckysheet-icon-merge-menu', 'luckysheet-icon-merge-menu-menuButton'],
    ['#luckysheet-icon-rotation-menu', 'luckysheet-icon-rotation-menu-menuButton'],
  ];
  const contrastReport = [];
  let bad = 0;
  for (const [btn, id] of MENU_IDS) {
    if (!(await openMenu(btn, id))) { contrastReport.push({ id, missing: true }); bad++; continue; }
    const m = await page.evaluate((mid) => {
      const el = document.getElementById(mid);
      if (!el) return null;
      const lum = (c) => {
        const mm = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
        return mm ? 0.299 * +mm[1] + 0.587 * +mm[2] + 0.114 * +mm[3] : null;
      };
      const items = Array.from(el.querySelectorAll('.luckysheet-cols-menuitem-content'));
      const dark = items.filter((i) => { const l = lum(getComputedStyle(i).color); return l !== null && l < 120; }).length;
      const arrow = el.querySelector('.luckysheet-submenu-arrow');
      const arrowLum = arrow ? lum(getComputedStyle(arrow).color) : null;
      return { bg: lum(getComputedStyle(el).backgroundColor), items: items.length, dark, arrowLum };
    }, id);
    if (!m) { contrastReport.push({ id, missing: true }); bad++; continue; }
    if (m.dark > 0 || (m.arrowLum !== null && m.arrowLum < 120)) bad++;
    contrastReport.push({ id: id.replace('luckysheet-icon-', '').replace('-menuButton', ''), ...m });
    await closeMenus();
  }
  check('弹出层无深色文字（深色主题可读）', bad === 0, JSON.stringify(contrastReport));

  /* ---------------- 汇总 ---------------- */
  const pass = results.filter((r) => r.ok).length;
  console.log('\n================ 汇总 ================');
  console.log(`通过 ${pass} / ${results.length}`);
  results.filter((r) => !r.ok).forEach((r) => console.log('  ✗ ' + r.name + '  ' + r.detail));
  console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ results, errors }, null, 1));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 2);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
