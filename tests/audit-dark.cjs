/* 深色主题像素级审计：截图后解码 PNG，找出所有仍然偏亮的像素区域 */
const { chromium } = require('playwright-core');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');

const CHROME = require('./browser-path.cjs');
const APP = 'http://127.0.0.1:4173/';

/* ---- 极简 PNG 解码（Chromium 截图：8bit RGBA、非隔行） ---- */
function decodePNG(buf) {
  let pos = 8; // skip signature
  let width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
      if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth + ' not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error('unsupported colorType ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

/* ---- 亮像素聚类成矩形块 ---- */
function findLightRegions(img, threshold = 170, minPixels = 12) {
  const { width, height, channels, data } = img;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const a = channels === 4 ? data[i + 3] : 255;
      if (a < 128) continue;
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (avg > threshold) mask[y * width + x] = 1;
    }
  }
  // 逐行找连续段，再按 y 相邻合并成块
  const regions = [];
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (!mask[y * width + x]) { x++; continue; }
      const x0 = x;
      while (x < width && mask[y * width + x]) x++;
      const x1 = x - 1;
      // 尝试合并到已有块（同一 x 范围、上一行相邻）
      let merged = false;
      for (const r of regions) {
        if (r.y1 === y - 1 && Math.abs(r.x0 - x0) <= 2 && Math.abs(r.x1 - x1) <= 2) {
          r.y1 = y; r.count += x1 - x0 + 1; merged = true; break;
        }
      }
      if (!merged) regions.push({ x0, x1, y0: y, y1: y, count: x1 - x0 + 1 });
    }
  }
  return regions.filter((r) => r.count >= minPixels).sort((a, b) => b.count - a.count);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1080, height: 600 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('excel-tool:theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const png = await page.screenshot();
  const outDir = path.join(__dirname, '..', '.e2e-downloads');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'audit-dark.png'), png);
  const img = decodePNG(png);
  const regions = findLightRegions(img);
  console.log('图片尺寸:', img.width + 'x' + img.height);
  console.log('亮色区块数:', regions.length);
  regions.slice(0, 20).forEach((r) => {
    console.log(`  块: x=${r.x0}..${r.x1} y=${r.y0}..${r.y1} 尺寸=${r.x1 - r.x0 + 1}x${r.y1 - r.y0 + 1} 像素=${r.count}`);
  });
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
