import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['node-carplay'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    publicDir: 'src/renderer/public',
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        stream: 'stream-browserify',
        Buffer: 'buffer',
      }
    },
    optimizeDeps: {
      exclude: ['audio.worklet.js'],
      esbuildOptions: {
        define: { global: 'globalThis' },
        plugins: [
          NodeGlobalsPolyfillPlugin({ process: true, buffer: true })
        ]
      }
    },
    plugins: [react()],
    server: {
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-site',
      }
    },
    worker: {
      format: 'es',
      rollupOptions: {
        output: {
          assetFileNames: 'assets/[name].[hash][extname]',
        }
      }
    }
  }
})
