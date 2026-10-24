import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppSettings, AppState } from '@shared/types'
import type { InstallProgress, VersionSummary } from '@shared/mclib'

const api = {
  uiFlags: {
    /** 开发验证用：启动即弹出错误弹窗，检查文案与按钮 */
    testErrorDialog: process.env.RAINBOW_TEST_ERR === '1'
  },
  getState: (): Promise<AppState> => ipcRenderer.invoke('app:getState'),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getPaths: (): Promise<{ root: string; logs: string; games: string }> => ipcRenderer.invoke('app:paths'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppState> =>
    ipcRenderer.invoke('settings:update', patch),
  setActive: (patch: { activeAccountId?: string; activeProjectId?: string }): Promise<AppState> =>
    ipcRenderer.invoke('app:setActive', patch),
  openLogs: (): Promise<boolean> => ipcRenderer.invoke('open:logs'),
  openPath: (p: string): Promise<boolean> => ipcRenderer.invoke('open:path', p),
  mc: {
    manifest: (force?: boolean): Promise<{ latest: { release: string; snapshot: string }; versions: VersionSummary[] }> =>
      ipcRenderer.invoke('mc:manifest', force),
    installed: (): Promise<{ id: string; type: string; installedAt: number }[]> => ipcRenderer.invoke('mc:installed'),
    install: (id: string): Promise<{ ok: boolean; errors: string[] }> => ipcRenderer.invoke('mc:install', id),
    javaCheck: (major: number): Promise<string | null> => ipcRenderer.invoke('mc:javaCheck', major),
    javaEnsure: (major: number): Promise<{ path: string; major: number; downloaded: boolean }> =>
      ipcRenderer.invoke('mc:javaEnsure', major),
    launch: (
      projectId: string
    ): Promise<{ ok: boolean; code?: number; errorCode?: string; message?: string; zip?: string; runId?: string }> =>
      ipcRenderer.invoke('mc:launch', projectId),
    onInstallProgress: (cb: (p: InstallProgress) => void): (() => void) => {
      const handler = (_e: unknown, p: InstallProgress): void => cb(p)
      ipcRenderer.on('mc:install-progress', handler)
      return () => ipcRenderer.removeListener('mc:install-progress', handler)
    },
    onLaunchLine: (cb: (p: { runId: string; line: string }) => void): (() => void) => {
      const handler = (_e: unknown, p: { runId: string; line: string }): void => cb(p)
      ipcRenderer.on('mc:launch-line', handler)
      return () => ipcRenderer.removeListener('mc:launch-line', handler)
    },
    onLaunchDone: (
      cb: (p: {
        ok: boolean
        killed?: boolean
        code?: number
        errorCode?: string
        message?: string
        zip?: string
      }) => void
    ): (() => void) => {
      const handler = (
        _e: unknown,
        p: { ok: boolean; killed?: boolean; code?: number; errorCode?: string; message?: string; zip?: string }
      ): void => cb(p)
      ipcRenderer.on('mc:launch-done', handler)
      return () => ipcRenderer.removeListener('mc:launch-done', handler)
    },
    kill: (runId?: string): Promise<boolean> => ipcRenderer.invoke('mc:kill', runId),
    running: (): Promise<{ runId: string; projectId: string }[]> => ipcRenderer.invoke('mc:running'),
    onRunning: (cb: (p: { running: boolean; runId: string; projectId: string }) => void): (() => void) => {
      const handler = (_e: unknown, p: { running: boolean; runId: string; projectId: string }): void => cb(p)
      ipcRenderer.on('mc:running', handler)
      return () => ipcRenderer.removeListener('mc:running', handler)
    }
  },

  mp: {
    status: (): Promise<unknown> => ipcRenderer.invoke('mp:status'),
    binary: (): Promise<{ path: string; exists: boolean; sizeMB: number }> => ipcRenderer.invoke('mp:binary'),
    install: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('mp:install'),
    host: (player: string): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('mp:host', player),
    join: (code: string, player: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('mp:join', { code, player }),
    idle: (): Promise<unknown> => ipcRenderer.invoke('mp:idle'),
    stop: (): Promise<unknown> => ipcRenderer.invoke('mp:stop'),
    onState: (cb: (s: unknown) => void): (() => void) => {
      const handler = (_e: unknown, s: unknown): void => cb(s)
      ipcRenderer.on('mp:state', handler as never)
      return () => ipcRenderer.removeListener('mp:state', handler as never)
    },
    onProgress: (cb: (p: { message?: string }) => void): (() => void) => {
      const handler = (_e: unknown, p: { message?: string }): void => cb(p)
      ipcRenderer.on('mp:progress', handler as never)
      return () => ipcRenderer.removeListener('mp:progress', handler as never)
    }
  },
  account: {
    list: (): Promise<import('@shared/types').AccountInfo[]> => ipcRenderer.invoke('account:list'),
    localLogin: (name: string): Promise<{ ok: boolean; errorCode?: string; message?: string; account?: import('@shared/types').AccountInfo }> =>
      ipcRenderer.invoke('account:localLogin', { name }),
    setActive: (id: string): Promise<AppState> => ipcRenderer.invoke('account:setActive', id),
    remove: (id: string): Promise<AppState> => ipcRenderer.invoke('account:remove', id),
    onDeviceCode: (cb: (p: { userCode: string; uri: string; expiresIn: number }) => void): (() => void) => {
      const handler = (_e: unknown, p: { userCode: string; uri: string; expiresIn: number }): void => cb(p)
      ipcRenderer.on('ms:device-code', handler)
      return () => ipcRenderer.removeListener('ms:device-code', handler)
    }
  },
  appearance: {
    pickImage: (): Promise<{ ok: boolean; canceled?: boolean; dataUrl?: string; name?: string; message?: string }> =>
      ipcRenderer.invoke('appearance:pickImage'),
    saveBackground: (dataUrl: string): Promise<{ ok: boolean; url?: string; message?: string }> =>
      ipcRenderer.invoke('appearance:saveBackground', { dataUrl }),
    resetBackground: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('appearance:resetBackground'),
    setPreset: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('appearance:setPreset'),
    setDefault: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('appearance:setDefault'),
    update: (
      patch: Partial<{ backgroundDim: number; material: string; accent: string }>
    ): Promise<{ ok: boolean; url?: string }> => ipcRenderer.invoke('appearance:update', patch)
  },
  avatar: {
    save: (accountId: string, dataUrl: string): Promise<{ ok: boolean; file?: string; message?: string }> =>
      ipcRenderer.invoke('avatar:save', { accountId, dataUrl }),
    reset: (accountId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('avatar:reset', accountId),
    pick: (): Promise<{ ok: boolean; canceled?: boolean; dataUrl?: string; message?: string }> =>
      ipcRenderer.invoke('appearance:pickImage')
  },  copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('app:copyText', text),
  downloads: {
    snapshot: (): Promise<unknown[]> => ipcRenderer.invoke('dl:snapshot'),
    onTasks: (
      cb: (list: { id: string; label: string; kind: string; pct: number; speed: number; loaded: number; total: number }[]) => void
    ): (() => void) => {
      const handler = (_e: unknown, list: Parameters<typeof cb>[0]): void => cb(list)
      ipcRenderer.on('dl:tasks', handler)
      return () => ipcRenderer.removeListener('dl:tasks', handler)
    }
  },  loader: {
    list: (
      loader: string,
      mcVersion: string
    ): Promise<{
      ok: boolean
      list?: { loader: string; version: string; stable?: boolean }[]
      support?: { fabric: boolean; quilt: boolean; forge: boolean; neoforge: boolean }
      message?: string
    }> => ipcRenderer.invoke('loader:list', { loader, mcVersion }),
    install: (
      loader: 'fabric' | 'forge' | 'neoforge' | 'quilt',
      mcVersion: string,
      loaderVersion: string,
      projectName?: string
    ): Promise<{ ok: boolean; versionId?: string; message?: string; project?: import('@shared/types').GameProject }> =>
      ipcRenderer.invoke('loader:install', { loader, mcVersion, loaderVersion, projectName }),
    download: (loader: string, mcVersion: string, loaderVersion: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('loader:download', { loader, mcVersion, loaderVersion }),
    onProgress: (cb: (p: { message: string }) => void): (() => void) => {
      const handler = (_e: unknown, p: { message: string }): void => cb(p)
      ipcRenderer.on('loader:progress', handler)
      return () => ipcRenderer.removeListener('loader:progress', handler)
    }
  },
  project: {
    list: (): Promise<import('@shared/types').GameProject[]> => ipcRenderer.invoke('project:list'),
    create: (
      name: string,
      mcVersion: string,
      loader?: string
    ): Promise<{ ok: boolean; project?: import('@shared/types').GameProject }> =>
      ipcRenderer.invoke('project:create', { name, mcVersion, loader }),
    rename: (id: string, name: string): Promise<AppState> => ipcRenderer.invoke('project:rename', { id, name }),
    remove: (id: string): Promise<AppState> => ipcRenderer.invoke('project:remove', id),
    setActive: (id: string): Promise<AppState> => ipcRenderer.invoke('project:setActive', id),
    openDir: (id: string): Promise<boolean> => ipcRenderer.invoke('project:openDir', id)
  },
  logs: {
    list: (): Promise<{ name: string; path: string; size: number; mtime: number }[]> => ipcRenderer.invoke('logs:list')
  },
  pack: {
    importPath: (path: string, name?: string): Promise<{ ok: boolean; name?: string; message?: string }> =>
      ipcRenderer.invoke('pack:importPath', { path, name }),
    cancel: (): Promise<boolean> => ipcRenderer.invoke('pack:cancel'),
    onProgress: (cb: (p: { stage: string; done: number; total: number; name: string }) => void): (() => void) => {
      const handler = (_e: unknown, p: { stage: string; done: number; total: number; name: string }): void => cb(p)
      ipcRenderer.on('pack:progress', handler)
      return () => ipcRenderer.removeListener('pack:progress', handler)
    },
    nameTaken: (name: string): Promise<boolean> => ipcRenderer.invoke('project:nameTaken', name),
    uniqueName: (name: string): Promise<string> => ipcRenderer.invoke('project:uniqueName', name)
  },
  library: {
    list: (): Promise<
      {
        id: string
        projectId: string
        title: string
        kind: string
        versionNumber: string
        fileName: string
        loaders: string[]
        gameVersions: string[]
        size: number
        downloadedAt: number
      }[]
    > => ipcRenderer.invoke('library:list'),
    remove: (id: string): Promise<{ ok: boolean; usedBy: string[] }> => ipcRenderer.invoke('library:remove', id),
    usage: (id: string): Promise<string[]> => ipcRenderer.invoke('library:usage', id),
    apply: (ids: string[], projectId: string): Promise<{ ok: boolean; copied: string[]; message?: string }> =>
      ipcRenderer.invoke('library:apply', { ids, projectId }),
    applyLoader: (id: string, projectId: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('library:applyLoader', { id, projectId }),
    usageDetail: (id: string): Promise<{ id: string; name: string; has: boolean }[]> =>
      ipcRenderer.invoke('library:usageDetail', id),
    removeFromProject: (id: string, projectId: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('library:removeFromProject', { id, projectId }),
    projectState: (projectId: string): Promise<Record<string, boolean>> =>
      ipcRenderer.invoke('library:projectState', projectId),
    download: (payload: {
      projectId: string
      title: string
      kind: 'mod' | 'modpack' | 'shader' | 'resourcepack'
      versionId: string
      iconUrl?: string
    }): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('library:download', payload)
  },  modrinth: {
    projectInfo: (id: string): Promise<{ ok: boolean; info?: never; message?: string }> =>
      ipcRenderer.invoke('modrinth:projectInfo', id),
    depInfo: (
      versionId: string,
      projectId: string,
      targetProjectId?: string
    ): Promise<{
      ok: boolean
      deps?: { projectId: string; title: string; installed: boolean }[]
      neededLoader?: string | null
      mcVersions?: string[]
      version?: { id: string; name: string; versionNumber: string; gameVersions: string[]; loaders: string[] }
      message?: string
    }> => ipcRenderer.invoke('modrinth:depInfo', { versionId, projectId, targetProjectId }),
    installDeps: (
      versionId: string,
      targetProjectId: string
    ): Promise<{ ok: boolean; installed?: string[]; skipped?: string[]; failed?: string[]; message?: string }> =>
      ipcRenderer.invoke('modrinth:installDeps', { versionId, targetProjectId }),
    search: (
      kind: 'mod' | 'modpack' | 'shader' | 'resourcepack',
      query: string,
      loader?: string,
      mcVersion?: string,
      offset?: number,
      opts?: { limit?: number; index?: 'relevance' | 'downloads' | 'newest' | 'updated' }
    ): Promise<{ ok: boolean; hits?: unknown[]; total_hits?: number; message?: string }> =>
      ipcRenderer.invoke('modrinth:search', {
        kind,
        query,
        loader,
        mcVersion,
        offset,
        limit: opts?.limit,
        index: opts?.index
      }),
    versions: (
      projectId: string,
      loader?: string,
      mcVersion?: string
    ): Promise<{ ok: boolean; list?: unknown[]; message?: string }> =>
      ipcRenderer.invoke('modrinth:versions', { projectId, loader, mcVersion }),
    install: (payload: {
      projectId: string
      title: string
      kind: 'mod' | 'modpack' | 'shader' | 'resourcepack'
      versionId: string
      targetProjectId: string
    }): Promise<{ ok: boolean; fileName?: string; issues?: unknown[]; message?: string }> =>
      ipcRenderer.invoke('modrinth:install', payload)
  },
  mods: {
    list: (projectId: string): Promise<{ entries: unknown[]; issues: unknown[] }> =>
      ipcRenderer.invoke('mods:list', projectId),
    remove: (projectId: string, fileName: string): Promise<{ entries: unknown[]; issues: unknown[] }> =>
      ipcRenderer.invoke('mods:remove', { projectId, fileName }),
    fromFile: (
      projectId: string
    ): Promise<{ ok: boolean; count?: number; mods?: { fileName: string; enabled: boolean; size: number }[]; message?: string }> =>
      ipcRenderer.invoke('mods:fromFile', projectId),
    bulk: (
      projectId: string,
      enable: boolean
    ): Promise<{ ok: boolean; mods: { fileName: string; enabled: boolean; size: number }[] }> =>
      ipcRenderer.invoke('mods:bulk', { projectId, enable })
  },
  launcher: {    folders: (): Promise<{ path: string; label: string }[]> => ipcRenderer.invoke('launcher:folders'),
    addFolder: (): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke('launcher:addFolder'),
    importPack: (): Promise<{
      ok: boolean
      projectId?: string
      name?: string
      mcVersion?: string
      loader?: string
      message?: string
    }> => ipcRenderer.invoke('launcher:importPack')
  },
  zh: {
    batch: (
      items: { slug: string; title: string }[]
    ): Promise<{ ok: boolean; map: Record<string, string>; cached?: number; message?: string }> =>
      ipcRenderer.invoke('zh:batch', items)
  },
  instance: {
    stats: (): Promise<{ id: string; modCount: number; saveCount: number; lastPlayedAt: number; createdAt: number }[]> =>
      ipcRenderer.invoke('projects:stats'),
    info: (projectId: string): Promise<{
      ok: boolean
      project?: import('@shared/types').GameProject
      dir?: string
      mods?: { fileName: string; enabled: boolean; size: number }[]
      saves?: { name: string; size: number; mtime: number }[]
      issues?: { level: string; message: string }[]
      installed?: unknown[]
      message?: string
    }> => ipcRenderer.invoke('instance:info', projectId),
    update: (
      id: string,
      patch: Partial<import('@shared/types').GameProject>
    ): Promise<AppState> => ipcRenderer.invoke('instance:update', { id, patch }),
    memInfo: (): Promise<{ totalMb: number; autoMb: number }> => ipcRenderer.invoke('instance:memInfo'),
    exportScript: (projectId: string): Promise<{ ok: boolean; path?: string; message?: string }> =>
      ipcRenderer.invoke('instance:exportScript', projectId),
    repair: (projectId: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('instance:repair', projectId),
    openScreenshotsDir: (projectId: string): Promise<boolean> =>
      ipcRenderer.invoke('instance:openScreenshotsDir', projectId),
    toggleMod: (
      projectId: string,
      fileName: string
    ): Promise<{ ok: boolean; mods: { fileName: string; enabled: boolean; size: number }[] }> =>
      ipcRenderer.invoke('instance:toggleMod', { projectId, fileName }),
    deleteMod: (
      projectId: string,
      fileName: string
    ): Promise<{ ok: boolean; mods: { fileName: string; enabled: boolean; size: number }[] }> =>
      ipcRenderer.invoke('instance:deleteMod', { projectId, fileName }),
    backupSave: (projectId: string, saveName: string): Promise<{ ok: boolean; path?: string; message?: string }> =>
      ipcRenderer.invoke('instance:backupSave', { projectId, saveName }),
    deleteSave: (
      projectId: string,
      saveName: string
    ): Promise<{ ok: boolean; saves: { name: string; size: number; mtime: number }[] }> =>
      ipcRenderer.invoke('instance:deleteSave', { projectId, saveName }),
    openDir: (projectId: string): Promise<boolean> => ipcRenderer.invoke('instance:openDir', projectId),
    openModsDir: (projectId: string): Promise<boolean> => ipcRenderer.invoke('instance:openModsDir', projectId),
    openSavesDir: (projectId: string): Promise<boolean> => ipcRenderer.invoke('instance:openSavesDir', projectId),
    export: (projectId: string): Promise<{ ok: boolean; path?: string; message?: string }> =>
      ipcRenderer.invoke('instance:export', projectId)
  },
  update: {
    local: (): Promise<{ version: string; code: number }> => ipcRenderer.invoke('update:local'),
    check: (): Promise<{
      ok: boolean
      state: 'older' | 'same' | 'newer' | 'unknown'
      local: { version: string; code: number }
      latest?: {
        version: string
        versionCode: number
        downloadUrl: string
        sha256: string
        size: number
        notes?: string
        mandatory?: boolean
        publishedAt?: string
      }
      channel: string
      message?: string
    }> => ipcRenderer.invoke('update:check'),
    skip: (version: string): Promise<boolean> => ipcRenderer.invoke('update:skip', version),
    download: (latest: unknown): Promise<{ ok: boolean; path?: string; message?: string }> =>
      ipcRenderer.invoke('update:download', latest),
    apply: (path: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('update:apply', path),
    open: (url: string): Promise<boolean> => ipcRenderer.invoke('update:open', url),
    onProgress: (cb: (p: { loaded: number; total: number }) => void): (() => void) => {
      const h = (_e: unknown, p: { loaded: number; total: number }): void => cb(p)
      ipcRenderer.on('update:progress', h)
      return () => ipcRenderer.removeListener('update:progress', h)
    }
  },  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('win:toggleMaximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

// Electron 32+ 起 File.path 已移除，拖进来的文件必须用 webUtils.getPathForFile 取真实路径。
// preload 和渲染进程共享 DOM，所以在 preload 里监听 drop，把路径转发给界面。
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
})
window.addEventListener('drop', (e) => {
  const files = e.dataTransfer?.files
  if (!files || !files.length) return
  e.preventDefault()
  const f = files[0]
  let p = ''
  try {
    p = webUtils.getPathForFile(f)
  } catch {
    p = ''
  }
  window.dispatchEvent(
    new CustomEvent('rainbow:file-drop', { detail: { path: p, name: f.name || '' } })
  )
})
