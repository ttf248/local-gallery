import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import pkg from './package.json'

const appVersion = process.env.LOCAL_GALLERY_VERSION ?? pkg.version

// https://vitejs.dev/config/
export default defineConfig({
  // 开发构建使用 package.json；发布工作流用环境变量注入标签版本。
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      // 开发时把 /api/* 代理到后端，避免 CORS。
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            if (req.url?.includes('/events')) {
              _proxyReq.setHeader('Cache-Control', 'no-cache')
              _proxyReq.setHeader('X-Accel-Buffering', 'no')
            }
          })
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
})
