import zhCN from './locales/zh-CN.js';
import zhTW from './locales/zh-TW.js';
import en from './locales/en.js';

export const LANGUAGE_KEY = 'excel-tool:language';
export const languages = {
  'zh-CN': { label: '简体中文', engine: 'zh' },
  'zh-TW': { label: '繁體中文', engine: 'zh_tw' },
  en: { label: 'English', engine: 'en' },
};
export const dictionaries = { 'zh-CN': zhCN, 'zh-TW': zhTW, en };

export function matchLanguage(value) {
  const tag = String(value || '').toLowerCase().replaceAll('_', '-');
  if (/^zh(?:-|$)/.test(tag)) {
    if (tag.split('-').includes('hans')) return 'zh-CN';
    return /(?:hant|tw|hk|mo)(?:-|$)/.test(tag) ? 'zh-TW' : 'zh-CN';
  }
  return /^en(?:-|$)/.test(tag) ? 'en' : null;
}

export function resolveLanguage(saved, preferred = []) {
  if (Object.hasOwn(languages, saved)) return saved;
  return preferred.map(matchLanguage).find(Boolean) || 'en';
}

let saved;
try { saved = localStorage.getItem(LANGUAGE_KEY); } catch (_) { /* 禁止存储时仍可显示界面 */ }
export const language = resolveLanguage(saved, typeof navigator === 'undefined' ? [] : (navigator.languages || [navigator.language]));

export function t(key, params = {}) {
  const template = dictionaries[language][key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name) => Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

export function translatePage() {
  document.documentElement.lang = language;
  document.title = t('app.title');
  for (const [attribute, target] of [['data-i18n', 'textContent'], ['data-i18n-title', 'title'], ['data-i18n-aria', 'aria-label']]) {
    document.querySelectorAll(`[${attribute}]`).forEach((element) => {
      const text = t(element.getAttribute(attribute));
      if (target === 'aria-label') element.setAttribute(target, text);
      else element[target] = text;
    });
  }
  document.querySelector('#language-select').value = language;
}
