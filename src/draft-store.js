export const LEGACY_DRAFT_KEY = 'excel-tool:autosave:v1';
const DATABASE = 'excel-tool-drafts';
let databasePromise;
let clock = Date.now();
export const nextDraftTime = () => (clock = Math.max(Date.now(), clock + 1));

function database() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('草稿数据库被其他页面阻塞'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = null; };
      resolve(db);
    };
  }).catch((error) => { databasePromise = null; throw error; });
  return databasePromise;
}

async function transact(mode, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const store = tx.objectStore('drafts');
    const request = mode === 'readonly' ? store.get('current') : store.put(value, 'current');
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('草稿事务已取消'));
    tx.onerror = () => reject(tx.error || request.error);
  });
}

export async function loadDraft() {
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_DRAFT_KEY) || 'null'); } catch (_) { /* 旧草稿可能损坏 */ }
  let stored = null;
  let warning = null;
  try { stored = await transact('readonly'); } catch (error) { warning = error; }
  const valid = (draft) => draft && Array.isArray(draft.sheets) && draft.sheets.length > 0;
  const candidates = [legacy, stored].filter(valid).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  const draft = candidates[0] || null;
  clock = Math.max(clock, draft?.savedAt || 0);
  return { draft, warning };
}

/* 小草稿保留同步退出保护；大草稿用结构化克隆写 IndexedDB，避免 JSON 与同步存储。 */
export function saveDraft(payload, large) {
  if (!large) {
    const text = JSON.stringify(payload);
    if (text.length <= 256 * 1024) {
      localStorage.setItem(LEGACY_DRAFT_KEY, text);
      return null;
    }
  }
  let previous;
  try { previous = localStorage.getItem(LEGACY_DRAFT_KEY); } catch (_) { /* IndexedDB 仍可能可用 */ }
  return transact('readwrite', payload).then(() => {
    // 事务提交后才清理旧副本；期间有新草稿写入时不能删除它。
    try {
      if (previous != null && localStorage.getItem(LEGACY_DRAFT_KEY) === previous) localStorage.removeItem(LEGACY_DRAFT_KEY);
    } catch (_) { /* 留下旧副本不影响按保存时间选择最新草稿 */ }
  });
}
