import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'

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
    build: {
      rollupOptions: {
        input: 'index.html'
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
