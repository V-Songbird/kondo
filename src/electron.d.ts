/// <reference types="vite/client" />
// vite/client is what declares the asset modules the renderer imports for their
// side effect — './index.css' in main.tsx. TypeScript 7 errors on an unresolved
// side-effect import (TS2882) where 5.x let it through, so this reference is
// load-bearing, not decoration.

import type { KondoApi } from '../shared/contract'

declare global {
  interface Window {
    /** Absent when the renderer runs outside Electron (plain vite). */
    kondo?: KondoApi
    /**
     * Tells the main process the first read has settled so it can retire the
     * splash. Absent outside Electron, and safe to call more than once — the
     * main process listens for it exactly once.
     */
    kondoReady?: () => void
    /** Reload this window through main without accepting a URL (ADR-0014). */
    kondoReload?: () => void
  }
  /** package.json's version, stamped in by electron.vite.config.ts `define`. */
  const __KONDO_VERSION__: string
}

export {}
