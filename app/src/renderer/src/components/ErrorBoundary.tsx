import React from 'react'

/**
 * 全局错误边界：任何一个页面组件抛异常时，不要整屏白掉，
 * 而是显示可读的错误信息和「重试 / 返回」按钮。
 *
 * 加这个是因为之前出现过：点组件详情里的某个版本，因为 project 为空时
 * 访问了 undefined.toUpperCase()，整个渲染树崩掉，界面全黑什么都没有。
 */
interface State {
  error: Error | null
  info: string
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey?: string; onReset?: () => void },
  State
> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 控制台留一份，方便排查
    console.error('[RAINBOW MC] 界面异常：', error, info.componentStack)
    this.setState({ info: info.componentStack || '' })
  }

  componentDidUpdate(prev: { resetKey?: string }): void {
    // 切换页面后自动恢复
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, info: '' })
    }
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty" style={{ border: '1px dashed rgba(201,106,106,.5)', padding: 28 }}>
        <div style={{ fontSize: 15, color: '#d98b8b', marginBottom: 8 }}>这个页面出错了</div>
        <div className="dim" style={{ fontSize: 12, lineHeight: 1.8, maxWidth: 720, wordBreak: 'break-all' }}>
          {this.state.error.message || String(this.state.error)}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 16 }}>
          <button
            className="btn primary"
            onClick={() => {
              this.setState({ error: null, info: '' })
              this.props.onReset?.()
            }}
          >
            重试
          </button>
        </div>
        <details style={{ marginTop: 14 }}>
          <summary className="dim" style={{ fontSize: 11.5, cursor: 'pointer' }}>
            查看技术细节
          </summary>
          <pre
            className="dim mono"
            style={{ fontSize: 10.5, whiteSpace: 'pre-wrap', marginTop: 8, maxHeight: 220, overflow: 'auto' }}
          >
            {this.state.error.stack || this.state.info}
          </pre>
        </details>
      </div>
    )
  }
}
