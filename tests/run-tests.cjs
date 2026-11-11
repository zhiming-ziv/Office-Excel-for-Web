/* 启动独立预览服务并顺序运行回归；端口占用时明确失败，不误测其他服务。 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const scripts = ['i18n-unit-test', 'i18n-test', 'e2e-test', 'dark-test', 'autosave-test', 'save-test', 'csv-test',
  'regression-test', 'fidelity-test', 'large-draft-test', 'theme-scroll-test', 'rename-test', 'toolbar-test', 'audit-dark'];
const selected = process.argv.length > 2 ? process.argv.slice(2) : scripts;
if (selected.some((name) => !scripts.includes(name))) throw new Error('未知测试名称');
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--strictPort'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
let stopped = false;
server.on('exit', () => { stopped = true; });
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('预览服务启动超时')), 15000);
  server.on('error', reject);
  server.on('exit', (code) => { clearTimeout(timeout); reject(new Error('预览服务退出：' + code)); });
  server.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    if (chunk.toString().includes('127.0.0.1:4173')) { clearTimeout(timeout); resolve(); }
  });
});
const run = (script) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(__dirname, script + '.cjs')], { cwd: ROOT, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(script + ' 失败：' + code)));
});
(async () => {
  try {
    await ready;
    for (const script of selected) { console.log('\n运行 ' + script); await run(script); }
  } finally { if (!stopped) server.kill(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
