/* 各平台共用的浏览器探测；CHROME_PATH 优先。 */
const fs = require('node:fs');
const path = require('node:path');
const candidates = [
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
module.exports = candidates.filter(Boolean).find((file) => fs.existsSync(file));
if (!module.exports) throw new Error('未找到 Chrome/Chromium，请设置 CHROME_PATH');
