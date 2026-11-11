import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/*
 * Luckysheet 的官方插件包（spectrum 取色器 / jQuery UI / sPage 等）只以经典 script 形式分发，
 * 且其 UMD 在打包环境下不会把插件挂到全局 jQuery 上，因此必须原样以 <script> 引入。
 * 这里在 dev / build 启动时把它同步到 public/，保证始终与 node_modules 中的版本一致。
 */
function syncLuckysheetPlugin() {
  const src = path.resolve(rootDir, 'node_modules/luckysheet/dist/plugins/js/plugin.js');
  const dest = path.resolve(rootDir, 'public/luckysheet-plugin.js');
  return {
    name: 'sync-luckysheet-plugin',
    buildStart() {
      try {
        if (!fs.existsSync(src)) return;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const a = fs.readFileSync(src);
        if (fs.existsSync(dest) && Buffer.compare(fs.readFileSync(dest), a) === 0) return;
        fs.writeFileSync(dest, a);
      } catch (e) {
        this.warn('同步 luckysheet 插件包失败：' + e.message);
      }
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    global: 'window',
  },
  plugins: [syncLuckysheetPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
