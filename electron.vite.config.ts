import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'

// The one version string: package.json's, stamped into the renderer at build
// time so the footer can never drift from what `npm version` set.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  main: {
    build: {
      lib: { entry: 'electron/main/index.ts' }
    }
  },
  preload: {
    build: {
      // Sandboxed preloads must be CommonJS; keep the .cjs name explicit so
      // the main process can resolve it under "type": "module".
      lib: { entry: 'electron/preload/index.ts', formats: ['cjs'] },
      rollupOptions: {
        output: { entryFileNames: 'index.cjs' }
      }
    }
  },
  renderer: {
    root: '.',
    define: {
      __KONDO_VERSION__: JSON.stringify(version)
    },
    build: {
      rollupOptions: {
        input: 'index.html'
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
