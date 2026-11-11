/* 词典一致性、占位符、语言匹配与历史草稿警告迁移。 */
const assert = require('node:assert/strict');
(async () => {
  const { dictionaries, resolveLanguage, matchLanguage } = await import('../src/i18n.js');
  const { normalizeWarnings } = await import('../src/warning-codes.js');
  const base = dictionaries.en;
  const placeholders = (text) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
  for (const dictionary of Object.values(dictionaries)) {
    assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(base).sort());
    for (const key of Object.keys(base)) {
      assert.ok(dictionary[key].trim(), key);
      assert.deepEqual(placeholders(dictionary[key]), placeholders(base[key]), key);
    }
  }
  assert.equal(resolveLanguage('zh-TW', ['en-US']), 'zh-TW');
  assert.equal(resolveLanguage('invalid', ['fr-FR', 'zh-HK']), 'zh-TW');
  assert.equal(resolveLanguage(null, ['fr-FR']), 'en');
  assert.equal(matchLanguage('zh-Hans-HK'), 'zh-CN');
  assert.equal(matchLanguage('zh-Hant-CN'), 'zh-TW');
  assert.equal(matchLanguage('zh-SG'), 'zh-CN');
  assert.equal(matchLanguage('en-GB'), 'en');
  assert.deepEqual(normalizeWarnings(['宏', 'images', '图片', '数据验证', '__proto__', '未知警告']), ['macros', 'images', 'validation', 'other']);
  console.log('PASS 三语言词典、占位符、语言匹配和旧警告迁移');
  console.log('ERRORS: none');
})().catch((e) => { console.error(e); process.exitCode = 1; });
