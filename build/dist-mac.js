#!/usr/bin/env node
'use strict';
/**
 * 把 dist/ApkStart.app 打成可分发的 DMG 与 ZIP。
 * 不依赖 electron-builder：只用 macOS 自带的 hdiutil / ditto，
 * 也不需要任何构建期临时下载。
 *
 * 用法：node build/dist-mac.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'dist', 'ApkStart.app');
const OUT = path.join(ROOT, 'dist', 'mac-release');
const VERSION = require('../package.json').version;
const ARCH = require('./mac-arch').appArch(APP);
const BASE = `ApkStart-${VERSION}-mac-${ARCH}`;
const DMG = path.join(OUT, `${BASE}.dmg`);
const ZIP = path.join(OUT, `${BASE}.zip`);
const STAGE = path.join(OUT, `.stage-${ARCH}`);

if (process.platform !== 'darwin') {
  console.error('这个脚本只能在 macOS 上运行');
  process.exit(1);
}
if (!fs.existsSync(APP)) {
  console.error('缺少 dist/ApkStart.app，请先执行 node build/pack-mac.js');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
// 旧产物改名保留，不做删除（部分运行环境会给 fs.rmSync 挂删除守卫）
const rotate = (p) => {
  if (fs.existsSync(p)) {
    try { fs.renameSync(p, `${p}.prev-${Date.now()}`); } catch (_) { /* ignore */ }
  }
};
rotate(STAGE);
rotate(DMG);
rotate(ZIP);
fs.mkdirSync(STAGE, { recursive: true });

console.log('准备 DMG 内容…');
// 保留符号链接：cpSync 会把 Frameworks 的相对链接改成绝对路径，破坏签名。
execFileSync('/usr/bin/ditto', [APP, path.join(STAGE, 'ApkStart.app')], { stdio: 'pipe' });
try { fs.symlinkSync('/Applications', path.join(STAGE, 'Applications')); } catch (_) { /* ignore */ }

let dmgOk = false;
try {
  console.log('生成 DMG…');
  execFileSync('/usr/bin/hdiutil', [
    'create', '-volname', 'ApkStart', '-srcfolder', STAGE,
    '-ov', '-format', 'UDZO', DMG,
  ], { stdio: 'pipe' });
  dmgOk = fs.existsSync(DMG);
} catch (e) {
  const msg = String((e.stderr && e.stderr.toString()) || e.message || '').trim().split('\n')[0];
  console.warn('DMG 生成被当前环境拒绝（不影响 .app / ZIP）：', msg);
}
if (dmgOk) {
  console.log('DMG:', DMG, `${(fs.statSync(DMG).size / 1048576).toFixed(1)} MB`);
  try {
    const info = execFileSync('/usr/bin/hdiutil', ['imageinfo', DMG], { encoding: 'utf8', stdio: 'pipe' });
    console.log('DMG 校验:', /Format:\s*UDZO/.test(info) ? 'UDZO 压缩镜像 OK' : '已生成');
  } catch (_) { /* 校验失败不影响产物 */ }
}

console.log('生成 ZIP…');
// 不带资源分支 / 扩展属性 / 隔离标记：ZIP 里不会出现 __MACOSX 噪声，
// 解压到别的 Mac 上也不会被误判为「来自未知开发者以外的下载隔离」。
execFileSync('/usr/bin/ditto', [
  '-c', '-k', '--norsrc', '--noextattr', '--noqtn', '--keepParent', APP, ZIP,
], { stdio: 'pipe' });
console.log('ZIP:', ZIP, `${(fs.statSync(ZIP).size / 1048576).toFixed(1)} MB`);

console.log(`\n完成（${ARCH}）：`);
console.log(`  APP: ${APP}`);
if (dmgOk) console.log(`  DMG: ${DMG}`);
console.log(`  ZIP: ${ZIP}`);
if (!dmgOk) {
  console.log('\n如需 DMG，可在有完整磁盘挂载权限的会话里执行：');
  console.log(`  hdiutil create -volname ApkStart -srcfolder "${STAGE}" -ov -format UDZO "${DMG}"`);
}
