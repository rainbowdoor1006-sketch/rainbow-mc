# RAINBOW MC 启动器 · 功能介绍与架构说明

> 版本：0.2.28 ｜ 更新：2026-10-22
> 定位：给不想折腾的玩家用的 Minecraft 启动器——**装上就能玩**，不需要自己配 Java、不需要手动装加载器、不需要翻教程。

---

## 一、一句话定位

RAINBOW MC 是一个 **Windows 桌面 Minecraft 启动器**（Electron + React + TypeScript）。
目标是把折腾环节全部自动化：**下载安装包 → 双击 → 选版本 → 点启动**。

---

## 二、功能总览

| 模块 | 能做什么 |
|---|---|
| 版本管理 | 安装任意原版版本（正式/快照/远古），支持导入现有 `.minecraft` |
| 加载器 | Forge / NeoForge / Fabric / Quilt **一键安装**（自动下安装器、静默执行） |
| 启动游戏 | 自动选 Java、自动补库、自动补资源、崩溃自动诊断 |
| 资源下载 | Modrinth 搜索 + 下载：模组 / 整合包 / 光影 / 资源包 |
| 整合包 | **拖拽导入** `.mrpack`（Modrinth）、CurseForge 整合包 `.zip`、本启动器导出的包 |
| 组件库 | 下载的模组/光影/资源包集中管理，可应用到任意项目 |
| 账号 | 离线登录（填昵称即可游玩） |
| 个性化 | 自定义背景图、自定义头像、主题色（石墨·玉青） |
| 更新 | 启动自动检查更新、静默安装、保留全部存档 |
| 日志 | 每次启动生成 ZIP 日志（含启动阶段、崩溃特征、诊断建议） |

---

## 三、关键功能详解

### 3.1 版本安装与启动

**做什么**：装一个 MC 版本 = 客户端 jar + 几百个库 + 几千个资源文件 + natives 解压，启动时还要拼一条上百个参数的 Java 命令行。

**怎么做**：

```
① 从版本清单拿 version.json（含 inheritsFrom 链，Forge 版本会继承原版）
② 合并版本链 → 得到完整的 libraries / arguments / assetIndex
③ 逐项比对磁盘，只下缺失的（幂等，随时可重跑）
④ natives 库解压到 versions/<id>/natives
⑤ 拼 JVM 参数 + 游戏参数（占位符替换：${auth_player_name} 等）
⑥ spawn 子进程，stdout/stderr 实时写入日志文件
```

**为什么这么做**：
- **幂等补齐**：用户随时可能因为断网/杀进程导致文件缺失，每次启动前跑一遍"缺什么补什么"，比"坏了就重装"体验好得多
- **版本链合并**：Forge 的 version.json 只有增量部分，不合并就没法启动

**关键代码**：`main/minecraft/installer.ts`、`versionchain.ts`、`launcher.ts`

---

### 3.2 资源文件（assets）自动下载 —— 0.2.28 新增

**背景问题**：早期版本只下"库 + 客户端 jar"，不下 assets。结果游戏能进，但**语言列表空白、没有声音、字体异常**。

**怎么做**：

```
assetIndex（1.20.1 是 index 5）
  → indexes/5.json（含 4000+ 个对象：hash + size）
  → objects/<hash前2位>/<hash>
  → 16 并发下载，只补缺失
```

**为什么单独做**：
- assets 体积大（1.20.1 约 500 MB），不能放在"每次启动都全量校验"的路径里，所以按"文件存在且大小匹配"快速跳过
- 语言/声音/字体都在里面，属于"缺了不崩但体验残缺"的典型，必须补

**关键代码**：`installer.ts` → `ensureAssets()`

---

### 3.3 加载器安装（Forge / NeoForge / Fabric / Quilt）

**Forge / NeoForge**：
1. 从官方 maven 找对应 MC 版本的 installer jar
2. `java -jar installer.jar --installClient <dir>` 静默执行
3. 成功后生成 `versions/<mc>-forge-<ver>/` 版本目录

**Fabric / Quilt**：走 meta API 拿 profile json，直接拼出启动配置，不需要跑安装器。

**设计取舍**：Forge 安装器是"官方唯一正确姿势"，自己复刻容易出事，所以选"下载官方安装器 + 静默执行"，代价是首次安装要几十秒。

---

### 3.4 整合包导入（三种格式）

| 格式 | 判断依据 | 处理方式 |
|---|---|---|
| Modrinth `.mrpack` | 含 `modrinth.index.json` | 按 `files[]` 的**完整 URL** 直接下载 |
| CurseForge `.zip` | 含 `manifest.json` | 只有 `projectID/fileID`，需**按 ID 换直链**（见下） |
| 本启动器导出包 | 含 `rainbow-pack.json` | 直接还原 |

**统一流程**：

```
解压 overrides/ 与 .minecraft/（config、resourcepacks、shaderpacks…）
→ 读清单下载缺失的模组
→ 自动安装对应加载器
→ ensureVersionFiles（补库）+ ensureAssets（补资源）
→ 建项目、写元数据
```

**CurseForge 的难点与解法（重要设计）**：

CurseForge 整合包**不含模组 jar**，只有 ID。要下载必须"按 ID 换直链"，而 `api.curseforge.com` 需要付费/申请 API Key。三条回退路径：

```
① 免 Key 通道（默认，实测可用）
   api.cfwidget.com/<projectId>            → 拿到文件名
   mediafilez.forgecdn.net/files/<id/1000>/<id%1000>/<name>   → 直链下载
② 第三方代理（可选）
   GET {自定义更新地址}
③ 用户自备 API Key（可选）
```

**为什么这样设计**：不能让普通用户为了玩一个整合包去注册 CurseForge 账号（国内还要翻墙）。所以默认走免 Key 通道，代理和自备 Key 只是"更稳的备选项"。

**关键代码**：`main/minecraft/instance.ts`（解析）、`cf.ts`（解析直链 + 下载）

---

### 3.5 组件库（全局共享，跨项目）

**做什么**：下载的模组/光影/资源包先进"组件库"，再决定装到哪个项目。

**为什么**：
- 用户常有 3~5 个项目，同一个模组重复下载浪费流量
- 组件库带**引用计数**（`usageProjects`），删除时提示"还有 2 个项目在用"

**数据**：`data/libraries/`（文件）+ `library.json`（索引）

---

### 3.6 账号体系

本开源版本只保留**离线登录**：填一个昵称即可创建本地账号，用于单机与离线服务器。
不包含任何在线账号相关的实现。
\n### 3.7 自动更新

**流程**：

```
启动 → 检查更新（可自行配置地址）
     → 语义化版本比较（0.2.28 vs 线上）
     → 有新版：弹窗 → 下载安装包 → 静默安装 /S /KEEPDATA /D=<当前目录>
     → 安装完自动拉起新版本
```

**三个关键决策**：

1. **比较版本号而不是 version_code**
   旧方案用 `MAJOR*100+MINOR*10+PATCH` 生成 code，一旦出现 `0.3.0`（code 30 < 0.2.28 的 48）就会误判成"本地比线上新"。改成逐段比较 `major.minor.patch` 后，服务端公式怎么变都不影响。

2. **`/KEEPDATA` + 安装器只删程序文件**
   早期版本覆盖安装时删过 `data/`，丢过 4.7 GB 存档。现在安装脚本只删 `*.exe *.dll *.pak resources/ locales/`，`data/` 从始至终原地不动。

3. **跨目录安装直接中止**
   装到与现有安装不同的目录时，Windows 会调用旧版卸载程序，把另一份安装的程序文件删掉。现在检测到目录不一致就弹窗中止，避免"装一个删一个"。

---

### 3.8 日志与崩溃诊断（0.2.27 起）

**日志内容**：

```
[启动器] ▶ 阶段 1: 版本文件就绪 · 1.20.1-forge-47.2.0 / Java 17（+0ms）
[启动器] ▶ 阶段 2: Java 已确定 · ...\javaw.exe（+1ms）
[启动器] ▶ 阶段 3: 解析依赖与 natives（+1ms）
[启动器] ▶ 阶段 4: 依赖就绪（+11ms）
[启动器] ▶ 阶段 5: 游戏进程已输出第一行（+2234ms）
...游戏日志...
=== 启动诊断 ===
退出码: 1（异常）／耗时: 18.6s／最后阶段: 阶段 5
崩溃特征: NVIDIA OpenGL 驱动 (nvoglv64.dll)
```

**崩溃分类器**覆盖：NVIDIA/Intel 显卡驱动、OOM、缺类、模组依赖缺失、Mixin 注入失败、Java 致命错误。

**为什么**：用户不会读 log。把"停在哪一步 + 什么类型"直接写进日志和弹窗，用户只需要把 ZIP 发出来。

---

### 3.9 兼容性自愈（无需用户动手）

| 场景 | 启动器自动做的事 |
|---|---|
| Forge 早期窗口导致 `nvoglv64.dll` 崩溃 | 启动前确保实例 `config/fml.toml` 有 `earlyWindowControl = false` |
| 显卡类崩溃 | 自动把 `javaw.exe` 登记为"高性能 GPU"（HKCU，免管理员） |
| 渲染优化模组引发崩溃 | 自动把 `embeddium/sodium/rubidium/oculus/iris` 移到 `mods.disabled` |
| 缺库 / 缺资源 | 启动前 `ensureVersionFiles` + `ensureAssets` 补齐 |

**设计原则**：能在启动器侧自动修的，绝不丢给用户去改驱动设置。

---

## 四、架构

### 4.1 进程模型（Electron 三层）

```
┌─────────────────────────────────────────────────────────┐
│  Renderer（React 18 + TS）                               │
│  pages: Launch / Download / Library / Settings / More    │
│  components: SidePanel / ResourceBrowser / InstancePanel  │
└───────────────▲─────────────────────────────────────────┘
                │ window.api.xxx()（contextBridge 白名单）
┌───────────────┴─────────────────────────────────────────┐
│  Preload（contextIsolation: true）                       │
│  把 ipcRenderer.invoke 包装成带类型的 API 对象            │
└───────────────▲─────────────────────────────────────────┘
                │ ipcMain.handle / webContents.send（事件）
┌───────────────┴─────────────────────────────────────────┐
│  Main（Node 全权限）                                     │
│  paths / store / update / minecraft{installer,instance,  │
│  launcher,cf,library,logs,ipc} / window                  │
└─────────────────────────────────────────────────────────┘
```

**为什么这么分**：
- 渲染层不碰文件系统与网络（Electron 安全基线），全部能力收在 main
- preload 只暴露**明确列出的**方法，渲染层拿不到 `require`
- 事件（下载进度、日志行、游戏状态）走 `webContents.send` → preload 转成回调

### 4.2 目录结构

```
app/
├── src/
│   ├── main/                      主进程
│   │   ├── index.ts               入口：窗口、协议、IPC 注册
│   │   ├── paths.ts               数据根解析（dev/packaged/portable）
│   │   ├── store.ts               config.json 读写（含 .bak 兜底）
│   │   ├── update.ts              版本检查 / 下载 / 静默安装
│   │   ├── window.ts              主窗口与自定义标题栏
│   │   └── minecraft/
│   │       ├── installer.ts       版本安装、ensureVersionFiles、ensureAssets
│   │       ├── versionchain.ts    版本 json 链式合并
│   │       ├── launcher.ts        启动命令拼装、阶段日志、进程管理
│   │       ├── instance.ts        整合包解析（mrpack / CurseForge / 自有）
│   │       ├── cf.ts              CurseForge ID→直链（免 Key / 代理 / Key）
│   │       ├── library.ts         组件库（共享文件 + 引用计数）
│   │       ├── modrinth.ts        Modrinth API 封装
│   │       ├── logs.ts            运行日志打包（ZIP + meta.json）
│   │       └── ipc.ts             所有 mc:* / library:* / update:* 通道
│   ├── preload/index.ts           contextBridge 暴露 window.api
│   ├── renderer/                  React 界面
│   └── shared/types.ts            主/渲染共享类型（AppSettings、Project…）
├── build/                         图标、安装脚本、三语言许可
└── release/                       安装包产物
```

### 4.3 数据根（关键设计）

```
开发环境        %APPDATA%\RAINBOWMC
NSIS 安装版     <安装目录>\data          ← 默认
便携版          %PORTABLE_EXECUTABLE_DIR%\data
```

**为什么把 data 放在安装目录**：用户可以整包拷走（U 盘/换机），不会出现"重装系统后 `%APPDATA%` 里的存档找不到"。

**配套的迁移逻辑**（`paths.ts`）：
- 检测到旧路径（`%APPDATA%\RAINBOWMC`）有数据且新路径为空 → 自动迁移
- 迁移用 `Rename` 优先，失败退化为 robocopy `/MOVE`
- 迁移失败不阻塞启动，日志里记录

### 4.4 状态存储

`config.json` 存全部状态（设置、项目、账号、组件库索引）。

| 机制 | 目的 |
|---|---|
| 写前保存 `config.json.bak` | 断电/崩溃后可从备份恢复 |
| 读取时 JSON 解析失败 → 回退 `.bak` | 防止文件被写坏导致启动器打不开 |
| 加载后 `fixStalePaths()` | 修正旧路径前缀、头像优先用本地文件 |

### 4.5 自定义协议

```
rainbow://local/<path>      → 映射到 data 目录内的文件
```

用于背景图、头像等本地资源（避免 `file://` 被 CSP 拦截），**严格限制在 `paths.root()` 内**，防止路径穿越读到系统文件。

---

## 五、关键流程时序

### 5.1 启动游戏

```
用户点「启动」
  → 校验账号/项目
  → 检查运行中实例（防重复启动）
  → ensureVersionFiles()   补库 + 客户端 jar + log4j 配置
  → ensureAssets()         补资源（语言/声音/字体）
  → 选 Java（项目指定 → 全局指定 → 本机扫描 → 自动下载）
  → 解压 natives → 拼命令
  → spawn( javaw, args )
  → 实时写日志（阶段打点）
  → 退出 → 分类崩溃 → 自动兼容处理 → 打包 ZIP 日志
```

### 5.2 导入整合包

```
拖入 .zip
  → 判定格式（mrpack / CF / rainbow）
  → 解压 overrides（config、resourcepacks…）
  → 下载模组
       mrpack：按 URL
       CF    ：ID → cfwidget 文件名 → mediafilez 直链
  → 安装加载器（Forge 走官方 installer）
  → ensureVersionFiles + ensureAssets
  → 建项目，返回「成功 / 缺几个模组」
```

### 5.3 自动更新

```
启动 → 检查更新（未配置地址时跳过）
     → compareVersion(线上, 本地)
     → older：弹更新框（下载 → 进度 → 安装）
     → newer：提示"你用的是先行版"
     → 安装器 /S /KEEPDATA /D=<当前目录> → 安装完拉起 → 旧进程退出
```

---

## 六、设计取舍记录

| 决策 | 理由 |
|---|---|
| 自带 Java 运行时（jre-17） | 用户机器上 90% 没有合适 JDK；自动下载 200 MB 比让用户装省事 |
| data 放安装目录 | 可整包搬走；卸载不删存档 |
| 每次启动都做"缺失补齐" | 比"出错就重装"体验好，代价是启动多几百毫秒 |
| CurseForge 走免 Key 通道 | 用户注册不了/进不去 CF 后台，不能把门槛转嫁给用户 |
| 版本比较用语义化 | version_code 公式会随大版本号撞车 |
| 崩溃后自动改配置 | 用户不该为了玩游戏去点驱动面板 |
| 组件库全局共享 | 多项目复用，省流量；引用计数防误删 |

---

## 七、扩展点

| 想加什么 | 改哪里 |
|---|---|
| 新下载源（镜像） | `installer.ts` 的 `rewriteUrl()` + 设置项 |
| 新加载器 | `instance.ts` 的 loader 分支 + `installer.ts` 安装函数 |
| 自有整合包格式 | `instance.ts` 增加 `rainbow-pack.json` 字段 |
| 新 IPC 能力 | `ipc.ts` 注册通道 + `preload/index.ts` 暴露 + `shared/types.ts` 定类型 |

---

## 八、发布流程（内部）

```
1. npm run build
2. package.json 版本号 +1
3. npx electron-builder --win nsis  → release/RAINBOWMC-<ver>-setup.exe
4. 记录 sha256 / size
5. 交服务端：launcher-release.js --add --version <ver> --code <MAJOR*100+MINOR*10+PATCH>
6. 验证 检查更新（可自行配置地址） 三字段（version / versionCode / sha256）
```

> 客户端已改用语义化比较，`version_code` 只需单调即可。

---

## 九、主要源码文件职责速查

| 文件 | 职责 |
|---|---|
| `main/paths.ts` | 数据根、目录解析、旧数据迁移 |
| `main/store.ts` | config.json 读写、备份、路径修正 |
| `main/update.ts` | 版本检查、下载安装包、拉起安装器、语义化比较 |
| `main/minecraft/installer.ts` | 版本安装、库补齐、资源补齐 |
| `main/minecraft/launcher.ts` | 启动命令、阶段日志、进程与退出处理 |
| `main/minecraft/instance.ts` | 三种整合包格式解析与导入 |
| `main/minecraft/cf.ts` | CurseForge 文件 ID → 下载直链 |
| `main/minecraft/library.ts` | 组件库文件与索引 |
| `main/minecraft/logs.ts` | 运行日志打包 ZIP |
| `main/minecraft/ipc.ts` | 全部 IPC 通道与崩溃诊断 |
| `renderer/components/ResourceBrowser.tsx` | 资源下载页（含项目筛选开关） |
| `renderer/components/InstancePanel.tsx` | 实例设置（内存、JVM、导出） |
| `renderer/components/UpdateDialog.tsx` | 更新弹窗 |

---

*文档随版本更新，最后同步：0.2.28（2026-10-22）*
