import React, { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'

interface Estimate {
  ramMb: number
  allocatedMb: number
  vramMb: number
  cpuLoadText: string
  mods: number
  shaderPacks: number
  resourcePackMb: number
  hardware: {
    totalRamMb: number
    freeRamMb: number
    cpuModel: string
    cpuCores: number
    gpuName: string
    gpuVramMb: number
  }
  problems: string[]
  advice: string[]
}

const GB = (mb: number): string => (mb >= 1024 ? (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1) : String(Math.round(mb))) + (mb >= 1024 ? ' GB' : ' MB')

/** 启动前的资源预估弹窗：把「预计需要」和「你的配置」摆在一起，让用户决定是否继续 */
export function PreLaunchDialog({
  projectId,
  projectName,
  onContinue,
  onCancel,
  onOpenSettings
}: {
  projectId: string
  projectName: string
  onContinue: () => void
  onCancel: () => void
  onOpenSettings: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [est, setEst] = useState<Estimate | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.mc.estimate(projectId).then((r) => {
      if (r.ok && r.estimate) setEst(r.estimate as Estimate)
      else setError(r.message || '无法获取配置信息')
    })
  }, [projectId])

  const risky = !!est && est.problems.length > 0
  const codeOf = (i: number): string => {
    const text = est?.advice[i] ?? ''
    if (text.includes('预留内存') || text.includes('内存')) return 'P1001'
    if (text.includes('显存')) return 'P1002'
    if (text.includes('CPU') || text.includes('处理器')) return 'P1003'
    return ''
  }

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 620 }}>
        <h2>启动前检查</h2>
        <p className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>
          项目「{projectName}」· 这是根据模组数量与你的硬件做的估算，仅供参考
        </p>

        {error && <div style={{ color: 'var(--err)', fontSize: 12.5 }}>{error}</div>}

        {!est && !error && <div className="dim" style={{ fontSize: 12.5 }}>正在检测硬件…</div>}

        {est && (
          <>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="card tight">
                <div className="card-title">预计需要</div>
                <div className="dim" style={{ fontSize: 12.5, lineHeight: 2 }}>
                  <div>内存：<b style={{ color: 'var(--txt)' }}>{GB(est.ramMb)}</b></div>
                  <div>显存：<b style={{ color: 'var(--txt)' }}>{GB(est.vramMb)}</b></div>
                  <div>CPU 负载：<b style={{ color: 'var(--txt)' }}>{est.cpuLoadText}</b></div>
                  <div>模组 {est.mods} 个 · 光影 {est.shaderPacks} 个</div>
                </div>
              </div>
              <div className="card tight">
                <div className="card-title">你的配置</div>
                <div className="dim" style={{ fontSize: 12.5, lineHeight: 2 }}>
                  <div>内存：{GB(est.hardware.totalRamMb)}（可用 {GB(est.hardware.freeRamMb)}）</div>
                  <div>显存：{est.hardware.gpuVramMb ? GB(est.hardware.gpuVramMb) : '未知'}</div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    显卡：{est.hardware.gpuName}
                  </div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    CPU：{est.hardware.cpuModel}
                  </div>
                </div>
              </div>
            </div>

            <div
              className="card tight"
              style={{ marginTop: 12, borderColor: risky ? 'rgba(201,170,106,.5)' : 'rgba(127,182,155,.45)' }}
            >
              <div className="card-title">{risky ? '请注意' : '结论'}</div>
              <ul className="dim" style={{ fontSize: 12.5, lineHeight: 1.95, paddingLeft: 18 }}>
                {est.advice.map((a, i) => (
                  <li key={i}>
                    {codeOf(i) && (
                      <span className="tag" style={{ marginRight: 6, fontSize: 10.5 }}>
                        {codeOf(i)}
                      </span>
                    )}
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button className="btn" onClick={onOpenSettings} disabled={!est}>
            去版本设置
          </button>
          <button className="btn primary" onClick={onContinue} disabled={!est}>
            {risky ? '仍然继续启动' : '继续启动'}
          </button>
        </div>
      </div>
    </div>
  )
}
