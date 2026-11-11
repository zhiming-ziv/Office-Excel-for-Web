/* 一键启动本地服务：检查依赖、重新构建，再启动 preview 并打开浏览器。 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = '4173';
const URL = 'http://127.0.0.1:' + PORT + '/';
// Windows 下 npm 是 .cmd，必须经 shell 执行；参数均为固定字面量，拼接无注入风险
const npmLine = (args) => 'npm ' + args.join(' ');

function runStep(args, label) {
  console.log('[准备] ' + label);
  const r = spawnSync(npmLine(args), { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('\n[失败] ' + label + '，请检查上方输出。');
    process.exit(r.status || 1);
  }
}

if (!fs.existsSync(path.join(ROOT, 'node_modules', 'vite'))) {
  runStep(['install'], '未检测到依赖，执行 npm install');
}
runStep(['run', 'build'], '构建当前源码，确保启动最新版本');

console.log('\n构建完成，正在启动：' + URL + '（按 Ctrl+C 停止）\n');
const child = spawn(npmLine(['run', 'preview', '--', '--port', PORT, '--strictPort', '--open']), {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});
child.on('exit', (code) => process.exit(code === null ? 0 : code));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill();
    process.exit(0);
  });
}
