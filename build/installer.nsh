; ────────────────────────────────────────────────────────────────
;  RAINBOW MC 安装程序自定义脚本
;
;  核心原则：安装 / 覆盖 / 卸载 都不许碰 data/（存档、组件库、游戏版本、
;  加载器、资源、Java 运行时、日志全在里面）
;
;  实现方式（2026-10-22 重写）：
;    · 删除旧版本时**只删程序文件**（exe/dll/pak/resources/locales…），
;      不再“先把 data 搬到别处再搬回来”
;      —— 那套做法在大存档（5GB）下会卡死，还出过“搬回去时把数据删掉”的事故
;    · 因此 data/ 从头到尾原地不动，物理上不可能丢
; ────────────────────────────────────────────────────────────────

!include "LogicLib.nsh"

; 安装开始时弹出语言选择框（默认繁中）
!define DISPLAY_LANG_SELECTOR

; 语言选择框默认项 = 繁體中文（1028）
!macro preInit
  StrCpy $LANGUAGE 1028
!macroend

!macro customInit
  ; 装到「和上次不同的目录」时直接中止安装。
  ; 原因：electron-builder 会调用旧版卸载程序，把另一份安装的程序文件删掉
  ;（2026-10-22 实测：向测试目录安装后，D:\APP 里用户那份 exe 被删了）。
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RAINBOW MC" "InstallLocation"
  ${If} $0 == ""
    ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\RAINBOW MC" "InstallLocation"
  ${EndIf}
  ; /ALLOWOTHER：允许装到另一个目录（给自动化测试用，正常安装不要传）
  ${GetParameters} $1
  ${GetOptions} $1 "/ALLOWOTHER" $2
  ${If} ${Errors}
    StrCpy $2 ""
  ${EndIf}
  ${If} $2 == ""
  ${AndIf} $0 != ""
  ${AndIf} $0 != $INSTDIR
    MessageBox MB_ICONSTOP|MB_OK|MB_DEFBUTTON1 "检测到已安装的 RAINBOW MC：$\r$\n$0$\r$\n$\r$\n请先卸载旧版本，或安装到同一个目录。$\r$\n（为避免误删另一份安装，本次安装已中止；你的存档不会被删除）" /SD IDOK
    Abort
  ${EndIf}

  ; 只在用户「没有指定目录」时，才沿用上次安装位置
  ${If} $INSTDIR == "$LOCALAPPDATA\Programs\RAINBOW MC"
    ${If} $0 != ""
      StrCpy $INSTDIR $0
    ${EndIf}
  ${EndIf}
!macroend

; 覆盖 electron-builder 的「删除安装文件」：只删程序本体，data/ 原地保留
!macro customRemoveFiles
  Delete "$INSTDIR\*.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\*.txt"
  Delete "$INSTDIR\*.html"
  Delete "$INSTDIR\*.ico"
  Delete "$INSTDIR\*.yml"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  ; ⚠️ 绝对不要 RMDir /r "$INSTDIR" —— 那会把 data/ 一起删掉
!macroend

!macro customInstall
  ; 数据子目录（首次安装时创建；已存在则不动）
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\data\games"
  CreateDirectory "$INSTDIR\data\versions"
  CreateDirectory "$INSTDIR\data\assets"
  CreateDirectory "$INSTDIR\data\libraries"
  CreateDirectory "$INSTDIR\data\runtime"
  CreateDirectory "$INSTDIR\data\logs"
  CreateDirectory "$INSTDIR\data\cache"
  CreateDirectory "$INSTDIR\data\backgrounds"

  ; 静默安装（客户端自动更新）完成后把启动器拉起来
  ${If} ${Silent}
    Exec "$INSTDIR\RAINBOW MC.exe"
  ${EndIf}

  ; 记录安装位置
  WriteRegStr HKCU "Software\RAINBOW MC" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RAINBOW MC" "InstallLocation" "$INSTDIR"
!macroend

; 卸载：模板会自己删程序文件；这里不做任何 data/ 相关操作
!macro customUnInstall
  ; 有意留空：data/ 原样保留
!macroend

; ────────────────────────────────────────────────────────────────
;  免责条款：3 语言（简中 / 繁中 / English）
;
;  实现要点（2026-10-22）：
;    ① package.json 里**不再**设置 build.nsis.license，
;       否则模板会额外插一个「单语言」许可页，出现两页。
;    ② 这里用 LicenseLangString 按安装器当前语言挑文件，
;       用户切换语言时条款跟着换。
;    ③ 三个 txt 必须是 **UTF-8 带 BOM**。
;       NSIS 的 Unicode 安装器靠 BOM 识别编码，没有 BOM 会按系统
;       代码页（GBK）解释 → 中文全变乱码。这是最常见的乱码原因。
;    ④ 路径用 ${BUILD_RESOURCES_DIR}（electron-builder 定义的 build 目录），
;       不能用相对路径 —— 编译发生在临时目录里，相对路径会找不到文件。
; ────────────────────────────────────────────────────────────────
!macro customPageAfterChangeDir
  ; 直接用数字语言 ID，不依赖 ${LANG_*} 常量
  ;   2052 = 简体中文   1028 = 繁體中文   1033 = English (US)
  LicenseLangString RAINBOW_LICENSE_FILE 2052 "${BUILD_RESOURCES_DIR}\license_zh_CN.txt"
  LicenseLangString RAINBOW_LICENSE_FILE 1028 "${BUILD_RESOURCES_DIR}\license_zh_TW.txt"
  LicenseLangString RAINBOW_LICENSE_FILE 1033 "${BUILD_RESOURCES_DIR}\license_en_US.txt"

  !insertmacro MUI_PAGE_LICENSE "$(RAINBOW_LICENSE_FILE)"
!macroend
