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
    // 'hidden' 而非 true:源码映射生成但不上传到生产 bundle(stack trace 仍
    // 可读,但 .map 文件不带 sourceMappingURL),节省体积且不暴露源码结构。
    sourcemap: 'hidden',
    target: 'es2022',
    // 拆 vendor 把 react / query / virtuoso 单独 chunk,提升缓存命中 —
    // 业务代码改动时 vendor 不动,用户浏览器只需重新下载业务 chunk。
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          virtuoso: ['react-virtuoso'],
        },
      },
    },
  },
})
