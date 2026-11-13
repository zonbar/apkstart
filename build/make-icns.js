'use strict';
/**
 * 生成 macOS 应用图标 appicon.icns。
 *
 * 不依赖 iconutil / sips / 图像处理库：icns 本身只是一个容器，
 * 从 10.7 起允许直接内嵌 PNG 数据（chunk 类型 ic07/ic08/ic09/ic10）。
 * 仓库里已有 128 / 512 / 1024 三档 PNG，按尺寸装进对应的 chunk 即可，
 * 系统会自动为 Dock / Finder / 关于面板缩放到其它尺寸。
 *
 * 用法：node build/make-icns.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'ui', 'assets', 'appicon.icns');

// PNG chunk 类型 -> 期望像素尺寸 -> 仓库里现成的 PNG
const ENTRIES = [
  { type: 'ic07', size: 128, file: 'src/ui/assets/logo-128.png' },
  { type: 'ic09', size: 512, file: 'src/ui/assets/logo.png' },
  { type: 'ic10', size: 1024, file: 'docs/images/logo.png' },
];

function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.write(type, 0, 4, 'ascii');
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
}

const parts = [];
for (const e of ENTRIES) {
  const file = path.join(ROOT, e.file);
  if (!fs.existsSync(file)) continue;
  const png = fs.readFileSync(file);
  const dim = pngSize(png);
  if (!dim || dim.w !== e.size || dim.h !== e.size) {
    console.warn(`跳过 ${e.file}：期望 ${e.size}x${e.size}，实际 ${dim ? `${dim.w}x${dim.h}` : '非 PNG'}`);
    continue;
  }
  parts.push(chunk(e.type, png));
  console.log(`${e.type} <- ${e.file} (${e.size}x${e.size})`);
}

if (!parts.length) {
  console.error('没有可用的 PNG，无法生成 icns');
  process.exit(1);
}

const body = Buffer.concat(parts);
const head = Buffer.alloc(8);
head.write('icns', 0, 4, 'ascii');
head.writeUInt32BE(body.length + 8, 4);
fs.writeFileSync(OUT, Buffer.concat([head, body]));
console.log(`已生成 ${OUT} (${(body.length + 8) / 1024 | 0} KB, ${parts.length} 个 PNG chunk)`);
