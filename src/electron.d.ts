import type { KondoApi } from '../shared/contract'

declare global {
  interface Window {
    /** Absent when the renderer runs outside Electron (plain vite). */
    kondo?: KondoApi
  }
}

export {}
