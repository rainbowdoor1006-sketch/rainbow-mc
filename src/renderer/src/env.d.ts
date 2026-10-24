import type { Api } from '../../preload/index'

declare global {
  interface Window {
    api: Api
  }
  const __BUILD_TIME__: string
}

export {}
