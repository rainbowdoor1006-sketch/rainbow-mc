/**
 * 错误码目录：把散落在各处的 errorCode 统一成「分类 + 标题 + 可能原因 + 解决步骤」。
 *
 * 目标：用户在弹窗里就能看懂并自己解决，不用去问 AI。
 * 约定：
 *   E1xxx 环境与 Java     E2xxx 文件与下载
 *   E3xxx 加载器/安装器   E4xxx 账户与登录
 *   E5xxx 整合包          E9xxx 其他/通用
 *   P1xxx 启动前预估警告
 */

export type ErrCategory =
  | 'env'
  | 'file'
  | 'loader'
  | 'account'
  | 'pack'
  | 'net'
  | 'general'
  | 'warn'

export interface ErrEntry {
  code: string
  category: ErrCategory
  /** 一句话标题，说清是什么错 */
  title: string
  /** 可能原因 */
  reasons: string[]
  /** 解决步骤，按顺序做 */
  steps: string[]
  /** 是否只是警告（可继续） */
  warn?: boolean
}

export const CATEGORY_NAME: Record<ErrCategory, string> = {
  env: '环境 / Java',
  file: '文件与下载',
  loader: '加载器 / 安装器',
  account: '账号与登录',
  pack: '整合包',
  net: '网络',
  general: '通用',
  warn: '启动前提醒'
}

export const ERROR_CATALOG: Record<string, ErrEntry> = {
  /* ── 环境与 Java ── */
  E1001: {
    code: 'E1001',
    category: 'env',
    title: 'Java 运行环境异常',
    reasons: [
      '本机没有安装对应版本的 Java，且自动下载失败',
      '设置的 Java 路径失效（文件被移动或删除）',
      'Java 与游戏版本不匹配（1.17+ 需要 Java 17）',
    ],
    steps: [
      '打开「设置 → Java 路径」，清空自定义路径，让启动器自动选择',
      '确认网络可用后重试，启动器会自动下载对应版本的运行时',
      '若手动装过 Java，确认版本：1.16.5 及以下用 Java 8，1.17~1.20.4 用 Java 17，1.20.5+ 用 Java 21',
    ]
  },
  E1002: {
    code: 'E1002',
    category: 'general',
    title: '项目不存在',
    reasons: ['项目已被删除，但界面还停留在旧状态', '配置文件损坏导致项目记录丢失'],
    steps: ['回到「启动」页重新选择项目', '若列表里没有项目，用「版本选择」新建一个', '仍然异常时，打开「更多 → 打开数据目录」检查 data/games 是否还有对应文件夹']
  },
  E1003: {
    code: 'E1003',
    category: 'env',
    title: '启动流程失败',
    reasons: ['启动命令拼装失败', '某个依赖文件缺失或损坏'],
    steps: ['先在「版本设置 → 校验文件」里补齐缺失文件', '查看日志最后 30 行，通常会有具体的缺失文件名', '按日志提示删除该文件后重新启动，让启动器重新下载']
  },
  E2001: {
    code: 'E2001',
    category: 'env',
    title: '游戏异常退出（崩溃）',
    reasons: [
      '内存不足（OutOfMemoryError）',
      '模组冲突或缺少前置',
      '显卡驱动问题（NVIDIA / Intel 驱动）',
      'Java 版本不匹配',
    ],
    steps: [
      '看弹窗下方的「启动诊断」，里面已标出最后阶段与崩溃特征',
      '若提示内存不足：进入「版本设置 → 内存」调大（500+ 模组建议 12~16 GB）',
      '若提示缺少前置模组：在模组页点「一键下载前置组件」',
      '若提示显卡驱动崩溃：更新显卡驱动，并在设置里关闭 Forge 早期窗口',
      '仍然崩溃：打开日志目录，把 latest.log 发给整合包作者',
    ]
  },
  E2003: {
    code: 'E2003',
    category: 'env',
    title: '启动超时',
    reasons: ['Java 下载或解压耗时过长', '首次启动需要解压大量资源，被误判为超时'],
    steps: ['确认磁盘剩余空间充足（至少 5 GB）', '关闭占网速的程序后重试', '首次启动大整合包时请耐心等待，不要反复点取消']
  },
  E2098: {
    code: 'E2098',
    category: 'general',
    title: '操作已取消',
    reasons: ['用户手动点了「取消」或「停止」'],
    steps: ['重新点击启动即可']
  },
  E2100: {
    code: 'E2100',
    category: 'env',
    title: '内存不足（OutOfMemoryError）',
    reasons: [
      '分配给游戏的内存太小，装不下当前模组数量',
      '同时开了太多程序，系统可用内存不够',
      '整合包本身对内存需求很高（500+ 模组常见 12~20 GB）',
    ],
    steps: [
      '进入「版本设置 → 内存」，把内存调到弹窗建议值（一般 8~16 GB）',
      '关闭浏览器、直播、网盘同步等占内存的程序',
      '内存不应超过物理内存的 60%，否则系统会开始使用虚拟内存反而更卡',
    ]
  },
  E2101: {
    code: 'E2101',
    category: 'loader',
    title: '加载器安装器卡住 / 超时',
    reasons: [
      'Forge / NeoForge 安装器联网下载依赖时被墙或超时',
      '网络抖动导致安装器的请求长时间无响应',
      '杀毒软件拦截了安装器的写入',
    ],
    steps: [
      '在「设置 → 下载源」切换为 BMCLAPI 镜像后重试',
      '关闭杀毒软件的实时防护后重试一次',
      '把 VPN / 代理换成延迟更低的节点，或临时关闭',
      '仍然失败时，直接去 Forge 官网手动下载安装器，装到本启动器的 data 目录',
    ]
  },
  E2102: {
    code: 'E2102',
    category: 'pack',
    title: '整合包部分文件下载失败',
    reasons: [
      'CurseForge CDN 限速或连接被重置',
      '作者关闭了第三方下载（该文件不再允许 API 下载）',
      '网络中途断开',
    ],
    steps: [
      '重新导入同一个整合包，启动器会跳过已下载的文件、只补缺失的',
      '切换网络（手机热点 / 换节点）后重试',
      '若反复失败且是同一批文件，多半是作者关闭了下载，需要手动下载后放入 mods 目录',
    ]
  },
  E2103: {
    code: 'E2103',
    category: 'pack',
    title: '整合包模组文件不完整',
    reasons: ['下载过程中断', '磁盘写入失败或空间不足', '杀毒软件删除了 jar 文件'],
    steps: [
      '确认磁盘剩余空间充足',
      '重新导入整合包，启动器会自动补齐缺少的 jar',
      '把杀毒软件的隔离区检查一遍，把被删的 jar 恢复并加白名单',
    ]
  },
  E3001: {
    code: 'E3001',
    category: 'loader',
    title: '加载器列表获取失败',
    reasons: ['网络无法访问加载器接口', '所选 MC 版本没有对应加载器'],
    steps: ['检查网络后重试', '换一个加载器（如 Forge 换 NeoForge）', '确认该 MC 版本确实有对应加载器版本']
  },
  E4001: {
    code: 'E4001',
    category: 'account',
    title: '账号未登录或已失效',
    reasons: ['令牌过期', '更换电脑后令牌未迁移'],
    steps: ['在侧栏重新登录', '离线账号可随时新建，不需要网络']
  },
  E5001: {
    code: 'E5001',
    category: 'pack',
    title: '整合包无法识别',
    reasons: ['压缩包不是标准整合包格式', '文件损坏或没下载完整'],
    steps: [
      '确认是 Modrinth（.mrpack）或 CurseForge 整合包（含 manifest.json）的压缩包',
      '重新下载整合包，确认文件大小与发布页一致',
      '若是普通「模组合集压缩包」，请解压后把 jar 放进项目的 mods 目录',
    ]
  },
  E9001: {
    code: 'E9001',
    category: 'account',
    title: '账号状态异常',
    reasons: ['令牌失效', '账号被移除'],
    steps: ['重新登录账号', '或在侧栏切换到一个可用的账号']
  },
  E9002: {
    code: 'E9002',
    category: 'account',
    title: '昵称格式不正确',
    reasons: ['昵称包含中文、空格或特殊字符', '长度不在 3~16 位之间'],
    steps: ['只用英文字母、数字、下划线，长度 3~16 位', '例如 Steve、Alex_2024']
  },

  E3002: {
    code: 'E3002',
    category: 'loader',
    title: '加载器安装失败',
    reasons: ['安装器下载失败（网络问题）', '安装器运行报错（Java 版本不对）', '磁盘空间不足'],
    steps: [
      '确认磁盘剩余空间 ≥ 2 GB',
      '在「设置 → 下载源」切换为 BMCLAPI 镜像后重试',
      '确认 Java 版本与 MC 版本匹配（1.17+ 用 Java 17）',
      '仍失败时手动下载对应加载器安装器，装到本启动器目录后重新导入',
    ]
  },  E2104: {
    code: 'E2104',
    category: 'file',
    title: '游戏资源文件缺失',
    reasons: [
      '资源索引/对象没下载完',
      '磁盘空间不足导致中断',
    ],
    steps: [
      '在「版本设置 → 校验文件」补齐资源',
      '确认磁盘剩余 ≥ 5 GB 后重试',
    ]
  },
  E2105: {
    code: 'E2105',
    category: 'env',
    title: '元空间（Metaspace）耗尽',
    reasons: [
      '模组类太多，JVM 元数据区不够',
    ],
    steps: [
      '在 JVM 参数里加 -XX:MaxMetaspaceSize=1024m',
      '不要同时把 -Xmx 设得太小',
    ]
  },
  E2106: {
    code: 'E2106',
    category: 'env',
    title: 'JVM 无法申请内存 / 线程',
    reasons: [
      '分配内存超过系统上限',
      '用了 32 位 Java',
    ],
    steps: [
      '把内存分配下调 2~4 GB',
      '确认使用 64 位 Java',
    ]
  },
  E2107: {
    code: 'E2107',
    category: 'pack',
    title: '模组 ID 重复',
    reasons: [
      '同一个模组装了两份（新旧版本并存）',
    ],
    steps: [
      '在 mods 目录删掉旧版本',
      '或用模组页禁用其中一个',
    ]
  },
  E2108: {
    code: 'E2108',
    category: 'loader',
    title: 'Forge / NeoForge 版本不匹配',
    reasons: [
      '模组要求更高的加载器版本',
    ],
    steps: [
      '在「版本设置 → 加载器」改成要求的版本',
      '或把该模组换成适配当前版本的老版本',
    ]
  },
  E2109: {
    code: 'E2109',
    category: 'pack',
    title: '模组与 MC 版本不兼容',
    reasons: [
      '模组是给别的 MC 版本做的',
    ],
    steps: [
      '删掉不兼容模组',
      '或新建对应 MC 版本的项目',
    ]
  },
  E2110: {
    code: 'E2110',
    category: 'pack',
    title: 'OptiFine 冲突',
    reasons: [
      'Forge 环境同时装 OptiFine 与其他优化模组',
    ],
    steps: [
      '删除 OptiFine，改用 Embeddium/Rubidium + Oculus',
      '确认没有同时装两个优化模组',
    ]
  },
  E2111: {
    code: 'E2111',
    category: 'pack',
    title: '缺少文件',
    reasons: [
      '模组或配置被删除',
      '下载中断',
    ],
    steps: [
      '在「版本设置 → 校验文件」补齐',
      '重新导入整合包可补回 jar',
    ]
  },
  E2112: {
    code: 'E2112',
    category: 'env',
    title: 'OpenGL 版本不受支持',
    reasons: [
      '核显或老驱动不支持 OpenGL 3.2+',
      '在远程桌面/虚拟机里运行',
    ],
    steps: [
      '更新显卡驱动',
      '不要用远程桌面运行游戏',
      '老显卡只能退低版本 MC',
    ]
  },
  E2113: {
    code: 'E2113',
    category: 'env',
    title: '显存不足',
    reasons: [
      '光影/高分辨率资源包吃满显存',
    ],
    steps: [
      '关闭光影或换轻量光影',
      '降低渲染距离与贴图分辨率',
    ]
  },
  E2114: {
    code: 'E2114',
    category: 'env',
    title: 'JVM 参数无效',
    reasons: [
      'JVM 参数里有当前 Java 不支持的选项',
    ],
    steps: [
      '清空 JVM 参数后重试',
      '确认 Java 位数与内存分配匹配',
    ]
  },
  E2115: {
    code: 'E2115',
    category: 'pack',
    title: '存档损坏',
    reasons: [
      '区块/region 文件损坏',
      '异常断电或写入中断',
    ],
    steps: [
      '先备份 saves 目录',
      '移走日志点名的 .mca 文件让游戏重建该区块',
      '或回退到存档备份',
    ]
  },
  E2116: {
    code: 'E2116',
    category: 'pack',
    title: '存档版本过新',
    reasons: [
      '存档是更高版本游戏保存的',
    ],
    steps: [
      '用保存它的那个 MC 版本打开',
      '不要用低版本强行打开',
    ]
  },
  E2117: {
    code: 'E2117',
    category: 'pack',
    title: '维度缺失',
    reasons: [
      '删掉了提供该维度的模组',
    ],
    steps: [
      '把模组装回来',
      '或新建世界不要继续用该存档',
    ]
  },
  E2118: {
    code: 'E2118',
    category: 'pack',
    title: '数据包 / 资源包格式错误',
    reasons: [
      '包是给别的 MC 版本做的',
      'pack.mcmeta 缺失',
    ],
    steps: [
      '移走该包再启动',
      '重新下载对应版本的包',
    ]
  },
  E2119: {
    code: 'E2119',
    category: 'file',
    title: '磁盘空间不足',
    reasons: [
      '磁盘写满',
    ],
    steps: [
      '清理磁盘至少留 5 GB（大包 10 GB）',
      '把数据目录迁到更大的盘',
    ]
  },
  E2120: {
    code: 'E2120',
    category: 'file',
    title: '文件被占用 / 无权限',
    reasons: [
      '第二个启动器实例在运行',
      '杀毒软件正在扫描',
      '以管理员身份运行导致权限错乱',
    ],
    steps: [
      '关掉重复实例与杀软实时防护',
      '不要用管理员身份运行',
      '重启电脑再试',
    ]
  },
  E2121: {
    code: 'E2121',
    category: 'file',
    title: '杀毒软件误删模组',
    reasons: [
      'jar 被判定为威胁并隔离',
    ],
    steps: [
      '在安全中心还原被隔离文件',
      '把 mods 目录加入排除项',
      '重新导入整合包补齐',
    ]
  },
  E2122: {
    code: 'E2122',
    category: 'net',
    title: '模组联网失败',
    reasons: [
      '有模组在加载时请求被墙的域名',
      '代理/防火墙拦截',
    ],
    steps: [
      '通常可忽略；卡加载时关掉联网检查类模组',
      '检查代理设置',
    ]
  },
  E2123: {
    code: 'E2123',
    category: 'net',
    title: '端口被占用',
    reasons: [
      '上次的游戏进程没退干净',
      '其他联机软件占用端口',
    ],
    steps: [
      '任务管理器结束残留 javaw.exe',
      '联机页重新开房会自动换端口',
    ]
  },
  E2124: {
    code: 'E2124',
    category: 'env',
    title: '游戏进程被强制结束',
    reasons: [
      '被系统杀掉（内存吃满）',
      '用户点了停止',
      '被优化软件结束',
    ],
    steps: [
      '调小内存分配或关闭其他程序',
      '把 javaw.exe 加入杀软白名单',
    ]
  },

  /* ── 启动前预估警告 ── */
  P1001: {
    code: 'P1001',
    category: 'warn',
    title: '内存分配不足',
    warn: true,
    reasons: ['项目需要的堆内存大于当前分配值', '整合包模组数量较多'],
    steps: ['点「去版本设置」把内存调到弹窗建议值', '若物理内存不够，减少同时运行的程序']
  },
  P1002: {
    code: 'P1002',
    category: 'warn',
    title: '可能超出显卡显存',
    warn: true,
    reasons: ['开启光影后显存占用显著上升', '高分辨率资源包同样吃显存'],
    steps: ['关闭光影或换轻量光影', '降低渲染距离与模拟距离', '降低游戏分辨率或使用窗口模式']
  },
  P1003: {
    code: 'P1003',
    category: 'warn',
    title: 'CPU 性能可能不足',
    warn: true,
    reasons: ['模组数量多，单个区块的 tick 计算量大', '低功耗 / 老架构 CPU 单核性能弱'],
    steps: ['降低模拟距离（最影响 CPU）', '关闭「实体渲染」类模组或减少实体数量', '关闭后台占 CPU 的程序']
  }
}

export function lookupError(code?: string): ErrEntry | null {
  if (!code) return null
  return ERROR_CATALOG[code.trim().toUpperCase()] ?? null
}
