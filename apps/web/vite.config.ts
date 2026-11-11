import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API = 'http://127.0.0.1:4747'
const DEV_PORT = 5173
const DEV_ORIGINS = new Set([`http://127.0.0.1:${DEV_PORT}`, `http://localhost:${DEV_PORT}`])

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
    proxy: {
      // `ostraka serve` must be running. Its Host/Origin lockdown only knows its own origin, so the dev
      // server's origin is rewritten to it; any other Origin passes through and is rejected by the server.
      '/api': {
        target: API,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const origin = proxyReq.getHeader('origin')
            if (typeof origin === 'string' && DEV_ORIGINS.has(origin)) proxyReq.setHeader('origin', API)
          })
        },
      },
    },
  },
})
