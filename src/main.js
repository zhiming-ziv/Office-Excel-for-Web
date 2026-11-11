import './jquery-global.js';
import luckysheet from 'luckysheet';
import LuckyExcel from 'luckyexcel';
import ExcelJS from 'exceljs';
import { readWorkbookMetadata, applyWorkbookMetadata, exportRotation } from './workbook-metadata.js';
import { LEGACY_DRAFT_KEY, loadDraft, saveDraft, nextDraftTime } from './draft-store.js';
import { language, languages, LANGUAGE_KEY, t, translatePage } from './i18n.js';
import { normalizeWarnings } from './warning-codes.js';

import 'luckysheet/dist/css/luckysheet.css';
// plugins/plugins.css = Font Awesome；plugins/css/pluginsCss.css = spectrum 取色器 + jQuery UI + 图标字体
import 'luckysheet/dist/plugins/plugins.css';
import 'luckysheet/dist/plugins/css/pluginsCss.css';
// 工具栏图标字体：iconfont.css 内含 @font-face(iconfont) 与 .luckysheet-iconfont-*:before 字形定义
import 'luckysheet/dist/assets/iconfont/iconfont.css';
// 深色主题下 Luckysheet 内置 DOM 界面的覆盖样式（浅色主题下全部规则不生效）
import './luckysheet-dark.css';

/* ============================== 常量与状态 ============================== */

const STORAGE_KEY = LEGACY_DRAFT_KEY;
const THEME_KEY = 'excel-tool:theme';
/* 深色主题注入到表格的默认底色 / 文字色（与 style.css 中 --grid-surface / --grid-text 保持一致） */
// 使用等价的 rgba 表达式，与取色器写入的十六进制用户颜色区分。
const THEME_SURFACE = 'rgba(30, 31, 36, 1)';
const THEME_TEXT = 'rgba(215, 218, 224, 1)';

const $ = (sel) => document.querySelector(sel);

const els = {
  fileName: $('#file-name'),
  statusText: $('#status-text'),
  fileInput: $('#file-input'),
  dropOverlay: $('#drop-overlay'),
  toast: $('#toast'),
};

let currentFileName = t('file.untitled') + '.xlsx';
let autoSaveTimer = null;
let toastTimer = null;
let autosaveWarned = false;
let autosaveFailed = false;
let autosavePending = false;
let importSequence = 0;
let importWarnings = [];
let autosaveRevision = 0;
let autosaveInFlight = null;
let autosaveMetrics = null;
let importPending = false;
let workbookReady = false;
let languageSwitchPending = false;
let languageReloadReady = false;

function showCompatibilityNotice() {
  const warnings = new Set(normalizeWarnings(importWarnings));
  for (const sheet of luckysheet.getLuckysheetfile() || []) {
    for (const [key, label] of [['filter', 'filters'], ['filter_select', 'filterRange'], ['dataVerification', 'validation'],
      ['luckysheet_conditionformat_save', 'conditionalFormatting'], ['images', 'images'], ['chart', 'charts'], ['hyperlink', 'hyperlinks']]) {
      if (sheet[key] && Object.keys(sheet[key]).length) warnings.add(label);
    }
  }
  const notice = $('#compatibility-notice');
  notice.hidden = warnings.size === 0;
  notice.textContent = warnings.size ? t('compatibility.notice', { features: [...warnings].map((code) => t('feature.' + code)).join(t('list.separator')) }) : '';
  return warnings.size > 0;
}

function activeSheetPosition(sheets = luckysheet.getLuckysheetfile() || []) {
  const active = luckysheet.getSheet();
  return sheets.findIndex((sheet) => String(sheet.index) === String(active?.index));
}

/* ============================== 基础工具 ============================== */

function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', isError);
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function emptyGrid(rows, cols) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(null);
    grid.push(row);
  }
  return grid;
}

function safeSheetName(name) {
  let n = String(name || 'Sheet1').replace(/[:\\/?*[\]]/g, '_').trim();
  if (!n) n = 'Sheet1';
  return n.slice(0, 31);
}

function uniqueSheetName(name, used) {
  let n = name;
  let i = 1;
  while (used.has(n)) {
    i++;
    const suffix = '_' + i;
    n = name.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(n);
  return n;
}

function colNameToIndex(name) {
  const s = String(name).toUpperCase().trim();
  // luckysheet 的 columnlen 键是 0 基列号字符串（'0'、'1'…），兼容列字母形式（'A'、'B'…）
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let index = 0;
  for (let i = 0; i < s.length; i++) {
    index = index * 26 + (s.charCodeAt(i) - 64);
  }
  return index - 1;
}

function toRgb(color) {
  if (typeof color !== 'string') return null;
  let hex = color.trim();
  const rgb = hex.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (rgb) hex = rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return 'FF' + hex.toUpperCase();
}

function ensureExcelName(name) {
  const n = String(name || t('file.untitled') + '.xlsx').trim();
  if (/\.(xlsx|xls|xlsm)$/i.test(n)) return n;
  if (/\.csv$/i.test(n)) return n.replace(/\.csv$/i, '') + '.xlsx';
  return n + '.xlsx';
}

/* 保存统一输出 .xlsx：ExcelJS 写不出 xls/xlsm 原格式，避免扩展名与内容不一致 */
function ensureSaveName(name) {
  const base = String(name || '').trim().replace(/(\.(xlsx|xlsm|xls|csv))+$/i, '');
  return (base || t('file.untitled')) + '.xlsx';
}

/* ============================== 主题（浅色 / 深色） ============================== */
/*
 * Luckysheet 2.x 无原生深色模式：画布中无样式单元格固定按白底黑字渲染，
 * 硬编码改不了。这里采用「非侵入式注入」方案：
 *   - 深色主题：给所有未显式设置 bg/fc 的单元格写入深色底色/浅色文字（运行时数据）
 *   - 保存 / 导出 / 草稿前：把注入的样式原样剥离，保证写出的文件与主题无关
 *   - 用户显式设置的样式优先级更高，注入只作用于“无样式”单元格
 */

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {
    /* ignore */
  }
  const btn = $('#btn-theme');
  if (btn) {
    btn.title = t(theme === 'dark' ? 'theme.light' : 'theme.dark');
    btn.setAttribute('aria-label', btn.title);
  }
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  let changed = false;
  if (next === 'dark') {
    changed = injectThemeIntoAllSheets();
  } else {
    changed = stripThemeFromAllSheets();
  }
  if (changed) {
    try {
      luckysheet.refresh();
    } catch (e) {
      console.warn('主题切换后重绘失败：', e);
    }
  }
  if (next === 'dark') positionHeaderOverlays();
  else hideHeaderOverlays();
}

/* 取全部工作表的网格（活动表取实时数据，其余从 sheet 对象物化） */
function themeSheetGrids() {
  const sheets = luckysheet.getLuckysheetfile() || [];
  const activeSheetIndex = activeSheetPosition(sheets);
  return sheets.map((sheet, index) => {
    let grid = null;
    if (index === activeSheetIndex) {
      try {
        if (Array.isArray(luckysheet.flowdata())) grid = luckysheet.flowdata();
      } catch (e) {
        grid = null;
      }
    }
    if (!grid) {
      grid = getSheetGrid(sheet);
      // celldata 物化出来的新数组需要写回，否则改动不会作用到 luckysheet 内部状态
      if (grid !== sheet.data) sheet.data = grid;
    }
    return grid;
  });
}

/* 深色主题：给单个网格中“无样式”的单元格注入底色 / 文字色 */
function injectThemeIntoGrid(grid, sheet = {}) {
  if (!Array.isArray(grid)) return false;
  const viewport = $('#luckysheet-cell-main');
  const zoom = Number(sheet.zoomRatio) || 1;
  const config = sheet.config || {};
  const bounds = (count, sizes, hidden, offset, extent, defaultSize) => {
    let start = 0, end = count - 1, position = 0;
    for (let i = 0; i < count; i++) {
      const size = Object.hasOwn(hidden || {}, i) ? 0 : Math.round((Number(sizes?.[i] ?? defaultSize) + 1) * zoom);
      if (position + size < offset) start = i + 1;
      position += size;
      if (position > offset + extent) { end = i; break; }
    }
    return [Math.max(0, start - 4), Math.min(count - 1, end + 4)];
  };
  const rows = bounds(grid.length, config.rowlen, config.rowhidden, viewport?.scrollTop || 0, viewport?.clientHeight || 800, sheet.defaultRowHeight || 19);
  const columns = bounds(grid.reduce((n, row) => Math.max(n, row?.length || 0), 0), config.columnlen, config.colhidden,
    viewport?.scrollLeft || 0, viewport?.clientWidth || 1400, sheet.defaultColWidth || 73);
  const frozen = frozenToView(sheet.frozen) || {};
  let changed = false;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      const visible = (r < (frozen.ySplit || 0) || (r >= rows[0] && r <= rows[1])) &&
        (c < (frozen.xSplit || 0) || (c >= columns[0] && c <= columns[1]));
      if (cell == null) {
        if (!visible) continue;
        row[c] = { bg: THEME_SURFACE, fc: THEME_TEXT, __themeBg: true, __themeFc: true };
        changed = true;
        continue;
      }
      if (typeof cell !== 'object' || Array.isArray(cell)) continue;
      if (!visible && !cellHasContent(cell) && (cell.__themeBg || cell.__themeFc) && stripThemeCell(cell) == null) {
        row[c] = null;
        changed = true;
        continue;
      }
      if (cell.__themeBg && cell.bg !== THEME_SURFACE) delete cell.__themeBg;
      if (cell.__themeFc && cell.fc !== THEME_TEXT) delete cell.__themeFc;
      let touched = false;
      if (cell.bg == null || cell.bg === '') {
        cell.bg = THEME_SURFACE;
        cell.__themeBg = true;
        touched = true;
      }
      if (cell.fc == null || cell.fc === '') {
        cell.fc = THEME_TEXT;
        cell.__themeFc = true;
        touched = true;
      }
      if (touched) changed = true;
    }
  }
  return changed;
}

function injectThemeIntoAllSheets() {
  if (currentTheme() !== 'dark') return false;
  let changed = false;
  try {
    // 非活动表等切换时再处理，避免每次编辑扫描整个工作簿。
    const sheet = luckysheet.getSheet();
    const grid = luckysheet.flowdata();
    if (injectThemeIntoGrid(grid, sheet)) changed = true;
  } catch (e) {
    console.warn('应用深色主题失败：', e);
  }
  return changed;
}

/* 判断单元格是否有实际内容（仅样式 / 空对象视为无内容） */
function cellHasContent(cell) {
  if (cell == null) return false;
  if (typeof cell !== 'object') return String(cell) !== '';
  const v = cell.v == null ? cell.m : cell.v;
  if (v != null && v !== '') return true;
  if (cell.f != null && cell.f !== '') return true;
  return false;
}

/* 剥离单个单元格上的主题注入样式；返回清理后的单元格（可能为 null） */
function stripThemeCell(cell) {
  if (cell == null || typeof cell !== 'object' || Array.isArray(cell)) return cell;
  const hasBg = cell.__themeBg && cell.bg === THEME_SURFACE;
  const hasFc = cell.__themeFc && cell.fc === THEME_TEXT;
  if (!cell.__themeBg && !cell.__themeFc) return cell;
  const clone = Object.assign({}, cell);
  delete clone.__themeBg;
  delete clone.__themeFc;
  if (hasBg) delete clone.bg;
  if (hasFc) delete clone.fc;
  // 还原成真空单元格；但保留其他样式（数字格式等）以免丢失
  const hasOtherStyle = Object.keys(clone).some((k) => k !== 'v' && k !== 'm' && k !== 'f');
  if (!cellHasContent(clone) && !hasOtherStyle) return null;
  return clone;
}

/* 就地剥离（供主题切回浅色时作用在运行时数据上） */
function stripThemeInPlace(grid) {
  if (!Array.isArray(grid)) return false;
  let changed = false;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      const cleaned = stripThemeCell(row[c]);
      if (cleaned !== row[c]) {
        row[c] = cleaned;
        changed = true;
      }
    }
  }
  return changed;
}

/* 拷贝剥离（供保存 / 导出 / 草稿使用，不改动运行时数据） */
function stripThemeFromGrid(grid) {
  if (!Array.isArray(grid)) return grid;
  let touched = false;
  const out = new Array(grid.length);
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) {
      out[r] = row;
      continue;
    }
    const newRow = new Array(row.length);
    let rowTouched = false;
    for (let c = 0; c < row.length; c++) {
      const cleaned = stripThemeCell(row[c]);
      if (cleaned !== row[c]) {
        newRow[c] = cleaned;
        rowTouched = true;
        touched = true;
      } else {
        newRow[c] = row[c];
      }
    }
    out[r] = rowTouched ? newRow : row;
  }
  return touched ? out : grid;
}

/* 剥离 celldata 操作记录中的主题注入样式（luckysheet 与 data 同步的另一种存储格式） */
function stripThemeFromCelldata(sheet) {
  if (!sheet || !Array.isArray(sheet.celldata)) return null;
  let touched = false;
  const out = sheet.celldata.map((op) => {
    if (!op || typeof op !== 'object' || op.v == null) return op;
    const v = stripThemeCell(op.v);
    if (v !== op.v) {
      touched = true;
      return Object.assign({}, op, { v });
    }
    return op;
  });
  return touched ? out : null;
}

function stripThemeFromAllSheets() {
  let changed = false;
  try {
    themeSheetGrids().forEach((grid) => {
      if (stripThemeInPlace(grid)) changed = true;
    });
  } catch (e) {
    console.warn('恢复浅色主题失败：', e);
  }
  return changed;
}

/* 用户新增行列 / 新建工作表后，按需补注入（深色主题下） */
let themeReinjectTimer = null;
function scheduleThemeReinject(delay = 1200) {
  if (currentTheme() !== 'dark') return;
  clearTimeout(themeReinjectTimer);
  themeReinjectTimer = setTimeout(() => {
    if (injectThemeIntoAllSheets()) {
      try {
        luckysheet.refresh();
      } catch (e) {
        /* ignore */
      }
    }
  }, delay);
}

/* ---------- 行列标题栏反色覆盖层（深色主题） ---------- */
let headerOverlays = null;
let headerOverlayTimer = null;

function ensureHeaderOverlays() {
  const host = $('#luckysheet');
  if (!host) return null;
  // luckysheet.create() 会清空容器子节点，缓存元素被移出文档后必须重建
  if (headerOverlays && headerOverlays.col.isConnected && headerOverlays.row.isConnected) {
    return headerOverlays;
  }
  const col = document.createElement('div');
  col.className = 'luckysheet-theme-overlay luckysheet-theme-overlay-col';
  const row = document.createElement('div');
  row.className = 'luckysheet-theme-overlay luckysheet-theme-overlay-row';
  col.setAttribute('aria-hidden', 'true');
  row.setAttribute('aria-hidden', 'true');
  host.append(col, row);
  headerOverlays = { col, row };
  return headerOverlays;
}

/* 依据 luckysheet 的 DOM 容器几何，把覆盖层精确贴到两条标题栏上 */
function positionHeaderOverlays() {
  if (currentTheme() !== 'dark') return;
  const o = ensureHeaderOverlays();
  if (!o) return;
  const rowsH = document.querySelector('#luckysheet-rows-h');
  const cellMain = document.querySelector('#luckysheet-cell-main');
  const leftTop = document.querySelector('#luckysheet-left-top');
  const host = $('#luckysheet');
  if (!host || !rowsH || !cellMain) {
    o.col.style.display = 'none';
    o.row.style.display = 'none';
    return;
  }
  const hostRect = host.getBoundingClientRect();
  const rr = rowsH.getBoundingClientRect();
  const mr = cellMain.getBoundingClientRect();
  const place = (el, rect) => {
    el.style.display = 'block';
    el.style.left = Math.round(rect.left - hostRect.left) + 'px';
    el.style.top = Math.round(rect.top - hostRect.top) + 'px';
    el.style.width = Math.round(rect.width) + 'px';
    el.style.height = Math.round(rect.height) + 'px';
  };
  // 列标题栏：左上角方块顶边 → 数据区顶边（边缘 1px 由覆盖层描边覆盖）
  if (leftTop) {
    const cr = leftTop.getBoundingClientRect();
    place(o.col, {
      left: mr.left,
      top: cr.top,
      width: hostRect.right - mr.left,
      height: mr.top - cr.top,
    });
  } else {
    place(o.col, { left: mr.left, top: hostRect.top, width: hostRect.right - mr.left, height: mr.top - hostRect.top });
  }
  // 左上角（全选按钮）画布并不绘制，直接透出已改暗的容器底色；
  // 若对它反色会与暗底叠加成亮色（双重反色），故不放置覆盖层
  // 行标题栏：覆盖行标题栏容器整块（含上下 1px 描边）
  place(o.row, { left: rr.left, top: rr.top, width: rr.width, height: rr.height + 1 });
}

function hideHeaderOverlays() {
  if (!headerOverlays) return;
  headerOverlays.col.style.display = 'none';
  headerOverlays.row.style.display = 'none';
}

/* 用 ResizeObserver 跟踪标题栏容器几何变化（缩放、冻结、窗口尺寸等） */
let headerObserver = null;
const observedTargets = new WeakSet();

function refreshHeaderObservation() {
  if (typeof ResizeObserver === 'undefined') return;
  const targets = ['#luckysheet-rows-h', '#luckysheet-cell-main', '#luckysheet-left-top']
    .map((s) => document.querySelector(s))
    .filter(Boolean);
  if (!targets.length) return;
  const needRefresh = !headerObserver || targets.some((t) => !observedTargets.has(t));
  if (!needRefresh) return;
  if (headerObserver) headerObserver.disconnect();
  headerObserver = new ResizeObserver(() => positionHeaderOverlays());
  targets.forEach((t) => {
    headerObserver.observe(t);
    observedTargets.add(t);
  });
}

function scheduleHeaderOverlayUpdate(delay = 250) {
  if (currentTheme() !== 'dark') {
    hideHeaderOverlays();
    return;
  }
  clearTimeout(headerOverlayTimer);
  headerOverlayTimer = setTimeout(() => {
    positionHeaderOverlays();
    refreshHeaderObservation();
  }, delay);
}

/* ============================== 工作簿创建 / 恢复 ============================== */

function blankSheets() {
  return [
    {
      name: 'Sheet1',
      status: 0,
      order: 0,
      config: { merge: {}, rowlen: {}, columnlen: {} },
      data: emptyGrid(80, 26),
    },
  ];
}

function createWorkbook(sheets, title) {
  workbookReady = false;
  $('#language-select').disabled = true;
  autosaveRevision++;
  autosaveWarned = false;
  autosaveFailed = false;
  if (title) currentFileName = ensureExcelName(title);
  els.fileName.textContent = currentFileName;
  els.fileName.title = currentFileName;

  clearTimeout(autoSaveTimer);
  clearTimeout(themeReinjectTimer);
  autosavePending = false;

  // 深色主题：创建前先注入，保证首帧就是深色网格（LuckyExcel 导入的是 celldata 格式，
  // 首帧仍是浅色，交由 workbookCreateAfter 里补偿注入 + refresh）
  if (currentTheme() === 'dark') {
    const sheet = sheets.find((item) => item.status === 1) || sheets[0];
    if (sheet) injectThemeIntoGrid(sheet.data, sheet);
  }

  luckysheet.create({
    container: 'luckysheet',
    title: currentFileName,
    lang: languages[language].engine,
    showinfobar: false,
    forceCalculation: true,
    data: sheets,
    hook: {
      workbookCreateAfter: () => {
        workbookReady = true;
        $('#language-select').disabled = importPending || languageSwitchPending;
        if (currentTheme() === 'dark' && injectThemeIntoAllSheets()) {
          try {
            luckysheet.refresh();
          } catch (e) {
            /* ignore */
          }
        }
        updateStatus();
        scheduleAutosave(600);
        scheduleHeaderOverlayUpdate(80);
      },
      sheetActivate: () => {
        // 此钩子在引擎切表之前触发，等切换完成后再读取活动表。
        setTimeout(updateStatus, 0);
        scheduleAutosave(400);
        // 用户新建的工作表等场景：补齐该表的深色注入
        scheduleThemeReinject(60);
      },
      updated: () => {
        scheduleAutosave(900);
        // 新增行列后按需补注入
        scheduleThemeReinject(1200);
        // 缩放 / 布局变化后同步标题栏覆盖层位置
        scheduleHeaderOverlayUpdate(250);
      },
      cellUpdated: () => scheduleAutosave(900),
      rangeSelect: () => updateStatus(),
    },
  });

  updateStatus();
  showCompatibilityNotice();
}

async function restoreOrCreate() {
  $('#app').inert = true;
  const { draft: saved, warning } = await loadDraft();
  importWarnings = normalizeWarnings(saved?.warnings);
  if (saved && Array.isArray(saved.sheets) && saved.sheets.length > 0) {
    createWorkbook(saved.sheets, saved.name || t('file.untitled') + '.xlsx');
    setTimeout(() => toast(t('draft.restored')), 400);
  } else {
    createWorkbook(blankSheets(), t('file.untitled') + '.xlsx');
  }
  $('#app').inert = false;
  if (warning) toast(t('draft.unavailable'), true);
}

/* ============================== 自动保存（草稿） ============================== */

function scheduleAutosave(delay = 800) {
  clearTimeout(autoSaveTimer);
  autosaveRevision++;
  autosavePending = true;
  $('#autosave-state').textContent = t('draft.pending');
  autoSaveTimer = setTimeout(flushAutosave, delay);
}

function flushAutosave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  if (autosaveInFlight) return autosaveInFlight;
  if (!autosavePending) return;
  const revision = autosaveRevision;
  const started = performance.now();
  const success = () => {
    if (revision !== autosaveRevision) return;
    autosaveWarned = false;
    autosaveFailed = false;
    autosavePending = false;
    $('#autosave-state').textContent = t('draft.saved');
  };
  const failure = (e) => {
    if (revision !== autosaveRevision) return;
    console.warn('自动保存失败：', e);
    autosaveFailed = true;
    $('#autosave-state').textContent = t('draft.failed');
    if (!autosaveWarned) {
      autosaveWarned = true;
      toast(t('draft.failureNotice'), true);
    }
  };
  try {
    const large = (luckysheet.getLuckysheetfile() || []).some((sheet) =>
      (sheet.row || sheet.data?.length || 0) * (sheet.column || sheet.data?.[0]?.length || 0) > 20000);
    const payload = { name: currentFileName, savedAt: nextDraftTime(), warnings: normalizeWarnings(importWarnings), sheets: serializeSheets(large) };
    const pending = saveDraft(payload, large);
    autosaveMetrics = { snapshotMs: performance.now() - started, backend: pending ? 'IndexedDB' : 'localStorage' };
    if (pending) {
      $('#autosave-state').textContent = t('draft.saving');
      autosaveInFlight = pending.then(success, failure).finally(() => {
        autosaveInFlight = null;
        if (autosavePending && revision !== autosaveRevision && !languageSwitchPending) flushAutosave();
      });
      return autosaveInFlight;
    } else success();
  } catch (e) {
    failure(e);
  }
}

/* 把运行时数据归一化成「完整网格」形式，供保存 / 导出 / 草稿使用 */
function serializeSheets(sparse = false) {
  const sheets = luckysheet.getLuckysheetfile() || [];
  const activeSheetIndex = activeSheetPosition(sheets);
  return sheets.map((sheet, index) => {
    const isActive = index === activeSheetIndex;
    let grid = null;
    let config = null;
    if (isActive) {
      try {
        grid = luckysheet.flowdata();
      } catch (e) {
        grid = null;
      }
      try {
        config = luckysheet.getconfig();
      } catch (e) {
        config = null;
      }
    }
    if (!Array.isArray(grid) || grid.length === 0) grid = getSheetGrid(sheet);
    if (!config) config = sheet.config || {};
    // 深色主题注入的底色/文字色只属于运行时显示，写出的文件必须剥离
    if (sparse) {
      // 抽样选择表示形式：密集表保留二维数组，避免为每个值额外创建坐标对象。
      let sampled = 0, occupied = 0;
      for (let r = 0; r < grid.length; r += Math.max(1, Math.floor(grid.length / 20))) {
        const row = grid[r] || [];
        for (let c = 0; c < row.length; c += Math.max(1, Math.floor(row.length / 20))) {
          sampled++;
          if (stripThemeCell(row[c]) != null) occupied++;
        }
      }
      if (occupied > sampled * 0.35) {
        const result = { ...sheet, config, data: stripThemeFromGrid(grid) };
        delete result.celldata;
        return result;
      }
      const celldata = [];
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < (grid[r]?.length || 0); c++) {
          const v = stripThemeCell(grid[r][c]);
          if (v != null) celldata.push({ r, c, v });
        }
      }
      const result = { ...sheet, config, celldata, row: Math.max(sheet.row || 0, grid.length),
        column: grid.reduce((n, row) => Math.max(n, row?.length || 0), sheet.column || 0) };
      delete result.data;
      return result;
    }
    const cleanGrid = stripThemeFromGrid(grid);
    const result = Object.assign({}, sheet, { data: cleanGrid, config });
    // luckysheet 会用 celldata 与 data 同步（refresh 后会从网格重建），同样需要剥离
    const cleanCelldata = stripThemeFromCelldata(sheet);
    if (cleanCelldata) result.celldata = cleanCelldata;
    return result;
  });
}

/* 从 luckysheet 文件对象中提取网格（支持 data 全量与 celldata 操作两种格式） */
function getSheetGrid(sheet) {
  if (!sheet) return [];
  if (Array.isArray(sheet.data) && sheet.data.length > 0) return sheet.data;
  if (Array.isArray(sheet.celldata) && sheet.celldata.length > 0) {
    const rows = sheet.row || 100;
    const cols = sheet.column || 26;
    const grid = emptyGrid(rows, cols);
    for (const op of sheet.celldata) {
      if (!op || typeof op.r !== 'number' || typeof op.c !== 'number') continue;
      const row = grid[op.r];
      if (row && op.c < row.length) row[op.c] = op.v;
    }
    return grid;
  }
  return [];
}

/* ============================== 打开文件 ============================== */

/* 当前工作簿是否有内容：打开新文件会覆盖草稿，先确认避免误操作 */
function workbookHasContent() {
  try {
    const sheets = luckysheet.getLuckysheetfile() || [];
    const activeSheetIndex = activeSheetPosition(sheets);
    return sheets.some((sheet, index) => {
      let grid = null;
      if (index === activeSheetIndex) {
        try {
          const live = luckysheet.flowdata();
          if (Array.isArray(live)) grid = live;
        } catch (e) {
          grid = null;
        }
      }
      if (!Array.isArray(grid)) grid = getSheetGrid(sheet);
      return grid.some((row) => Array.isArray(row) && row.some((cell) => cellHasContent(cell)));
    });
  } catch (e) {
    return false;
  }
}

async function handleFile(file) {
  if (!file || languageSwitchPending) return;
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) {
    toast(t('file.unsupportedXls'), true);
    return;
  }
  if (!/\.(xlsx|xlsm|csv)$/.test(name)) {
    toast(t('file.supported'), true);
    return;
  }
  if (workbookHasContent() && !window.confirm(t('file.replaceConfirm'))) {
    return;
  }
  const sequence = ++importSequence;
  importPending = true;
  $('#language-select').disabled = true;
  try {
    if (name.endsWith('.csv')) {
      const buffer = await file.arrayBuffer();
      if (sequence !== importSequence) return;
      importWarnings = [];
      const sheetName = file.name.replace(/\.csv$/i, '');
      createWorkbook([csvToSheet(decodeCsv(buffer), sheetName)], file.name);
    } else {
      const metadata = await readWorkbookMetadata(await file.arrayBuffer());
      if (sequence !== importSequence) return;
      const exportJson = await waitWithTimeout(new Promise((resolve) => LuckyExcel.transformExcelToLucky(file, resolve)), 30000);
      if (sequence !== importSequence) return;
      if (!exportJson || !Array.isArray(exportJson.sheets) || exportJson.sheets.length === 0) throw new Error('工作簿中没有有效工作表');
      applyWorkbookMetadata(exportJson.sheets, metadata);
      importWarnings = normalizeWarnings(metadata.warnings);
      if (name.endsWith('.xlsm')) importWarnings = [...new Set([...importWarnings, 'macros'])];
      createWorkbook(exportJson.sheets, file.name);
    }
    toast(t('file.opened', { name: file.name }));
  } catch (e) {
    if (sequence === importSequence) {
      console.warn('读取工作簿失败：', e);
      toast(t(name.endsWith('.csv') ? 'file.csvFailed' : 'file.parseFailed'), true);
    }
  } finally {
    if (sequence === importSequence) {
      importPending = false;
      $('#language-select').disabled = !workbookReady || languageSwitchPending;
    }
  }
}

/* CSV 编码探测：UTF-16 BOM → 严格 UTF-8 → GB18030（兼容中文 Windows 常见的 GBK 导出） */
function decodeCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch (_) {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

/* CSV 文本解析（支持引号包裹、内部双引号转义） */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function csvToSheet(text, sheetName = 'Sheet1') {
  let content = String(text || '').replace(/^\uFEFF/, '');
  const aoa = parseCSV(content);
  const data = aoa.map((row) =>
    row.map((raw) => {
      const v = raw.trim();
      if (v === '') return null;
      // 仅转换安全的十进制数：保留前导零与超长数字（身份证、订单号等）
      if (/^-?\d+(\.\d+)?$/.test(v) && !/^-?0\d/.test(v) && v.replace(/[-.]/g, '').length <= 15) {
        return { v: Number(v) };
      }
      // Luckysheet 会把数字形态的字符串强转成数值，用 Excel 的文本标记（前导单引号）保住原文
      if (/^[+\-]?(\d+(\.\d*)?|\.\d+)([eE][+\-]?\d+)?$/.test(v)) {
        return { v: "'" + v };
      }
      return { v: raw };
    })
  );
  return {
    name: sheetName,
    status: 0,
    order: 0,
    config: { merge: {}, rowlen: {}, columnlen: {} },
    data,
  };
}

/* ============================== 保存 xlsx ============================== */

/* ============================== 保存 xlsx（ExcelJS） ============================== */

async function saveFile() {
  try {
    luckysheet.exitEditMode();
    const limited = showCompatibilityNotice();
    const wb = buildWorkbook();
    const buffer = await wb.xlsx.writeBuffer();
    const fileName = ensureSaveName(currentFileName);
    currentFileName = fileName;
    els.fileName.textContent = fileName;
    els.fileName.title = fileName;
    downloadBlob(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      fileName,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    autosaveFailed = false; // 已成功导出到磁盘，离开页面无需再拦截
    autosaveWarned = false; // 若配额仍满，下次失败要重新提示
    toast(t(limited ? 'file.downloadedLimited' : 'file.downloaded', { name: fileName }));
  } catch (e) {
    console.error(e);
    toast(t('file.saveFailed'), true);
  }
}

function pxToExcelWidth(px) {
  const chars = (px - 5) / 7;
  return Math.max(2, Math.round(chars * 100) / 100);
}

function pxToExcelHeight(px) {
  return Math.round(px * 0.75 * 100) / 100;
}

/*
 * Luckysheet 的 frozen 结构与 ExcelJS 的视图不同：
 * row/column/both 表示冻结首行/首列；range* 用焦点行列，冻结数量 = 索引 + 1。
 */
function frozenToView(frozen) {
  if (!frozen || typeof frozen !== 'object') return null;
  const range = frozen.range || {};
  const rowFocus = Number.isInteger(range.row_focus) ? range.row_focus : null;
  const colFocus = Number.isInteger(range.column_focus) ? range.column_focus : null;
  let xSplit = 0;
  let ySplit = 0;
  switch (frozen.type) {
    case 'row':
      ySplit = 1;
      break;
    case 'column':
      xSplit = 1;
      break;
    case 'both':
      xSplit = 1;
      ySplit = 1;
      break;
    case 'rangeRow':
      ySplit = rowFocus == null ? 0 : rowFocus + 1;
      break;
    case 'rangeColumn':
      xSplit = colFocus == null ? 0 : colFocus + 1;
      break;
    case 'rangeBoth':
      xSplit = colFocus == null ? 0 : colFocus + 1;
      ySplit = rowFocus == null ? 0 : rowFocus + 1;
      break;
    default:
      return null;
  }
  if (!xSplit && !ySplit) return null;
  return { state: 'frozen', xSplit, ySplit };
}

function buildWorkbook() {
  const sheets = serializeSheets();
  const wb = new ExcelJS.Workbook();
  const used = new Set();

  sheets.forEach((sheet, index) => {
    const grid = Array.isArray(sheet.data) ? sheet.data : [];
    const config = sheet.config || {};
    const name = uniqueSheetName(safeSheetName(sheet.name), used);
    const ws = wb.addWorksheet(name, {
      // 注意：luckysheet 中 status=1 表示“当前激活表”，隐藏用 hide=1
      state: sheet.hide === 1 ? 'hidden' : 'visible',
    });

    const frozenView = frozenToView(sheet.frozen);
    if (frozenView) ws.views = [frozenView];

    let cols = 0;
    for (const row of grid) {
      if (Array.isArray(row)) cols = Math.max(cols, row.length);
    }

    // 单元格值与公式
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell == null) continue;
        const exCell = ws.getCell(r + 1, c + 1);
        const obj = typeof cell === 'object' && !Array.isArray(cell) ? cell : { v: cell };
        let v = obj.v;
        if (v === undefined || v === null) v = obj.m;
        if (typeof obj.f === 'string' && obj.f.trim() !== '') {
          const formula = obj.f.charAt(0) === '=' ? obj.f.slice(1) : obj.f;
          exCell.value = { formula, result: v === undefined || v === null ? undefined : v };
        } else if (v !== undefined && v !== null) {
          exCell.value = v;
        }
        // 样式
        const font = {};
        if (obj.bl) font.bold = true;
        if (obj.it) font.italic = true;
        if (obj.un) font.underline = true;
        if (obj.cl) font.strike = true;
        if (typeof obj.ff === 'string' && obj.ff && obj.ff !== '0') font.name = obj.ff;
        if (obj.fs && Number(obj.fs)) font.size = Number(obj.fs);
        const fc = toRgb(obj.fc);
        if (fc) font.color = { argb: fc };
        if (Object.keys(font).length) exCell.font = font;

        const bg = toRgb(obj.bg);
        if (bg) exCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };

        const al = {};
        const htMap = { 0: 'center', 1: 'left', 2: 'right' };
        const vtMap = { 0: 'middle', 1: 'top', 2: 'bottom' };
        if (typeof obj.ht === 'number' && htMap[obj.ht]) al.horizontal = htMap[obj.ht];
        if (typeof obj.vt === 'number' && vtMap[obj.vt]) al.vertical = vtMap[obj.vt];
        if (obj.tb === 2) al.wrapText = true;
        const rotation = exportRotation(obj);
        if (rotation !== undefined) al.textRotation = rotation;
        if (Object.keys(al).length) exCell.alignment = al;
        if (obj.ps && typeof obj.ps.value === 'string') {
          // 只含批注的单元格也写出 <c> 节点，避免读取器忽略悬空批注引用。
          if (exCell.value == null) exCell.value = '';
          exCell.note = obj.ps.value;
        }

        if (
          obj.ct &&
          typeof obj.ct.fa === 'string' &&
          obj.ct.fa
        ) {
          exCell.numFmt = obj.ct.fa;
        }
      }
    }

    // 合并单元格
    if (config.merge) {
      for (const key of Object.keys(config.merge)) {
        const m = config.merge[key];
        if (m && typeof m.r === 'number' && typeof m.c === 'number') {
          const rs = m.rs || 1;
          const cs = m.cs || 1;
          ws.mergeCells(m.r + 1, m.c + 1, m.r + rs, m.c + cs);
        }
      }
    }

    // 列宽 / 行高
    applyBorders(ws, config.borderInfo);
    if (config.columnlen) {
      for (const key of Object.keys(config.columnlen)) {
        const idx = colNameToIndex(key);
        if (idx >= 0) ws.getColumn(idx + 1).width = pxToExcelWidth(config.columnlen[key]);
      }
    }
    if (config.rowlen) {
      for (const key of Object.keys(config.rowlen)) {
        const idx = parseInt(key, 10);
        if (!isNaN(idx) && idx >= 0) ws.getRow(idx + 1).height = pxToExcelHeight(config.rowlen[key]);
      }
    }
    for (const key of Object.keys(config.rowhidden || {})) {
      if (/^\d+$/.test(key)) {
        const row = ws.getRow(Number(key) + 1);
        row.hidden = true;
        // ExcelJS 会省略没有值且没有高度的行，显式高度保证空白隐藏行也写入。
        if (!row.height) row.height = pxToExcelHeight(sheet.defaultRowHeight || 19);
      }
    }
    for (const key of Object.keys(config.colhidden || {})) {
      if (/^\d+$/.test(key)) ws.getColumn(Number(key) + 1).hidden = true;
    }
  });

  if (wb.worksheets.length === 0) wb.addWorksheet('Sheet1');
  return wb;
}

/* 边框记录按操作顺序叠加；清除边框也要同步清除相邻单元格的共用边。 */
function applyBorders(ws, records = []) {
  const styles = { 1: 'thin', 2: 'hair', 3: 'dotted', 4: 'dashDot', 5: 'dashDotDot',
    6: 'dashed', 7: 'mediumDashDot', 8: 'mediumDashDotDot', 9: 'mediumDashed',
    10: 'medium', 11: 'thick', 12: 'double', 13: 'slantDashDot' };
  const edges = new Map();
  const put = (r, c, side, value) => {
    if (r < 0 || c < 0) return;
    const key = r + ':' + c;
    if (!edges.has(key)) edges.set(key, {});
    edges.get(key)[side] = value;
  };
  const set = (r, c, side, value) => {
    put(r, c, side, value);
    const opposite = { left: [r, c - 1, 'right'], right: [r, c + 1, 'left'],
      top: [r - 1, c, 'bottom'], bottom: [r + 1, c, 'top'] }[side];
    put(...opposite, value);
  };
  const border = (value) => {
    if (!value || !styles[value.style]) return undefined;
    return { style: styles[value.style], color: { argb: toRgb(value.color) || 'FF000000' } };
  };
  for (const record of records || []) {
    if (record.rangeType === 'cell') {
      const value = record.value || {};
      if (!Number.isInteger(value.row_index) || !Number.isInteger(value.col_index)) continue;
      for (const [key, side] of Object.entries({ l: 'left', r: 'right', t: 'top', b: 'bottom' })) {
        if (Object.hasOwn(value, key)) set(value.row_index, value.col_index, side, border(value[key]));
      }
      continue;
    }
    for (const range of record.range || []) {
      const [r0, r1] = range.row;
      const [c0, c1] = range.column;
      const type = record.borderType;
      const value = type === 'border-none' ? undefined : border(record);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const outside = { left: c === c0, right: c === c1, top: r === r0, bottom: r === r1 };
          for (const side of ['left', 'right', 'top', 'bottom']) {
            const horizontal = side === 'top' || side === 'bottom';
            if (type === 'border-all' || type === 'border-none' ||
              (type === 'border-outside' && outside[side]) ||
              (type === 'border-inside' && !outside[side]) ||
              (type === 'border-horizontal' && horizontal && !outside[side]) ||
              (type === 'border-vertical' && !horizontal && !outside[side]) ||
              (type === 'border-' + side && outside[side])) set(r, c, side, value);
          }
        }
      }
    }
  }
  for (const [key, value] of edges) {
    const [r, c] = key.split(':').map(Number);
    const cell = ws.getCell(r + 1, c + 1);
    cell.style = { ...cell.style, border: value };
  }
}

/* API 显式赋色即使与主题色相同，也应成为用户样式；标记随引擎克隆保留。 */
function preserveExplicitColors() {
  for (const method of ['setCellValue', 'setCellFormat']) {
    const original = luckysheet[method];
    luckysheet[method] = function (...args) {
      const result = original.apply(this, args);
      const [row, col, value] = args;
      const options = args[method === 'setCellValue' ? 3 : 4] || {};
      const sheet = options.order == null ? luckysheet.getSheet() : luckysheet.getLuckysheetfile()[options.order];
      const grid = sheet === luckysheet.getSheet() ? luckysheet.flowdata() : sheet?.data;
      const cell = grid?.[row]?.[col];
      if (cell && typeof cell === 'object') {
        for (const [attr, marker] of [['bg', '__themeBg'], ['fc', '__themeFc']]) {
          if (method === 'setCellFormat' ? value === attr : value && typeof value === 'object' && Object.hasOwn(value, attr)) {
            delete cell[marker];
          }
        }
      }
      return result;
    };
  }
}

function exportCSV() {
  try {
    luckysheet.exitEditMode();
    const sheets = luckysheet.getLuckysheetfile() || [];
    const activeSheetIndex = activeSheetPosition(sheets);
    const sheet = sheets[activeSheetIndex] || sheets[0];
    if (!sheet) {
      toast(t('file.noSheet'), true);
      return;
    }
    let grid;
    if (sheets[activeSheetIndex] === sheet && Array.isArray(luckysheet.flowdata())) {
      grid = luckysheet.flowdata();
    }
    if (!Array.isArray(grid) || grid.length === 0) grid = getSheetGrid(sheet);
    grid = stripThemeFromGrid(grid);
    const csv = gridToCSV(grid);
    const base = safeSheetName(sheet.name || 'Sheet1');
    downloadBlob('\uFEFF' + csv, base + '.csv', 'text/csv;charset=utf-8');
    toast(t('file.csvExported', { name: base + '.csv' }));
  } catch (e) {
    console.error(e);
    toast(t('file.exportFailed'), true);
  }
}

function gridToCSV(grid) {
  // 计算有效区域：裁剪尾部全空行/全空列
  let lastRow = -1;
  let lastCol = -1;
  const nonEmpty = (rawCell) => {
    let v = rawCell == null ? '' : rawCell;
    if (typeof v === 'object') v = v.v == null ? '' : v.v;
    return String(v) !== '';
  };
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      if (nonEmpty(row[c])) {
        if (r > lastRow) lastRow = r;
        if (c > lastCol) lastCol = c;
      }
    }
  }
  const lines = [];
  for (let r = 0; r <= lastRow; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) {
      lines.push('');
      continue;
    }
    const cells = [];
    for (let c = 0; c <= lastCol; c++) {
      let v = row[c] == null ? '' : row[c];
      if (typeof v === 'object') v = v.v == null ? '' : v.v;
      v = String(v);
      // 防止 CSV 公式注入：文本以 = + @ 或非数字的 - 开头时加前导单引号
      if (/^[=+@]/.test(v) || (/^-/.test(v) && !/^-?\d+(\.\d+)?$/.test(v))) v = "'" + v;
      if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
      cells.push(v);
    }
    lines.push(cells.join(','));
  }
  return lines.join('\r\n');
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

/* ============================== 状态栏 ============================== */

function updateStatus() {
  try {
    const sheets = luckysheet.getLuckysheetfile() || [];
    const activeSheetIndex = activeSheetPosition(sheets);
    if (!sheets.length) {
      els.statusText.textContent = '—';
      return;
    }
    const index = activeSheetIndex >= 0 ? activeSheetIndex : 0;
    const sheet = sheets[index];
    let grid;
    if (index === activeSheetIndex && Array.isArray(luckysheet.flowdata()) && luckysheet.flowdata().length) {
      grid = luckysheet.flowdata();
    }
    if (!Array.isArray(grid) || grid.length === 0) grid = getSheetGrid(sheet);
    let cols = 0;
    for (const row of grid) {
      if (Array.isArray(row)) cols = Math.max(cols, row.length);
    }
    els.statusText.textContent = t('status.sheet', { name: safeSheetName(sheet.name), rows: grid.length, cols });
  } catch (e) {
    els.statusText.textContent = t('status.ready');
  }
}

/* ============================== 事件绑定 ============================== */

/* 文件名支持就地重命名：点击切换为输入框，回车/失焦提交，Esc 取消 */
function bindFileNameRename() {
  const chip = els.fileName;

  chip.addEventListener('click', () => {
    if (chip.dataset.editing) return;
    chip.dataset.editing = '1';
    chip.hidden = true;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fname-input';
    input.value = currentFileName;
    input.spellcheck = false;
    input.maxLength = 120;
    chip.after(input);
    input.focus();
    // 默认只选中主文件名，保留扩展名方便直接改名
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);

    const finish = (commit) => {
      // 移除输入框会同步触发 blur，此处先置标记避免重入
      if (input.dataset.done) return;
      input.dataset.done = '1';
      const value = input.value.trim();
      if (input.parentNode) input.parentNode.removeChild(input);
      chip.hidden = false;
      delete chip.dataset.editing;
      if (!commit) return;
      currentFileName = ensureExcelName(value || t('file.untitled') + '.xlsx');
      chip.textContent = currentFileName;
      chip.title = currentFileName;
      scheduleAutosave(300);
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 输入期间不触发 Ctrl+S/O/N 等全局快捷键
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  });
}

function waitWithTimeout(promise, timeout = 15000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('等待操作完成超时')), timeout);
  })]).finally(() => clearTimeout(timer));
}

async function switchLanguage() {
  const select = $('#language-select');
  const next = select.value;
  select.value = language;
  if (next === language || !Object.hasOwn(languages, next) || !workbookReady || importPending || languageSwitchPending) return;
  if (!window.confirm(t('language.confirm', { language: languages[next].label }))) return;
  languageSwitchPending = true;
  select.disabled = true;
  $('#app').inert = true;
  clearTimeout(themeReinjectTimer);
  toast(t('language.saving'));
  try {
    luckysheet.exitEditMode();
    // 等待已有事务结束后，强制保存最新编辑；不能只等待较早的草稿。
    if (autosaveInFlight) await waitWithTimeout(autosaveInFlight);
    scheduleAutosave(0);
    await waitWithTimeout(Promise.resolve(flushAutosave()));
    if (autosaveFailed || autosavePending || autosaveInFlight) throw new Error('最新草稿尚未成功写入');
    localStorage.setItem(LANGUAGE_KEY, next);
    languageReloadReady = true;
    window.location.reload();
  } catch (e) {
    console.warn('切换语言失败：', e);
    languageSwitchPending = false;
    languageReloadReady = false;
    select.disabled = false;
    $('#app').inert = false;
    toast(t('language.failed'), true);
  }
}

function bindEvents() {
  $('#language-select').addEventListener('change', switchLanguage);
  document.addEventListener('scroll', (e) => {
    if (e.target?.id === 'luckysheet-cell-main') scheduleThemeReinject(60);
  }, true);
  // 自动保存失败后，关闭/刷新前提醒用户，避免新编辑内容无提示丢失
  window.addEventListener('beforeunload', (e) => {
    if (languageReloadReady) return;
    luckysheet.exitEditMode();
    flushAutosave();
    if (!autosaveFailed && !autosavePending && !autosaveInFlight) return;
    e.preventDefault();
    e.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (languageReloadReady) return;
    if (document.visibilityState === 'hidden') {
      luckysheet.exitEditMode();
      flushAutosave();
    }
  });

  $('#btn-save').addEventListener('click', saveFile);
  $('#btn-csv').addEventListener('click', exportCSV);
  $('#btn-theme').addEventListener('click', toggleTheme);

  $('#btn-open').addEventListener('click', () => els.fileInput.click());

  $('#btn-new').addEventListener('click', () => {
    if (languageSwitchPending) return;
    const ok = window.confirm(t('file.newConfirm'));
    if (!ok) return;
    importSequence++;
    importPending = false;
    importWarnings = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    createWorkbook(blankSheets(), t('file.untitled') + '.xlsx');
    toast(t('file.created'));
  });

  bindFileNameRename();

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    els.fileInput.value = '';
    handleFile(file);
  });

  document.addEventListener('keydown', (e) => {
    if (languageSwitchPending) { e.preventDefault(); return; }
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      saveFile();
    } else if (key === 'o') {
      e.preventDefault();
      els.fileInput.click();
    } else if (key === 'n') {
      e.preventDefault();
      $('#btn-new').click();
    }
  });

  let dragDepth = 0;
  window.addEventListener('resize', () => scheduleHeaderOverlayUpdate(120));
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    els.dropOverlay.classList.add('show');
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      els.dropOverlay.classList.remove('show');
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.dropOverlay.classList.remove('show');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) handleFile(files[0]);
  });
}

/* ============================== 启动 ============================== */

translatePage();
preserveExplicitColors();
bindEvents();
applyTheme(currentTheme()); // 同步按钮文案（主题属性已由 index.html 内联脚本预设）
restoreOrCreate();

/* 供调试：暴露到全局方便排查 */
window.__excelTool = {
  luckysheet,
  getFileName: () => currentFileName,
  getTheme: currentTheme,
  getLanguage: () => language,
  getAutosaveState: () => ({ pending: autosavePending, writing: !!autosaveInFlight, failed: autosaveFailed, ...autosaveMetrics }),
};
