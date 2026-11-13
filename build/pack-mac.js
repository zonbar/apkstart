#!/usr/bin/env node
'use strict';
/**
 * macOS 便携版打包：把 Electron.app 变成 ApkStart.app（无需 electron-builder）。
 * 产物：dist/ApkStart.app，可直接拖进 /Applications，双击即用。
 *
 * 与 electron-builder 的 dmg 版互补：这个脚本只做「源码 + 运行时壳」的最简组装，
 * adb / emulator / 系统镜像仍由应用首次启动时按需下载。
 *
 * 用法：node build/pack-mac.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC_APP = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_APP = path.join(OUT_DIR, 'ApkStart.app');

if (process.platform !== 'darwin') {
  console.error('这个脚本只能在 macOS 上运行');
  process.exit(1);
}
if (!fs.existsSync(SRC_APP)) {
  console.error('缺少 Electron.app，请先执行 npm install');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
// 旧产物改名保留，全程不做删除：某些运行环境会给 fs.rmSync 挂删除守卫
if (fs.existsSync(OUT_APP)) {
  try { fs.renameSync(OUT_APP, path.join(OUT_DIR, `.ApkStart.prev-${Date.now()}.app`)); } catch (_) { /* ignore */ }
}
console.log('复制 Electron.app → ApkStart.app …');
// 必须用 ditto 原样复制 bundle。Electron 的 Frameworks 靠 Versions/Current → A 这类
// 相对符号链接组织；fs.cpSync 无论 dereference 开或关，都会把它们改写成
// 指向 node_modules 源目录的绝对链接（或解引用成实体），结果是
// codesign 报「unsealed contents present in the root directory of an embedded framework」、
// 签名失效 → Electron Helper 代码签名校验失败 → SIGTRAP 崩溃 → 双击闪退。
execFileSync('/usr/bin/ditto', [SRC_APP, OUT_APP], { stdio: 'pipe' });

const CONTENTS = path.join(OUT_APP, 'Contents');
const RES = path.join(CONTENTS, 'Resources');
const APP_DIR = path.join(RES, 'app');

// 产物命名必须和真实二进制架构一致，避免 arm64 的 app 被打成 x64 包。
const { appArch } = require('./mac-arch');
const BIN_ARCH = appArch(OUT_APP);
const WANT_ARCH = process.env.APKSTART_MAC_ARCH || '';
if (WANT_ARCH && WANT_ARCH !== BIN_ARCH && !(WANT_ARCH === 'x64' && BIN_ARCH === 'universal')) {
  console.error([
    `架构不匹配：请求 ${WANT_ARCH}，但 node_modules/electron/dist/Electron.app 是 ${BIN_ARCH}。`,
    '请先安装对应架构的 Electron，例如：',
    `  npm install --no-save electron@33.4.11 --arch=${WANT_ARCH === 'arm64' ? 'arm64' : 'x64'}`,
    '再重新打包；或直接执行 npm run build:mac（按当前运行时架构出包）。',
  ].join('\n'));
  process.exit(1);
}
console.log(`Electron 运行时架构：${BIN_ARCH}`);

// 防回归：bundle 内不允许出现指向外部（绝对路径）的符号链接。
function absoluteSymlinks(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        const t = fs.readlinkSync(p);
        if (path.isAbsolute(t)) out.push(`${path.relative(OUT_APP, p)} -> ${t}`);
      } else if (e.isDirectory() && p !== APP_DIR) {
        walk(p);
      }
    }
  };
  walk(root);
  return out;
}
const badLinks = absoluteSymlinks(CONTENTS);
if (badLinks.length) {
  console.error('复制后出现绝对符号链接，签名会失效、启动时 Helper 会崩溃：\n  ' + badLinks.slice(0, 8).join('\n  '));
  process.exit(1);
}
console.log('符号链接检查：无绝对路径链接');

// Electron 的查找顺序是 app.asar → app/ → default_app.asar，
// 只要放好 Contents/Resources/app/ 就会优先加载，不必删自带的默认应用。
fs.mkdirSync(APP_DIR, { recursive: true });

const COPY_DIRS = ['src'];
const COPY_FILES = ['package.json', 'LICENSE'];
for (const d of COPY_DIRS) fs.cpSync(path.join(ROOT, d), path.join(APP_DIR, d), { recursive: true });
for (const f of COPY_FILES) {
  if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(APP_DIR, f));
}

// 镜像解压用的原生包（有就带上，没有时运行时会走 gzip 分支）
const nmRoot = path.join(ROOT, 'node_modules');
for (const name of fs.existsSync(path.join(nmRoot, '@napi-rs')) ? fs.readdirSync(path.join(nmRoot, '@napi-rs')) : []) {
  if (!/^lzma/.test(name)) continue;
  const from = path.join(nmRoot, '@napi-rs', name);
  const to = path.join(APP_DIR, 'node_modules', '@napi-rs', name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

// 图标
const ICON = path.join(ROOT, 'src', 'ui', 'assets', 'appicon.icns');
if (!fs.existsSync(ICON)) {
  console.log('未找到 appicon.icns，先生成…');
  execFileSync(process.execPath, [path.join(__dirname, 'make-icns.js')], { stdio: 'inherit' });
}
fs.copyFileSync(ICON, path.join(RES, 'appicon.icns'));

// Info.plist：改名字 / bundle id / 图标，并声明 .apk 文件关联
const PLIST = path.join(CONTENTS, 'Info.plist');
let plist = fs.readFileSync(PLIST, 'utf8');
const rep = (key, val) => {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (re.test(plist)) plist = plist.replace(re, `$1${val}$2`);
};
rep('CFBundleName', 'ApkStart');
rep('CFBundleDisplayName', 'ApkStart');
rep('CFBundleIdentifier', 'com.apkstart.mac');
rep('CFBundleIconFile', 'appicon.icns');

const docTypes = `  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Android Package</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>CFBundleTypeExtensions</key><array><string>apk</string></array>
      <key>LSHandlerRank</key><string>Owner</string>
    </dict>
    <dict>
      <key>CFBundleTypeName</key><string>Android Split Package</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>CFBundleTypeExtensions</key><array><string>xapk</string><string>apks</string></array>
      <key>LSHandlerRank</key><string>Default</string>
    </dict>
  </array>
`;
if (!plist.includes('CFBundleDocumentTypes')) {
  plist = plist.replace(/\s*<\/dict>\s*<\/plist>/, `\n${docTypes}</dict>\n</plist>`);
}
fs.writeFileSync(PLIST, plist, 'utf8');

// 改过 Info.plist、往 Resources/app 放了代码后，原签名已经失效。
// 必须整体重签：否则 Electron Helper (GPU/Renderer) 代码签名校验失败，
// 进程 SIGTRAP 崩溃，表现出来就是「双击后立即闪退」。
// 默认强制重签并校验，不再静默跳过；失败就中止，绝不交付会闪退的包。
const signArgs = ['--force', '--deep', '--sign', '-', '--timestamp=none', OUT_APP];
try {
  execFileSync('/usr/bin/codesign', signArgs, { stdio: 'pipe' });
  console.log('ad-hoc 整体重签完成');
} catch (e) {
  const msg = String((e.stderr && e.stderr.toString()) || e.message || '').trim().split('\n')[0];
  console.error('重签失败，产物会在启动时闪退，已中止打包：', msg);
  console.error(`可手动执行：codesign --force --deep --sign - --timestamp=none "${OUT_APP}"`);
  process.exit(1);
}
try {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', OUT_APP], { stdio: 'pipe' });
  console.log('签名校验通过（--deep --strict）');
} catch (e) {
  const msg = String((e.stderr && e.stderr.toString()) || e.message || '').trim().split('\n')[0];
  console.error('签名校验未通过，已中止打包：', msg);
  process.exit(1);
}

console.log(`完成：${OUT_APP}`);
console.log('可直接双击运行，或拖进 /Applications 后双击 .apk 安装应用。');
