import type { ComponentLoader } from './types'

export interface VersionSummary {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  releaseTime: string
  url: string
}

export interface InstallProgress {
  versionId: string
  stage: 'prepare' | 'client' | 'libraries' | 'assets' | 'done' | 'error'
  done: number
  total: number
  bytes: number
  message?: string
}

export interface InstalledVersion {
  id: string
  type: string
  mcVersion: string
  loader: ComponentLoader
  installedAt: number
  sizeBytes: number
}

export interface MinecraftVersionJson {
  id: string
  type: string
  mainClass: string
  inheritsFrom?: string
  assetIndex?: { id: string; url: string; sha1: string; size: number }
  assets?: string
  downloads?: Record<string, { url: string; sha1?: string; size?: number }>
  libraries: LibraryEntry[]
  javaVersion?: { component: string; majorVersion: number }
  arguments?: {
    game?: (string | { rules: Rule[]; value: string | string[] })[]
    jvm?: (string | { rules: Rule[]; value: string | string[] })[]
  }
  minecraftArguments?: string
  logging?: Record<string, { argument: string; file: { id: string; url: string; sha1?: string; size?: number } }>
}

export interface LibraryEntry {
  name: string
  downloads?: {
    artifact?: { path: string; url: string; sha1?: string; size?: number }
    classifiers?: Record<string, { path: string; url: string; sha1?: string; size?: number }>
  }
  rules?: Rule[]
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; arch?: string; version?: string }
  features?: Record<string, boolean>
}
