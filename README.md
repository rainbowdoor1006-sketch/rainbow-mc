# RAINBOW MC 启动器

一款开源 Minecraft 启动器（Windows）。
目标是**装上就能玩**：不用自己配 Java、不用手动装加载器、不用翻教程。

![LOGO](assets/brand/logo-256.png)

## 特性

- **版本管理**：安装任意原版版本（正式 / 快照 / 远古），导入现有 `.minecraft`
- **加载器一键装**：Forge / NeoForge / Fabric / Quilt
- **自动补齐**：启动前检查并补齐缺失的库文件、客户端 jar、游戏资源（语言 / 声音 / 字体）
- **整合包导入**：拖拽即可
  - Modrinth `.mrpack`
  - CurseForge 整合包 `.zip`（**免 API Key**，按 projectID/fileID 解析直链下载）
  - 本启动器导出的整合包
- **资源下载**：Modrinth 搜索与下载（模组 / 整合包 / 光影 / 资源包），支持"按当前项目筛选"
- **组件库**：下载的资源集中管理，可应用到任意项目，带引用计数
- **账号**：离线登录（填昵称即可游玩单机与离线服务器）
- **个性化**：自定义背景图、头像、主题色
- **自动更新**：启动检查更新、静默安装、保留全部存档
- **日志与诊断**：每次启动生成 ZIP 日志，含启动阶段打点、崩溃特征分类、修复建议
- **兼容自愈**：自动关闭 Forge 早期窗口、自动登记高性能 GPU、崩溃后自动禁用渲染优化模组

## 下载

最新安装包见 [Releases](../../releases/latest)。

系统要求：Windows 10 / 11 x64。首次启动会自动下载 Java 运行时与游戏资源。

## 从源码构建

需要 Node.js 20+（建议 22）与 pnpm 或 npm。

```bash
cd app
npm install

# 开发模式（热更新）
npm run dev

# 类型检查
npx tsc --noEmit

# 打包 NSIS 安装包（产物在 app/release/）
npm run build
npx electron-builder --win nsis
```

打包产物：`app/release/RAINBOWMC-<version>-setup.exe`

## 技术栈

- Electron 33 + React 18 + TypeScript
- electron-vite 构建，主进程 / preload / 渲染进程三层隔离
- 自研 Minecraft 版本安装与启动链路（版本链合并、库与资源补齐、natives 解压）
- NSIS 安装器：覆盖安装/卸载始终保留 `data/`（存档、组件库、游戏文件）

## 目录结构

```
app/
├── src/
│   ├── main/                 主进程（文件、网络、进程管理）
│   │   ├── paths.ts          数据根解析（开发/安装版/便携版）
│   │   ├── store.ts          config.json 读写与备份
│   │   ├── update.ts         版本检查与静默更新
│   │   └── minecraft/        版本安装、启动、整合包、组件库、账号、日志
│   ├── preload/              contextBridge 暴露 window.api
│   ├── renderer/             React 界面
│   └── shared/               主/渲染共享类型
├── build/                    图标、NSIS 脚本、三语言许可
└── release/                  打包产物（不入库）
```

完整功能说明与架构设计见 [`docs/RAINBOW-MC-功能介绍与架构.md`](docs/RAINBOW-MC-功能介绍与架构.md)。

## 关于 PCL2 的借鉴

核心机制借鉴过 **PCL2（Plain Craft Launcher 2）** 的做法，作者是 **龙腾猫跃**：

| PCL2 的做法 | RAINBOW MC 的实现 |
|---|---|
| 版本隔离 | 每个项目独立目录，mods / saves / config 全在 data/games/<项目>/ |
| 组件库（共享 + 引用计数） | data/libraries/ + library.json，记录谁在用，删除前提示 |
| 自动选 Java | 项目指定 → 全局指定 → 本机扫描 → 自动下载对应主版本 |

其余部分（整合包格式解析、启动阶段日志与崩溃分类、缺失补齐的幂等策略）是本项目独立实现的，不计入借鉴。

## 关于开发方式

本项目的代码主要由 **LLM（大语言模型）** 编写，维护者负责提需求、验收、测试与发布。

- 代码里可能存在 LLM 常见的冗余写法，不够优雅的地方欢迎直接提 issue
- 安全相关逻辑（令牌校验、路径穿越防护）经过人工逐段复核
- 崩溃诊断的分类规则来自真实崩溃日志，不是模型编的
- 这个项目不打算隐瞒开发方式

## 数据目录

```
NSIS 安装版   <安装目录>\data
便携版        <exe 所在目录>\data
开发环境      %APPDATA%\RAINBOWMC
```

`data/` 内含 `games/`（各项目实例）、`versions/`、`libraries/`、`assets/`、`runtime/`、`logs/`。
**覆盖安装与卸载都不会删除 `data/`。**

## 许可

[MIT](LICENSE)

---

本项目与 Mojang Studios / Microsoft 无关。Minecraft 是 Mojang Studios 的商标。
