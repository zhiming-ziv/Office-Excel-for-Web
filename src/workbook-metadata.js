import JSZip from 'jszip';

const elements = (node, name) => node ? Array.from(node.getElementsByTagNameNS('*', name)) : [];
const xml = async (zip, path) => {
  const file = zip.file(path);
  if (!file) return null;
  const doc = new DOMParser().parseFromString(await file.async('string'), 'application/xml');
  if (elements(doc, 'parsererror').length) throw new Error('工作簿 XML 格式不正确');
  return doc;
};
function resolvePart(base, target) {
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
const relsPath = (part) => part.replace(/([^/]+)$/, '_rels/$1.rels');

/* 补充 Luckyexcel 未读取的传统批注，并从原始文件识别可能丢失的功能。 */
export async function readWorkbookMetadata(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const warnings = new Set();
  for (const name of Object.keys(zip.files)) {
    if (/vbaProject\.bin$/i.test(name)) warnings.add('宏');
    if (/^xl\/media\//.test(name)) warnings.add('图片');
    if (/^xl\/charts\/.*\.xml$/.test(name)) warnings.add('图表');
    if (/^xl\/pivotTables\//.test(name)) warnings.add('透视表');
    if (/^xl\/threadedComments\//.test(name)) warnings.add('线程批注');
    if (/^xl\/externalLinks\//.test(name)) warnings.add('外部链接');
  }
  const workbook = await xml(zip, 'xl/workbook.xml');
  const rels = await xml(zip, 'xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('文件缺少工作簿结构');
  const targets = new Map(elements(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const notes = new Map();
  const hiddenSizes = new Map();
  for (const sheet of elements(workbook, 'sheet')) {
    const id = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = targets.get(id);
    if (!target) continue;
    const part = resolvePart('xl/workbook.xml', target);
    const doc = await xml(zip, part);
    if (!doc) continue;
    // Luckyexcel 会删除隐藏行列的尺寸，补回以便取消隐藏后仍保持原来的大小。
    const sizes = { rowlen: {}, columnlen: {} };
    for (const row of elements(doc, 'row')) {
      if (row.getAttribute('hidden') === '1' && row.hasAttribute('ht')) {
        sizes.rowlen[Number(row.getAttribute('r')) - 1] = Number(row.getAttribute('ht')) / 0.75;
      }
    }
    for (const col of elements(doc, 'col')) {
      if (col.getAttribute('hidden') === '1' && col.hasAttribute('width')) {
        const first = Number(col.getAttribute('min')) - 1;
        const last = Math.min(16383, Number(col.getAttribute('max')) - 1);
        for (let c = Math.max(0, first); c <= last; c++) sizes.columnlen[c] = Number(col.getAttribute('width')) * 7 + 5;
      }
    }
    hiddenSizes.set(sheet.getAttribute('name'), sizes);
    for (const [tag, label] of [['autoFilter', '筛选条件'], ['dataValidations', '数据验证'],
      ['conditionalFormatting', '条件格式'], ['hyperlinks', '超链接'], ['sheetProtection', '工作表保护'],
      ['tableParts', '结构化表格']]) {
      if (elements(doc, tag).length) warnings.add(label);
    }
    const sheetRels = await xml(zip, relsPath(part));
    if (!sheetRels) continue;
    const noteRel = elements(sheetRels, 'Relationship').find((r) => /\/comments$/.test(r.getAttribute('Type')));
    if (!noteRel || noteRel.getAttribute('TargetMode') === 'External') continue;
    const comments = await xml(zip, resolvePart(part, noteRel.getAttribute('Target')));
    if (!comments) continue;
    notes.set(sheet.getAttribute('name'), elements(comments, 'comment').map((comment) => ({
      ref: comment.getAttribute('ref'),
      text: elements(comment, 't').map((t) => t.textContent).join(''),
    })));
  }
  return { notes, hiddenSizes, warnings: [...warnings] };
}

export function applyWorkbookMetadata(sheets, { notes, hiddenSizes }) {
  for (const sheet of sheets) {
    const sizes = hiddenSizes.get(sheet.name);
    sheet.config ||= {};
    if (sizes) {
      for (const key of ['rowlen', 'columnlen']) {
        sheet.config[key] = { ...sheet.config[key], ...sizes[key] };
      }
    }
    const cells = new Map((sheet.celldata || []).map((op) => [`${op.r}_${op.c}`, op]));
    for (const note of notes.get(sheet.name) || []) {
      const match = /^([A-Z]+)(\d+)$/.exec(note.ref);
      if (!match) continue;
      const r = Number(match[2]) - 1;
      const c = [...match[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const key = `${r}_${c}`;
      const op = cells.get(key) || { r, c, v: {} };
      if (!op.v || typeof op.v !== 'object') op.v = { v: op.v };
      op.v.ps = { value: note.text, isshow: false, left: null, top: null, width: null, height: null };
      cells.set(key, op);
      sheet.row = Math.max(sheet.row || 0, r + 1);
      sheet.column = Math.max(sheet.column || 0, c + 1);
    }
    sheet.celldata = [...cells.values()];
  }
}

export function exportRotation(cell) {
  if (Number(cell.tr) === 3) return 'vertical';
  const angle = cell.rt != null ? Number(cell.rt) : ({ 0: 0, 1: 45, 2: 135, 4: 90, 5: 180 })[cell.tr];
  if (!Number.isFinite(angle) || angle < 0 || angle > 180) return undefined;
  return angle > 90 ? 90 - angle : angle;
}
