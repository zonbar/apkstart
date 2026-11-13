#!/usr/bin/env node
'use strict';
/**
 * .apk 关联命令行开关（无需启动界面）
 *   node scripts/assoc.js on   → 注册双击 APK 安装
 *   node scripts/assoc.js off  → 取消关联
 */
const path = require('path');
const fs = require('fs');
const { registerAssociation, unregisterAssociation } = require('../src/core/assoc');

const P = require('../src/core/platform');
const action = process.argv[2] || 'on';

if (P.IS_MAC) {
  // macOS 没有 HKCU 注册表：关联写死在打包期的 Info.plist CFBundleDocumentTypes，
  // 双击 .apk 由 LaunchServices 通过 app.on('open-file') 交给主进程。
  if (action === 'on') {
    console.log('macOS 的 .apk / .xapk / .apks 关联由 ApkStart.app 的 Info.plist 声明，安装后自动生效。');
    console.log('如需立即刷新 LaunchServices：');
    console.log('  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -R -f -v /Applications/ApkStart.app');
    P.refreshShell().catch(() => {});
  } else if (action === 'off') {
    console.log('macOS 无法从命令行取消静态文件关联：请在 Finder 的「显示简介 → 打开方式」里改，或卸载 ApkStart.app。');
  } else {
    console.log('用法：node scripts/assoc.js [on|off]');
    process.exit(1);
  }
} else {
  const isDev = !process.env.APKSTART_PACKAGED;
  const exe = isDev
    ? path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe')
    : process.execPath;
  const appDir = path.join(__dirname, '..');

  if (action === 'on') {
    const iconPath = path.join(__dirname, '..', 'build', 'apkstart.ico');
    const r = registerAssociation(exe, fs.existsSync(iconPath) ? iconPath : undefined,
      isDev ? `"${appDir}"` : undefined);
    console.log('已注册 .apk 关联：', r.progId);
    console.log('现在在 Finder / 文件管理器中双击 .apk 即可安装到 ApkStart。');
  } else if (action === 'off') {
    unregisterAssociation();
    console.log('已取消 .apk 关联。');
  } else {
    console.log('用法：node scripts/assoc.js [on|off]');
    process.exit(1);
  }
}
