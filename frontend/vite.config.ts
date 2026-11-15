import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

const appVersion = process.env.LOCAL_GALLERY_VERSION ?? pkg.version;
const backendOrigin = "http://127.0.0.1:8080";
const developmentOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

// https://vitejs.dev/config/
export default defineConfig({
  // 开发构建使用 package.json；发布工作流用环境变量注入标签版本。
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      // 开发时把 /api/* 代理到后端，避免 CORS。
      "/api": {
        target: backendOrigin,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            // AccessGate 严格校验 Origin 与线上的 Host。开发代理必须同步改写
            // 浏览器携带的 Vite Origin，否则写请求会被识别成跨源请求。
            if (
              typeof req.headers.origin === "string" &&
              developmentOrigins.has(req.headers.origin)
            ) {
              proxyReq.setHeader("Origin", backendOrigin);
            }
            if (req.url?.includes("/events")) {
              proxyReq.setHeader("Cache-Control", "no-cache");
              proxyReq.setHeader("X-Accel-Buffering", "no");
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    // 发布构建默认不产出源码映射。
    //
    // 'hidden' 只是不给 .map 挂 sourceMappingURL，映射文件本身照样写进
    // dist/assets —— 那是一份完整的 TS/TSX 源码，发行包把它整份带出去，
    // 任何人都能 GET /assets/index-<hash>.js.map 读回源码。构建产物首屏
    // 才 828 KB，映射却有 3.1 MB。
    //
    // 本地排查堆栈时用 LOCAL_GALLERY_SOURCEMAP=hidden npm run build，
    // 映射会生成在 dist 里但不随发行包分发。
    sourcemap: process.env.LOCAL_GALLERY_SOURCEMAP === "hidden" ? "hidden" : false,
    target: "es2022",
    // 拆 vendor 把 react / query / virtuoso 单独 chunk,提升缓存命中 —
    // 业务代码改动时 vendor 不动,用户浏览器只需重新下载业务 chunk。
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          virtuoso: ["react-virtuoso"],
        },
      },
    },
  },
});
