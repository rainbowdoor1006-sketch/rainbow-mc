import { existsSync, readFileSync, statSync } from 'fs'

/**
 * 崩溃日志诊断引擎。
 *
 * 原则：不罗列可能性，只给**唯一判定**，并附关键数字与日志原文。
 * 规则表按优先级从上到下匹配，先命中先返回（越具体的放越前）。
 */

export interface Diagnosis {
  code: string
  category: string
  title: string
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
  steps: string[]
  facts: string[]
}

export interface DiagContext {
  allocatedMb: number
  mods: number
  gpu?: string
  gpuVramMb?: number
  totalRamMb?: number
  exitCode?: number
}

function tailText(file: string, bytes = 400_000): string {
  try {
    if (!existsSync(file)) return ''
    const size = statSync(file).size
    const buf = readFileSync(file)
    return buf.subarray(Math.max(0, size - bytes)).toString('utf8')
  } catch {
    return ''
  }
}

function pick(text: string, re: RegExp, max = 4): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (re.test(line) && line.trim()) {
      const clean = line.replace(/^\[[^\]]*\]\s*/, '').trim()
      if (!out.includes(clean)) out.push(clean.slice(0, 220))
      if (out.length >= max) break
    }
  }
  return out
}

function firstCauses(text: string, max = 3): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(?:Caused by:|Exception in thread|java\.lang\.[A-Za-z]+(?:Exception|Error))[^\n]*/)
    if (m) {
      const clean = m[0].trim().slice(0, 200)
      if (!out.includes(clean)) out.push(clean)
      if (out.length >= max) break
    }
  }
  return out
}

const PER_MOD_MB = 22

interface Rule {
  id: string
  code: string
  category: string
  /** 命中判断 */
  test: (t: string, ctx: DiagContext) => boolean
  /** 生成判定 */
  build: (t: string, ctx: DiagContext) => Omit<Diagnosis, 'code' | 'category'>
}

const gb = (mb: number): string => String(Math.round(mb / 1024))

const RULES: Rule[] = [
  /* ───── 内存类 ───── */
  {
    id: 'oom-heap',
    code: 'E2100',
    category: 'env',
    test: (t) => /java\.lang\.OutOfMemoryError:\s*Java heap space|GC overhead limit exceeded/i.test(t),
    build: (t, c) => {
      const alloc = c.allocatedMb ? gb(c.allocatedMb) : '4'
      const need = Math.max(4, Math.ceil((3072 + c.mods * PER_MOD_MB) / 1024))
      return {
        title: `内存不足 —— 分配 ${alloc} GB，这个整合包至少需要 ${need} GB`,
        confidence: 'high',
        evidence: pick(t, /OutOfMemoryError|GC overhead/i),
        steps: [
          `进入「版本设置 → 内存」，把内存调到 ${need} GB（最多不超过物理内存的 60%）`,
          '同时关闭浏览器、直播、网盘同步等占内存的程序',
          '改完直接重新启动，不需要重装整合包'
        ],
        facts: [`模组数量：${c.mods} 个`, `当前分配：${alloc} GB`, `该体量建议：${need} GB 以上`]
      }
    }
  },
  {
    id: 'oom-metaspace',
    code: 'E2105',
    category: 'env',
    test: (t) => /OutOfMemoryError:\s*Metaspace|OutOfMemoryError:\s*Compressed class space/i.test(t),
    build: (t) => ({
      title: '元空间（Metaspace）耗尽 —— 加载的模组类太多，JVM 元数据区不够',
      confidence: 'high',
      evidence: pick(t, /Metaspace|Compressed class space/i),
      steps: [
        '这是 500+ 模组常见问题，在「版本设置 → JVM 参数」里追加：-XX:MaxMetaspaceSize=1024m',
        '不要同时设置过小的 -Xmx，元空间与堆是分开的两块',
        '如果仍失败，减少同时加载的模组数量'
      ],
      facts: []
    })
  },
  {
    id: 'native-thread',
    code: 'E2106',
    category: 'env',
    test: (t) => /unable to create (?:new )?native thread|Could not reserve enough space for object heap/i.test(t),
    build: (t) => ({
      title: 'JVM 无法申请到内存 / 线程 —— 分配的内存超过了系统可给的上限',
      confidence: 'high',
      evidence: pick(t, /unable to create .*thread|Could not reserve enough space/i),
      steps: [
        '把「版本设置 → 内存」下调 2~4 GB 再试（32 位 Java 最多只能用约 1.5 GB）',
        '确认使用的是 64 位 Java（设置页会显示位数）',
        '关闭其他大型程序后重启启动器'
      ],
      facts: []
    })
  },

  /* ───── 模组依赖与冲突 ───── */
  {
    id: 'missing-dep',
    code: 'E2103',
    category: 'pack',
    test: (t) =>
      /Missing or unsupported mandatory dependencies|ModResolutionException|Failed to resolve mod|Incompatible mod set/i.test(t),
    build: (t) => {
      const names = new Set<string>()
      for (const m of t.matchAll(/Mod ID:\s*'([^']+)'|modid[:=]\s*([a-z0-9_]+)/gi)) {
        const v = (m[1] || m[2] || '').trim()
        if (v) names.add(v)
      }
      const list = [...names].slice(0, 8)
      return {
        title: list.length ? `缺少前置模组：${list.join('、')}` : '模组依赖无法解析（缺少前置或版本冲突）',
        confidence: list.length ? 'high' : 'medium',
        evidence: pick(t, /Missing or unsupported|ModResolution|Mod ID:|Incompatible mod set/i),
        steps: [
          '打开「下载 → 模组」，搜索上面列出的模组名并下载',
          '或在模组详情页点「一键下载前置组件」',
          '若是刚加的模组导致，先在模组页把它禁用再启动',
          '确认所有模组都是同一个 MC 版本（1.20.1 的模组装到 1.20.4 上必崩）'
        ],
        facts: list.length ? [`缺失/冲突 ID：${list.join('、')}`] : []
      }
    }
  },
  {
    id: 'dup-modid',
    code: 'E2107',
    category: 'pack',
    test: (t) => /Duplicate mod ?id|Found duplicate mod|two mods with the same id/i.test(t),
    build: (t) => {
      const m = t.match(/Duplicate mod ?id:?\s*'?([a-z0-9_.-]+)'?/i)
      return {
        title: `模组 ID 重复：${m?.[1] ?? '（见证据）'} —— 同一个模组装了两份`,
        confidence: 'high',
        evidence: pick(t, /Duplicate mod|duplicate mod id/i),
        steps: [
          '打开项目 mods 目录，按文件名找出同一模组的两个版本',
          '删除旧的那个（或改用模组页的禁用功能，便于回滚）',
          '重新启动'
        ],
        facts: m?.[1] ? [`重复 ID：${m[1]}`] : []
      }
    }
  },
  {
    id: 'mixin-fail',
    code: 'E2103',
    category: 'pack',
    test: (t) => /Mixin apply(?:ing)? failed|MixinTransformerError|mixin.*apply.*failed/i.test(t),
    build: (t) => {
      const m =
        t.match(/Mixin apply(?:ing)? failed[^\n]*?([a-z0-9_]{2,})\.mixins\.json/i) ||
        t.match(/([a-z0-9_]{2,})\.mixins\.json[^\n]*failed/i)
      return {
        title: m ? `模组注入失败：${m[1]}（版本与当前 MC / 加载器不匹配）` : 'Mixin 注入失败（模组与加载器版本不匹配）',
        confidence: 'high',
        evidence: pick(t, /Mixin apply|mixin.*failed/i),
        steps: m
          ? [
              `在模组页禁用「${m[1]}」后重试`,
              `确认它支持当前 MC 版本与加载器版本`,
              '更新该模组到与整合包匹配的版本'
            ]
          : ['在模组页逐个禁用最近新增的模组，定位到具体那个', '更新可疑模组到匹配版本'],
        facts: m?.[1] ? [`可疑模组：${m[1]}`] : []
      }
    }
  },
  {
    id: 'forge-version',
    code: 'E2108',
    category: 'loader',
    test: (t) =>
      /This mod requires (?:Forge|NeoForge)[^\n]*version|requires? a (?:newer|different) (?:version of )?Forge|Forge version [\d.]+ is (?:not compatible|required)/i.test(
        t
      ),
    build: (t) => {
      const m = t.match(/(?:requires?|required:?)\s*(?:Forge|NeoForge)\s*(?:version\s*)?([\d.]+)/i)
      return {
        title: m ? `Forge 版本不匹配 —— 模组要求 ${m[1]}，当前装的不是这个版本` : 'Forge / NeoForge 版本与模组要求不匹配',
        confidence: 'high',
        evidence: pick(t, /requires .*Forge|Forge version/i),
        steps: [
          '打开「版本设置 → 加载器」，改成模组要求的 Forge 版本',
          '或者把要求高版本 Forge 的模组换成适配当前版本的老版本',
          '改完重新启动，不需要重装整合包'
        ],
        facts: m?.[1] ? [`要求版本：${m[1]}`] : []
      }
    }
  },
  {
    id: 'mc-version',
    code: 'E2109',
    category: 'pack',
    test: (t) => /requires (?:Minecraft|MC) (?:version )?[\d.]+|incompatible with (?:this )?Minecraft version/i.test(t),
    build: (t) => {
      const m = t.match(/requires (?:Minecraft|MC) (?:version )?([\d.]+)/i)
      return {
        title: m ? `模组要求的 MC 版本是 ${m[1]}，当前项目不是这个版本` : '模组与当前 MC 版本不兼容',
        confidence: 'high',
        evidence: pick(t, /requires (?:Minecraft|MC)|incompatible with/i),
        steps: [
          '确认项目 MC 版本（首页显示），删掉不兼容的模组',
          '或新建一个对应 MC 版本的项目再装这套模组',
          '整合包自带的模组不要单独替换成别的版本'
        ],
        facts: m?.[1] ? [`模组要求：${m[1]}`] : []
      }
    }
  },
  {
    id: 'optifine',
    code: 'E2110',
    category: 'pack',
    test: (t) => /OptiFine|optifine/i.test(t) && /(crash|incompatible|conflict|failed)/i.test(t),
    build: () => ({
      title: 'OptiFine 与当前模组组合冲突（Forge 环境下最常见）',
      confidence: 'medium',
      evidence: [],
      steps: [
        '删除 mods 目录里的 OptiFine，改用 Embeddium / Rubidium + Oculus',
        '如果要光影，装 Iris/Oculus 而不是 OptiFine',
        '确认没有同时装两个优化模组（如 Embeddium 与 Rubidium）'
      ],
      facts: []
    })
  },
  {
    id: 'missing-jar',
    code: 'E2111',
    category: 'pack',
    test: (t) => /NoSuchFileException|FileNotFoundException|The system cannot find the file specified/i.test(t),
    build: (t) => {
      const m = t.match(/(?:NoSuchFileException|FileNotFoundException)[^\n]*?[: ]([^\s\]]+\.(?:jar|json|toml|png))/i)
      return {
        title: m ? `缺少文件：${m[1]}` : '游戏运行时找不到某个文件（模组或配置缺失）',
        confidence: 'medium',
        evidence: pick(t, /NoSuchFileException|FileNotFoundException|cannot find the file/i),
        steps: [
          '在「版本设置 → 校验文件」里补齐缺失文件',
          '若日志指出是某个 mods 下的 jar，重新导入整合包会自动补回',
          '若是 config 目录的 .toml 缺失，删除该模组配置文件后重开游戏会重新生成'
        ],
        facts: m?.[1] ? [`缺失文件：${m[1]}`] : []
      }
    }
  },

  /* ───── 图形 / 驱动 ───── */
  {
    id: 'gpu-driver',
    code: 'E2001',
    category: 'env',
    test: (t) => /nvoglv64\.dll|nvwgf2umx\.dll|igdumdim|igxelpicd|atio6axx|amdxc64/i.test(t),
    build: (t, c) => ({
      title: `显卡驱动在创建游戏窗口时崩溃${c.gpu ? `（${c.gpu}）` : ''}`,
      confidence: 'high',
      evidence: pick(t, /nvoglv64|nvwgf2umx|igdumdim|igxelpicd|atio6axx|EXCEPTION_ACCESS_VIOLATION/i),
      steps: [
        '更新显卡驱动到最新版（NVIDIA / AMD / Intel 官网，不要用第三方驱动工具）',
        '关闭向日葵、远程桌面、虚拟显示器后再试',
        '在 Windows「设置 → 系统 → 显示 → 图形」里把游戏指定为「高性能」',
        '若装了 Forge 早期窗口，进「版本设置 → 加载器」关闭早期窗口显示'
      ],
      facts: c.gpu ? [`显卡：${c.gpu}`, c.gpuVramMb ? `显存：${gb(c.gpuVramMb)} GB` : ''].filter(Boolean) : []
    })
  },
  {
    id: 'gl-too-old',
    code: 'E2112',
    category: 'env',
    test: (t) => /OpenGL (?:version )?[\d.]+ (?:is )?not supported|Driver does not appear to support OpenGL|requires OpenGL/i.test(t),
    build: (t) => ({
      title: '显卡 / 驱动不支持当前 OpenGL 版本（多半是核显或远程桌面）',
      confidence: 'high',
      evidence: pick(t, /OpenGL.*not supported|does not appear to support OpenGL|requires OpenGL/i),
      steps: [
        '更新显卡驱动（核显也要更新）',
        '不要用远程桌面 / 虚拟机运行游戏',
        '1.17+ 需要 OpenGL 3.2 以上；老显卡只能退回低版本 MC'
      ],
      facts: []
    })
  },
  {
    id: 'glfw-window',
    code: 'E2001',
    category: 'env',
    test: (t) => /GLFW error|Failed to create window|Pixel format not accelerated|WGL.*failed/i.test(t),
    build: (t, c) => ({
      title: '创建游戏窗口失败（显卡/显示环境问题）',
      confidence: 'medium',
      evidence: pick(t, /GLFW error|Failed to create window|Pixel format|WGL/i),
      steps: [
        '更新显卡驱动',
        '降低分辨率、关闭光影后重试',
        '确认没有远程桌面或虚拟显示器占用显示设备',
        '把游戏设为窗口模式启动一次'
      ],
      facts: c.gpu ? [`显卡：${c.gpu}`] : []
    })
  },
  {
    id: 'vram',
    code: 'E2113',
    category: 'env',
    test: (t) => /OutOfMemoryError.*(?:Native Memory|Direct buffer)|Failed to allocate .* texture|GL_OUT_OF_MEMORY/i.test(t),
    build: (t, c) => ({
      title: '显存不足 —— 贴图/光影把显卡显存吃满了',
      confidence: 'high',
      evidence: pick(t, /Native Memory|Direct buffer|GL_OUT_OF_MEMORY|Failed to allocate/i),
      steps: [
        '关闭光影，或换一个轻量光影',
        '降低渲染距离、模拟距离、贴图分辨率',
        '换 128x 以下分辨率的资源包',
        c.gpuVramMb ? `当前显卡显存约 ${gb(c.gpuVramMb)} GB，建议 8 GB 以上再开高配光影` : '集成显卡建议不要开光影'
      ],
      facts: c.gpuVramMb ? [`显存：${gb(c.gpuVramMb)} GB`] : []
    })
  },

  /* ───── Java / JVM ───── */
  {
    id: 'java-version',
    code: 'E1001',
    category: 'env',
    test: (t) => /Unsupported class file major version \d+/i.test(t),
    build: (t) => {
      const m = t.match(/Unsupported class file major version (\d+)/i)
      const v = Number(m?.[1] ?? 0)
      const need = v >= 65 ? 'Java 21' : v >= 61 ? 'Java 17' : v >= 52 ? 'Java 8' : '更高的 Java'
      return {
        title: `Java 版本不匹配（当前太低，模组要求 ${need}）`,
        confidence: 'high',
        evidence: pick(t, /Unsupported class file major version/i),
        steps: [
          '打开「设置 → Java 路径」，清空自定义路径',
          '让启动器自动下载匹配版本：1.17~1.20.4 用 Java 17，1.20.5+ 用 Java 21',
          '若手动装过多个 Java，注意不要指向旧版本目录'
        ],
        facts: [`检测到字节码版本：${v}`]
      }
    }
  },
  {
    id: 'java-wrong-arch',
    code: 'E2114',
    category: 'env',
    test: (t) => /Error: Could not create the Java Virtual Machine|Error occurred during initialization of VM/i.test(t),
    build: (t) => ({
      title: 'JVM 启动参数无效，Java 虚拟机没能起来',
      confidence: 'medium',
      evidence: pick(t, /Could not create the Java Virtual Machine|initialization of VM/i),
      steps: [
        '检查「版本设置 → JVM 参数」里是否有过时的参数（例如 -XX:+UseZGC 在老 Java 上不存在）',
        '把 JVM 参数清空后重试一次，确认是不是参数问题',
        '确认 Java 位数与内存分配：32 位 Java 无法分配超过 1.5 GB'
      ],
      facts: []
    })
  },
  {
    id: 'main-class',
    code: 'E1003',
    category: 'env',
    test: (t) => /Could not find or load main class|Unrecognized option:|Error: Could not find or load/i.test(t),
    build: (t) => ({
      title: '启动命令有问题（主类找不到 / 参数无法识别）',
      confidence: 'medium',
      evidence: pick(t, /Could not find or load main class|Unrecognized option/i),
      steps: [
        '在「版本设置 → 校验文件」补齐该版本的库与客户端文件',
        '若刚手动改过 JVM 参数，先恢复默认',
        '删除该版本后重新安装一次加载器'
      ],
      facts: []
    })
  },
  {
    id: 'missing-lib',
    code: 'E1003',
    category: 'env',
    test: (t) => /FindException|Module .* not found, required by|NoClassDefFoundError|ClassNotFoundException/i.test(t),
    build: (t) => {
      const m = t.match(/Module ([a-zA-Z0-9_.]+) not found, required by ([a-zA-Z0-9_.]+)/i)
      return {
        title: m ? `共享库缺失：${m[1]}（被 ${m[2]} 需要）` : '缺少必要的类或库文件',
        confidence: 'high',
        evidence: pick(t, /FindException|not found, required by|NoClassDefFoundError|ClassNotFoundException/i),
        steps: [
          '在「版本设置 → 校验文件」补齐缺失文件（会自动补 libs）',
          '或删除该版本后重新安装一次',
          '如果是多个版本共用 libraries 导致，重装该版本的库即可'
        ],
        facts: []
      }
    }
  },

  /* ───── 存档 / 数据 ───── */
  {
    id: 'corrupt-save',
    code: 'E2115',
    category: 'pack',
    test: (t) =>
      /corrupt(?:ed)? (?:chunk|region|save|level)|Region file .* is (?:corrupt|truncated)|Failed to load (?:chunk|level)|chunk.*is corrupted/i.test(
        t
      ),
    build: (t) => ({
      title: '存档损坏（区块 / region 文件读不出来）',
      confidence: 'high',
      evidence: pick(t, /corrupt(?:ed)?|Region file|Failed to load chunk|truncated/i),
      steps: [
        '先备份整个 saves 目录（在「更多 → 打开数据目录 → saves」）',
        '用 MCEdit / NBTExplorer 之类工具修复，或回退到上一个存档备份',
        '把日志里点名的 region 文件（如 r.0.0.mca）移走，让游戏丢弃该区块重新生成',
        '启动器有「备份存档」功能，之后可以长按前先备份'
      ],
      facts: []
    })
  },
  {
    id: 'save-newer',
    code: 'E2116',
    category: 'pack',
    test: (t) => /saved (?:in|with) a newer version|world.*newer version|Data version \d+ is newer/i.test(t),
    build: (t) => {
      const m = t.match(/Data version (\d+)/i)
      return {
        title: '存档是更高版本游戏保存的，当前版本打不开',
        confidence: 'high',
        evidence: pick(t, /saved .*newer version|Data version/i),
        steps: [
          '用保存该存档的那个 MC 版本打开（新建对应版本的项目）',
          '或在单人界面用「创建世界时选择降级」的方式导入存档',
          '不要用低版本强行打开高版本存档，会丢数据'
        ],
        facts: m?.[1] ? [`存档数据版本：${m[1]}`] : []
      }
    }
  },
  {
    id: 'missing-dimension',
    code: 'E2117',
    category: 'pack',
    test: (t) => /Missing dimension|Unknown dimension|Could not find dimension/i.test(t),
    build: (t) => {
      const m = t.match(/(?:Missing|Unknown) dimension[^\n]*?([a-z0-9_]+:[a-z0-9_/]+)/i)
      return {
        title: m ? `存档引用了缺失的维度：${m[1]}（多半是删了模组）` : '存档引用了不存在的维度',
        confidence: 'high',
        evidence: pick(t, /Missing dimension|Unknown dimension/i),
        steps: [
          '把之前删掉的模组装回来（维度是模组提供的）',
          '或新建世界，不要继续用这个存档',
          '如果只是想去掉该模组，需要先在游戏里把玩家从该维度移出'
        ],
        facts: m?.[1] ? [`缺失维度：${m[1]}`] : []
      }
    }
  },
  {
    id: 'datapack',
    code: 'E2118',
    category: 'pack',
    test: (t) => /Failed to load datapacks|pack\.mcmeta|Couldn't load (?:pack|datapack)|Invalid pack format/i.test(t),
    build: (t) => {
      const m = t.match(/pack\.mcmeta[^\n]*?([\w.-]+\.zip)/i)
      return {
        title: m ? `数据包 / 资源包格式错误：${m[1]}` : '数据包或资源包格式不正确',
        confidence: 'medium',
        evidence: pick(t, /Failed to load datapacks|pack\.mcmeta|Couldn't load|Invalid pack format/i),
        steps: [
          '把该压缩包从 resourcepacks / datapacks 目录移走再启动',
          '确认包是给当前 MC 版本做的（pack_format 要匹配）',
          m ? `重新下载「${m[1]}」的对应版本` : '重新下载对应版本的数据包'
        ],
        facts: []
      }
    }
  },

  /* ───── 系统 / 权限 / 磁盘 ───── */
  {
    id: 'disk-full',
    code: 'E2119',
    category: 'file',
    test: (t) => /No space left on device|There is not enough space on the disk|磁盘空间不足/i.test(t),
    build: (t) => ({
      title: '磁盘空间不足，写不进去',
      confidence: 'high',
      evidence: pick(t, /No space left on device|not enough space/i),
      steps: [
        '清理磁盘：至少留出 5 GB 空闲（大整合包建议 10 GB）',
        '把数据目录整体迁到空间更大的盘（「设置 → 数据目录」）',
        '清理 data/games 下已删除项目残留的文件夹'
      ],
      facts: []
    })
  },
  {
    id: 'file-locked',
    code: 'E2120',
    category: 'file',
    test: (t) => /being used by another process|The process cannot access the file|Access is denied|Permission denied/i.test(t),
    build: (t) => {
      const m = t.match(/(?:access the file|Access is denied)[^\n]*?[:\\ ]([\w.\\-]+\.(?:jar|json|log|toml))/i)
      return {
        title: m ? `文件被占用 / 无权限：${m[1]}` : '文件被其他程序占用，或没有权限写入',
        confidence: 'high',
        evidence: pick(t, /being used by another process|cannot access the file|Access is denied/i),
        steps: [
          '确认没有第二个启动器实例或杀毒软件正在扫描该文件',
          '把启动器加入杀毒软件白名单',
          '不要用管理员身份运行（会导致数据目录权限错乱）',
          '重启电脑后再试一次'
        ],
        facts: m?.[1] ? [`涉及文件：${m[1]}`] : []
      }
    }
  },
  {
    id: 'defender-quarantine',
    code: 'E2121',
    category: 'file',
    test: (t) => /virus|quarantine|威胁|Trojan/i.test(t) && /mods|jar/i.test(t),
    build: () => ({
      title: '杀毒软件把模组 jar 当成病毒处理了',
      confidence: 'medium',
      evidence: [],
      steps: [
        '打开 Windows 安全中心 → 保护历史记录，把被隔离的 jar 还原',
        '把项目的 mods 目录加入排除项',
        '重新导入整合包补齐被删的文件'
      ],
      facts: []
    })
  },

  /* ───── 网络（模组联网失败） ───── */
  {
    id: 'net-modfetch',
    code: 'E2122',
    category: 'net',
    test: (t) => /UnknownHostException|ConnectException|connect timed out|Read timed out|SSLHandshakeException/i.test(t),
    build: (t) => {
      const host = t.match(/(?:UnknownHostException|ConnectException)[^\n]*?[: ]([a-z0-9.-]+\.[a-z]{2,})/i)
      return {
        title: host ? `模组联网失败：连不上 ${host[1]}` : '有模组在联网时超时（常见于加载阶段卡住）',
        confidence: 'medium',
        evidence: pick(t, /UnknownHostException|ConnectException|timed out|SSLHandshake/i),
        steps: [
          '这通常不影响进入游戏，可以忽略；若卡在加载界面则需处理',
          '检查网络 / 代理是否拦截了该域名',
          '关掉「联网检查更新」类模组（如 VersionChecker）可减少这类报错',
          '启动器已默认加 5 秒连接超时，必要时在 JVM 参数里调大'
        ],
        facts: host?.[1] ? [`目标域名：${host[1]}`] : []
      }
    }
  },
  {
    id: 'port-in-use',
    code: 'E2123',
    category: 'net',
    test: (t) => /Address already in use|BindException|端口.*占用/i.test(t),
    build: (t) => ({
      title: '端口被占用（联机 / 局域网开房失败）',
      confidence: 'high',
      evidence: pick(t, /Address already in use|BindException/i),
      steps: [
        '关闭上一次没退干净的游戏进程（任务管理器结束 javaw.exe）',
        '换一个端口：联机页重新开房会自动换端口',
        '如果开了其他联机软件（如 HMCL 联机），先关掉'
      ],
      facts: []
    })
  },

  /* ───── 资源缺失 ───── */
  {
    id: 'missing-assets',
    code: 'E2104',
    category: 'file',
    test: (t) => /Unable to load (?:assets|resource)|Missing resource|Failed to load (?:sound|texture)|assets\/minecraft/i.test(t),
    build: (t) => ({
      title: '游戏资源文件缺失（没声音、没语言、贴图空白）',
      confidence: 'high',
      evidence: pick(t, /Unable to load assets|Missing resource|Failed to load sound|Failed to load texture/i),
      steps: [
        '在「版本设置 → 校验文件」里补齐游戏资源（会自动下载 index 与 objects）',
        '确认磁盘空间足够（资源约 500 MB~1 GB）',
        '补齐后重启游戏，不要用旧版本目录里的资源'
      ],
      facts: []
    })
  },

  /* ───── 进程被杀 ───── */
  {
    id: 'killed',
    code: 'E2124',
    category: 'env',
    test: (t, c) => (c.exitCode === 137 || c.exitCode === -1) && !/Exception|Error/i.test(t.slice(-4000)),
    build: (_t, c) => ({
      title: '游戏进程被系统或用户强制结束（不是崩溃）',
      confidence: 'medium',
      evidence: [],
      steps: [
        '如果是内存吃满被系统杀掉：调小内存分配或关闭其他程序',
        '检查是否点了「停止游戏」',
        '杀毒软件 / 系统优化软件有时会结束 javaw.exe，加白名单'
      ],
      facts: c.exitCode ? [`退出码：${c.exitCode}`] : []
    })
  }
]

export function diagnose(logFile: string, ctx: DiagContext): Diagnosis {
  const text = tailText(logFile)

  for (const rule of RULES) {
    try {
      if (rule.test(text, ctx)) {
        const d = rule.build(text, ctx)
        return { code: rule.code, category: rule.category, ...d }
      }
    } catch {
      /* 单条规则异常不影响其他规则 */
    }
  }

  /* 兜底：给出日志里真实的异常，而不是罗列可能性 */
  const causes = firstCauses(text)
  const errs = pick(text, /Exception|Caused by|FATAL|crash/i, 3)
  const evidence = causes.length ? causes : errs
  return {
    code: 'E9999',
    category: 'general',
    title: evidence.length
      ? `未能匹配已知类型，日志里的异常是：${evidence[0].slice(0, 70)}`
      : '未能从日志中判定具体原因（日志里没有异常信息）',
    confidence: 'low',
    evidence,
    steps: [
      '点「打开保存日志的文件夹」，把 latest.log 的最后 50 行发出来',
      '关键信息是 Caused by / Exception 行，一般在文件末尾 20 行内',
      '如果是刚导入的整合包，先重新导入一次（会补齐缺失文件）',
      '如果是刚改过模组，先把新加的模组禁用再试'
    ],
    facts: [`模组数量：${ctx.mods} 个`, ctx.allocatedMb ? `分配内存：${gb(ctx.allocatedMb)} GB` : ''].filter(Boolean)
  }
}

/** 供设置页/关于页展示：当前支持自动判定的错误类型数量 */
export const DIAG_RULE_COUNT = RULES.length
