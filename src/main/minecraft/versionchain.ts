import type { AppSettings } from '@shared/types'
import type { MinecraftVersionJson } from '@shared/mclib'
import { getVersionJson } from './installer'

/** 拉取版本 JSON，并按 inheritsFrom 合并父版本（Forge/NeoForge/Fabric 都靠这个） */
export async function getVersionJsonChain(
  id: string,
  source: AppSettings['downloadSource']
): Promise<{ json: MinecraftVersionJson; versionId: string }> {
  const child = await getVersionJson(id, source)
  if (!child.inheritsFrom) return { json: child, versionId: id }

  const parent = await getVersionJson(child.inheritsFrom, source)
  return { json: merge(parent, child), versionId: parent.id }
}

function merge(parent: MinecraftVersionJson, child: MinecraftVersionJson): MinecraftVersionJson {
  const gameArgs = [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])]
  const jvmArgs = [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])]
  return {
    ...parent,
    ...child,
    id: child.id,
    mainClass: child.mainClass || parent.mainClass,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    assets: child.assets ?? parent.assets,
    javaVersion: child.javaVersion ?? parent.javaVersion,
    libraries: [...(parent.libraries ?? []), ...(child.libraries ?? [])],
    arguments: { game: gameArgs, jvm: jvmArgs },
    minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
    logging: child.logging ?? parent.logging,
    downloads: { ...(parent.downloads ?? {}), ...(child.downloads ?? {}) }
  }
}
