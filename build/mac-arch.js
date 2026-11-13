#!/usr/bin/env node
'use strict';
/**
 * 读取 .app 里 Electron 主二进制的真实 CPU 架构。
 * 不看 process.arch：打包脚本可能跑在 Rosetta 下，或者用户装的是另一架构的 Electron。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function appArch(appPath) {
  const bin = path.join(appPath, 'Contents', 'MacOS', 'Electron');
  if (fs.existsSync(bin)) {
    try {
      const s = execFileSync('/usr/bin/lipo', ['-archs', bin], { encoding: 'utf8', stdio: 'pipe' });
      if (/\bx86_64\b/.test(s) && /\barm64\b/.test(s)) return 'universal';
      if (/\barm64\b/.test(s)) return 'arm64';
      if (/\bx86_64\b/.test(s)) return 'x64';
    } catch (_) { /* 换 file 再试 */ }
    try {
      const s = execFileSync('/usr/bin/file', ['-b', bin], { encoding: 'utf8', stdio: 'pipe' });
      if (/arm64/.test(s)) return 'arm64';
      if (/x86_64/.test(s)) return 'x64';
    } catch (_) { /* ignore */ }
  }
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

module.exports = { appArch };
