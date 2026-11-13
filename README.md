# ApkStart

<p align="center"><img src="docs/images/logo.png" alt="ApkStart Logo" width="160" /></p>

[![CI](https://github.com/zonbar/apkstart/actions/workflows/ci.yml/badge.svg)](https://github.com/zonbar/apkstart/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/zonbar/apkstart?include_prereleases&sort=semver)](https://github.com/zonbar/apkstart/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%2011%2B%20%7C%20Windows%2010%2F11-0078D6.svg)](#)

**macOS 原生版安卓应用运行器 —— 让 `.apk` 像 Mac 应用一样被安装和使用。**

> 本仓库在原版 ApkStart 基础上完成 macOS 移植（Apple Silicon / Intel 均可），Windows 分支完整保留，见文末「Windows 版」。原项目由 **RoutineMiku** 开发维护，MIT 许可。

## 特性

- 🖱️ **双击 .apk 即安装**：`Info.plist` 声明 `.apk` / `.xapk` / `.apks` 关联，在 Finder 里双击后由主进程 `open-file` 接管，自动解析 → 安装 → 生成应用图标，全程不出现模拟器界面。
- 🧩 **每个应用一个 `.app` 图标**：图标从 APK 内部离线提取，生成多尺寸 ICNS；双击图标直接启动对应应用，Dock 里出现的是它自己的名字和图标。
- 🪟 **应用就是一个窗口**：官方 Android Emulator 以带窗口模式启动（无头模式下 Android 不出 VSYNC，应用进程活着但屏幕上是空的），ApkStart 摆好标题、图标、竖屏比例与位置；**全屏**铺满屏幕高度并居中，**窗口模式**可自由拖动缩放且按应用记忆尺寸。
- 🔍 **开机登录与应用程序目录**：开机自动启动走 `setLoginItemSettings`，安装后同时创建桌面 + `~/Applications/ApkStart` 下的 `.app` 入口。
- 📁 **数据互通**：`~/ApkStartShared` ↔ 安卓内 `/sdcard/ApkStartShared` 持续双向同步，安卓应用存下的文件直接出现在本机。
- ⚡ **Apple Hypervisor Framework**：硬件加速走系统内置 HVF，无需安装任何驱动；Apple Silicon 用 `arm64-v8a` Android 14（API 34）镜像，Intel Mac 用 `x86_64` 镜像。
- 🪶 **极致轻量**：壳层零第三方运行时依赖（ZIP / PNG / ICO / ICNS / AXML 解析都是手写的），运行时按需下载、空闲自动回收，也可以完全复用机器上已有的安卓运行时。

![主界面](docs/images/app.png)

```
┌────────────────────────────────────────────────────────────┐
│  Finder 双击 .apk / 桌面 .app 图标                          │
│      │  open-file 或 --launch <包名>                       │
│      ▼                                                     │
│  ApkStart.app：解析 → 安装 → 生成 ICNS + .app 快捷方式      │
│      │  运行时未启动？→ 自动拉起（Android Emulator + API34）│
│      ▼                                                     │
│  MacAgent 定位独立模拟器窗口（标题 / 图标 / 竖屏比例 / 尺寸）│
└────────────────────────────────────────────────────────────┘
```

## 快速开始（macOS）

### 直接使用打包产物

到 [Releases](https://github.com/zonbar/apkstart/releases) 下载：

- **`ApkStart-<版本>-mac-arm64.dmg`**：拖进「应用程序」即可，含 DMG 安装视觉效果。
- **`ApkStart-<版本>-mac-arm64.zip`**：解压后把 `ApkStart.app` 拖进 `/Applications`。

首次启动显示「需要部署」是正常状态：点 **运行时 → 一键完成**，程序会按需下载 adb / Android Emulator / 系统镜像并自动开机，之后双击应用图标即无感启动。

打包产物为 ad-hoc 签名，本机可直接运行；若被 Gatekeeper 拦下，右键 `ApkStart.app` → **打开**，或执行：

```bash
xattr -d com.apple.quarantine /Applications/ApkStart.app
```

对外分发需要换成 Developer ID 签名并完成公证。

### 从源码构建

```bash
# 1. 安装依赖（含 Electron 运行时）
npm install

# 2. 开发调试
npm start

# 3. 单元测试
npm test

# 4. 生成 macOS 原生包
npm run build:mac
#   dist/ApkStart.app
#   dist/mac-release/ApkStart-<版本>-mac-arm64.dmg
#   dist/mac-release/ApkStart-<版本>-mac-arm64.zip
```

构建链路说明：

- `build/pack-mac.js` 直接复用 `node_modules/electron/dist/Electron.app`，用 `ditto` 原样复制以保留 Frameworks 的相对软链，注入 `Contents/Resources/app/` 与 `Info.plist` 的文件关联声明，最后整体 ad-hoc 重签并做 `codesign --verify --deep --strict`。
- `build/dist-mac.js` 用 `hdiutil` 生成 DMG、`ditto` 生成 ZIP；`build/mac-arch.js` 用 `lipo` 读主二进制真实架构，避免 arm64 包被命名成 x64。
- `build:mac:arm64` / `build:mac:x64` 通过 `APKSTART_MAC_ARCH` 指定目标；完整 `electron-builder` 配置见 `electron-builder.mac.yml`，对应命令 `npm run build:mac:builder*`。
- 图标由 `build/make-icns.js` 纯 Node 构造（内嵌 PNG chunk），不依赖 `iconutil` / `sips`。

## 运行时说明（macOS）

运行时组件全部由程序自己下载、校验和管理，用户数据目录为 `~/Library/Application Support/ApkStart`（可用环境变量 `APKSTART_DATA_DIR` 覆盖，隔离测试时很有用）。

| 组件 | 来源 | 用途 |
|---|---|---|
| adb（platform-tools） | `platform-tools-latest-darwin.zip`（dl.google.com 官方源） | 安装 / 启动 / 同步 / 截图 |
| Android Emulator | `emulator-darwin_aarch64`（Apple Silicon）/ `emulator-darwin_x64`（Intel） | 运行时引擎 |
| Android 14 系统镜像 | `arm64-v8a-34_r14.zip` / `x86_64-34_r14.zip` | 基础系统层，按 CPU 架构自动选择 |
| 硬件加速 | Apple Hypervisor Framework（`kern.hv_support`） | 系统内置，不需要 AEHD / WHPX 驱动 |

其它能力与 Windows 版一致：无硬件加速时自动回退软件模拟、启动失败按「渲染后端 → 加速方式 → 内存/冷启动」多组参数重试、内存与核心数按物理内存推导、大文件 8 线程分块 + 断点续传、容器式只读基础层 + 薄可写层、失败原因中文提示与诊断报告导出。

## macOS 与 Windows 的差异

| 环节 | Windows 实现 | macOS 实现 |
|---|---|---|
| 窗口嵌入 | `WinAgent` + PowerShell + `SetParent`（HWND） | `MacAgent` + AppleScript / System Events 定位独立窗口；不嵌入 Qt 窗口 |
| 快捷方式 | `.lnk` + `shell.writeShortcutLink` | 最小 `.app` bundle（`Contents/MacOS/launcher` + `Info.plist` + `app.icns`） |
| 图标 | 手写 ICO（DIB） | 手写 ICNS（`ic07` / `ic09` / `ic10` PNG chunk） |
| 文件关联 | `HKCU` 注册表 + `reg.exe` | `Info.plist` 的 `CFBundleDocumentTypes` + `app.on('open-file')` |
| 硬件加速 | WHPX / AEHD 驱动 | HVF（Apple Hypervisor Framework） |
| 进程与端口 | `tasklist` / `netstat` / `taskkill` / `wmic` | `ps` / `lsof` / `kill` / `renice` |
| 数据目录 | `%APPDATA%\apkstart` | `~/Library/Application Support/ApkStart` |
| 开机启动 | 注册表 Run 项 | `app.setLoginItemSettings` |
| 标题栏 | 自绘标题栏 + 右上三键（`titleBarOverlay`） | `hiddenInset` + 左上交通灯，标题栏左侧预留 84px 安全区 |
| 打包 | NSIS 安装版 EXE | `.app` / `.dmg` / `.zip` |

平台差异统一收敛在 `src/core/platform.js`（`IS_MAC` / `exe()` / `dataDir()` / `hypervisor()` / `killTree()` / `processList()` / `writeShortcut()` …），业务代码通过它取平台相关值，Windows 分支保持原样。

**已知边界**：`MacAgent` 用 AppleScript 摆放模拟器窗口，需要给 ApkStart 授予「辅助功能」权限；授权缺失时会静默降级为普通独立窗口。Windows 的全局鼠标钩子（`CGEventTap` 的对应物）没有移植，右键行为交回 Android 侧处理。

## 目录结构（移植相关）

```
apkstart/
├─ src/
│  ├─ main.js              主进程：窗口/托盘/单实例/open-file/IPC
│  ├─ preload.js           安全桥接（向渲染层暴露 platform / isMac）
│  ├─ ui/                  渲染层（原生 HTML/CSS/JS，无框架）
│  └─ core/
│     ├─ platform.js       ★ 跨平台差异层
│     ├─ agent.js          WinAgent + MacAgent
│     ├─ shortcut.js       ICO / ICNS 生成 + 快捷方式
│     ├─ provision.js      运行时下载（按平台选官方包）
│     └─ …                 zip / axml / arsc / apk / png / adb / engine / installer …
├─ src/ui/assets/appicon.icns   ★ macOS 应用图标
├─ build/
│  ├─ pack-mac.js          ★ 组装 .app + 重签
│  ├─ dist-mac.js          ★ 生成 DMG / ZIP
│  ├─ mac-arch.js          ★ 读取主二进制架构
│  └─ make-icns.js         ★ 纯 Node 生成 ICNS
├─ electron-builder.mac.yml    ★ macOS 打包配置（含 .apk 关联声明）
├─ test/                   单元测试 + 引擎链路测试（断言已做平台感知）
└─ scripts/assoc.js        .apk 关联命令行开关（mac 走 lsregister）
```

## 命令行与测试

```bash
npm test                        # 纯 Node 单元测试（不需要网络、不需要虚拟机）
npm run build:mac               # 生成 .app / .dmg / .zip
npm start                       # 开发模式启动
APKSTART_DATA_DIR=/tmp/apkstart-data npm start   # 用独立数据目录启动
electron . --smoke dist/smoke.png                # 界面冒烟截图
```

冒烟截图抓的是 webContents，不含 macOS 原生交通灯；受限环境下需用独立 `--user-data-dir` 绕开陈旧 `SingletonLock`，必要时加 `--no-sandbox --disable-gpu`。

CI 目前仍在 Windows runner 上跑 `npm ci && npm test`；macOS 上同一套测试已本地跑通（3 / 24 / 39 三组全绿）。

## 设计取舍（诚实说明）

- **不是从零实现的 hypervisor**：安卓内核、GPU 转译、ART 运行时是数年级别的工程，本项目站在 AOSP / QEMU / adb 的肩膀上，把工程量集中在「原生应用级体验」。
- **macOS 不做窗口嵌入**：`SetParent` 是 Win32 专有，强行用辅助功能 API 模拟既脆弱又侵入；改为独立窗口 + AppleScript 定位，代价是需要「辅助功能」授权。
- **共享目录是同步而非挂载**：安卓侧无法直接挂载宿主目录，采用秒级双向同步达到同等体验。
- **ARM-only 应用 / 字节系应用**：设置里开启「ARM 兼容模式」可切换到 Android 14（API 34）镜像，仅含 ARM 原生库的应用可以安装运行；个别应用自带更深的反模拟检测仍可能受限，安装失败或启动崩溃时会给出中文说明。

## Windows 版

Windows 分支完整保留：`.lnk` 快捷方式、ICO 图标、注册表 `.apk` 关联、WHPX / AEHD 加速、NSIS 安装包都照旧可用。

```powershell
npm install
npm run pack          # 便携版 dist/ApkStart-win64-portable/ApkStart.exe
npm run build:exe     # 内置完整运行时的安装版 EXE
npm run assoc:on      # 注册 .apk 双击安装
```

原始 Windows 实现的架构细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；该文件描述的是 Windows 链路，macOS 差异以本文档的对照表为准。

## 关于作者

ApkStart 由 **RoutineMiku** 开发维护，macOS 移植在 fork 中完成。

- 上游：<https://github.com/RoutineMiku/apkstart>
- 本仓库：<https://github.com/zonbar/apkstart>
- 微信公众号：扫码关注

<p align="center"><img src="docs/images/brand.png" alt="关于面板：公众号二维码与项目链接" width="560" /></p>

<p align="center"><i>Powered by <b>RoutineMiku</b></i></p>

## 参与贡献

欢迎 Issue / PR。壳层保持零第三方运行时依赖，提交前请跑 `npm test`；细节见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)。发行包只含 ApkStart 自身代码与 Electron 运行时，不分发安卓系统镜像、QEMU 二进制或 Google 组件；这些由用户本机首次启动时从官方源按需下载，遵循各自的许可协议。
