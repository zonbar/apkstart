'use strict';
/**
 * 平台差异层（Windows / macOS）
 *
 * 把与操作系统绑定的原语集中在这里：可执行文件名、数据目录、进程与端口查询、
 * 硬件加速模型、桌面快捷方式、文件关联刷新。业务模块只依赖这一层。
 *
 * Windows 侧行为保持与原版一致；macOS 侧给出等价实现：
 *   .lnk            -> 最小 .app bundle
 *   HKCU 注册表关联 -> 打包期 Info.plist CFBundleDocumentTypes
 *   WHPX / AEHD     -> Apple Hypervisor Framework (HVF)
 *   taskkill/netstat -> kill(2) / lsof
 *   SHChangeNotify  -> lsregister
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_ARM = process.arch === 'arm64';
const EXE_SUFFIX = IS_WIN ? '.exe' : '';

/** 'emulator' -> 'emulator.exe'(win) / 'emulator'(mac, linux) */
function exe(name) {
  if (!name) return name;
  if (!EXE_SUFFIX) return name;
  return name.endsWith(EXE_SUFFIX) ? name : name + EXE_SUFFIX;
}

function dataDir() {
  // 测试 / 便携部署可以显式指定数据目录
  if (process.env.APKSTART_DATA_DIR) return process.env.APKSTART_DATA_DIR;
  if (IS_WIN) {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'apkstart');
  }
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'ApkStart');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'apkstart');
}

/** Windows 开始菜单在 mac 上的等价物：用户级「应用程序」目录（Spotlight 可搜到） */
function startMenuDir(appData) {
  if (IS_MAC) return path.join(os.homedir(), 'Applications', 'ApkStart');
  return path.join(appData || process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}

// Apple Silicon 的 Android Emulator 必须配 arm64-v8a 系统镜像（x86_64 只能 TCG 软模拟）。
// Intel Mac 与 Windows 继续用 x86_64。
const SYSIMG_ABI = (IS_MAC && IS_ARM) ? 'arm64-v8a' : 'x86_64';
const SYSIMG_TAG = 'google_apis_playstore';
const SYSIMG_API = '34';
const ACCEL_NAME = IS_MAC ? 'hvf' : 'whpx';

function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** 硬件加速能力。whpx 字段沿用原有数据结构，这里表示「有可用的硬件加速」。 */
function hypervisor() {
  if (!IS_MAC) return { whpx: false, hvf: false, dll: false, note: '非 macOS 平台' };
  let ok = false;
  try {
    ok = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.hv_support'],
      { encoding: 'utf8', timeout: 3000 }).trim() === '1';
  } catch (_) { /* 该键不存在时视为不可用 */ }
  return {
    whpx: ok, hvf: ok, dll: ok, accel: 'hvf',
    note: ok
      ? 'Apple Hypervisor Framework（系统内置，无需安装驱动）'
      : '未检测到 HVF，将回退软件模拟',
  };
}

/** 杀掉一棵进程树 */
async function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) {
    await exec('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch (_) { /* 已退出 */ }
  try { process.kill(-pid, 'SIGTERM'); } catch (_) { /* 不是组长 */ }
  await new Promise((r) => setTimeout(r, 300));
  try { process.kill(pid, 'SIGKILL'); } catch (_) { /* 已退出 */ }
  try { process.kill(-pid, 'SIGKILL'); } catch (_) { /* 不是组长 */ }
}

/** 当前进程列表 [{ name, pid }] */
async function processList() {
  if (IS_WIN) {
    const r = await exec('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true });
    return r.stdout.split('\n').map((l) => {
      const m = /^"([^"]+)","(\d+)"/.exec(l.trim());
      return m ? { name: m[1], pid: Number(m[2]) } : null;
    }).filter(Boolean);
  }
  const r = await exec('/bin/ps', ['-axo', 'pid=,comm=']);
  return r.stdout.split('\n').map((l) => {
    const m = /^\s*(\d+)\s+(.+)$/.exec(l);
    return m ? { name: path.basename(m[2].trim()), pid: Number(m[1]) } : null;
  }).filter(Boolean);
}

/** 所有 TCP LISTEN 端口 [{ pid, port }] */
async function listeningPorts() {
  if (IS_WIN) {
    const r = await exec('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true });
    const out = [];
    for (const line of r.stdout.split('\n')) {
      const m = /:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
      if (m) out.push({ port: Number(m[1]), pid: Number(m[2]) });
    }
    return out;
  }
  const r = await exec('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']);
  const out = [];
  let pid = 0;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1)) || 0;
    else if (line.startsWith('n')) {
      const m = /:(\d+)$/.exec(line);
      if (m && pid) out.push({ port: Number(m[1]), pid });
    }
  }
  return out;
}

async function pidOnPort(port) {
  if (IS_WIN) {
    const rows = await listeningPorts();
    const hit = rows.find((r) => r.port === Number(port));
    return hit ? hit.pid : 0;
  }
  const r = await exec('/usr/sbin/lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
  return Number(r.stdout.trim().split('\n')[0]) || 0;
}

/** 降低模拟器进程优先级（Windows 由 priority.ps1 负责，这里只处理 macOS） */
async function setPriority(level, avdName) {
  if (!IS_MAC) return 0;
  const nice = level === 'idle' ? 20 : level === 'below' ? 10 : 0;
  const r = await exec('/bin/ps', ['-axo', 'pid=,command=']);
  let changed = 0;
  for (const line of r.stdout.split('\n')) {
    if (!avdName || !line.includes(avdName)) continue;
    const m = /^\s*(\d+)\s/.exec(line);
    if (!m) continue;
    // eslint-disable-next-line no-await-in-loop
    const q = await exec('/usr/bin/renice', [String(nice), '-p', m[1]]);
    if (q.ok) changed += 1;
  }
  return changed;
}

/** 刷新 LaunchServices / Finder（等价于 Windows 的 SHChangeNotify） */
function refreshShell(appPath) {
  if (!IS_MAC) return Promise.resolve();
  const bin = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  return exec(bin, ['-R', '-f', '-v', appPath || ''], { timeout: 15000 });
}

/** .apk 关联状态：macOS 由 Info.plist 静态声明，development 模式同样按已注册处理 */
function assocStatus(skipped, progId) {
  if (!IS_MAC) return null;
  if (skipped) return { registered: true, skipped: true };
  return { registered: true, progId: progId || 'ApkStart.apk', note: '由 Info.plist 声明' };
}

/** PNG -> icns。icns 只是容器，10.7+ 允许内嵌 PNG，无需 iconutil / sips。 */
function pngToIcns(png) {
  let nativeImage = null;
  try { nativeImage = require('electron').nativeImage; } catch (_) { /* 非 Electron 进程 */ }
  if (!nativeImage || !Buffer.isBuffer(png) || !png.length) return null;
  const sizes = [{ type: 'ic07', px: 128 }, { type: 'ic09', px: 512 }, { type: 'ic10', px: 1024 }];
  const parts = [];
  for (const s of sizes) {
    let buf;
    try {
      buf = nativeImage.createFromBuffer(png)
        .resize({ width: s.px, height: s.px, quality: 'best' }).toPNG();
    } catch (_) { continue; }
    const head = Buffer.alloc(8);
    head.write(s.type, 0, 4, 'ascii');
    head.writeUInt32BE(buf.length + 8, 4);
    parts.push(head, buf);
  }
  if (!parts.length) return null;
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

function xmlEscape(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function shQuote(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

/**
 * macOS 桌面快捷方式：生成一个最小 .app bundle 替代 .lnk。
 * LaunchServices 只认 bundle；Info.plist 指向一个 shell launcher，
 * 把 --launch <包名> 直接交给主程序二进制。
 */
function writeShortcut(opt) {
  const appDir = opt.shortcutPath;
  const name = path.basename(appDir, '.app') || 'ApkStartApp';
  const contents = path.join(appDir, 'Contents');
  const macos = path.join(contents, 'MacOS');
  const resources = path.join(contents, 'Resources');
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });

  const launcherPath = path.join(macos, 'launcher');
  const cwd = opt.cwd || path.dirname(opt.target);
  const args = String(opt.args || '').trim();
  fs.writeFileSync(launcherPath,
    `#!/bin/sh\ncd "${shQuote(cwd)}" 2>/dev/null || true\nexec "${shQuote(opt.target)}" ${args}\n`,
    { mode: 0o755 });
  try { fs.chmodSync(launcherPath, 0o755); } catch (_) { /* ignore */ }

  let icns = null;
  const srcIcon = opt.iconIcoPath || opt.iconPngPath;
  if (srcIcon && fs.existsSync(srcIcon)) {
    const raw = fs.readFileSync(srcIcon);
    if (/\.icns$/i.test(srcIcon)) icns = raw;
    else if (/\.png$/i.test(srcIcon)) icns = pngToIcns(raw);
  }
  if (!icns) {
    const brand = path.join(__dirname, '..', 'ui', 'assets', 'appicon.icns');
    if (fs.existsSync(brand)) icns = fs.readFileSync(brand);
  }
  if (icns) fs.writeFileSync(path.join(resources, 'app.icns'), icns);

  const bundleId = `com.apkstart.app.${name.replace(/[^A-Za-z0-9.-]/g, '.').replace(/\.+/g, '.')}`.slice(0, 96);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIdentifier</key><string>${xmlEscape(bundleId)}</string>
  <key>CFBundleName</key><string>${xmlEscape(name)}</string>
  <key>CFBundleDisplayName</key><string>${xmlEscape(name)}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>${icns ? 'app.icns' : ''}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(contents, 'Info.plist'), plist, 'utf8');
  try { execFileSync('/usr/bin/touch', [appDir], { timeout: 3000 }); } catch (_) { /* ignore */ }
  refreshShell(appDir).catch(() => {});
  return appDir;
}

/** macOS 上删除快捷方式要连 bundle 一起删 */
function removeShortcut(p) {
  try {
    if (p && fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  IS_MAC, IS_WIN, IS_ARM, EXE_SUFFIX,
  SYSIMG_ABI, SYSIMG_TAG, SYSIMG_API, ACCEL_NAME,
  exe, dataDir, startMenuDir, hypervisor,
  killTree, processList, listeningPorts, pidOnPort, setPriority,
  refreshShell, assocStatus, pngToIcns,
  writeShortcut, removeShortcut,
};
