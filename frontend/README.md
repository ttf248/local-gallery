# Frontend · React + Vite + TypeScript

> 本地画廊（Local Gallery）前端 SPA。

主文档见仓库根 [README.md](../README.md) / [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)。本文件只写前端本地开发相关的速查。

## 启动

```bash
npm install
npm run dev
```

默认开发服务器：<http://localhost:5173>

通过 Vite proxy 转发 `/api` 到后端 `http://127.0.0.1:8080`；代理会同步改写 Host 与 Origin，以满足后端的同源访问门禁。

## 构建

```bash
npm run build      # 输出到 dist/
npm run preview    # 本地预览生产构建
```

## 测试

```bash
npm run test         # 单元测试
npx playwright test  # e2e 测试
```

## 环境变量

复制 `.env.example` 为 `.env` 修改。

| 变量            | 用途                                        |
| --------------- | ------------------------------------------- |
| `VITE_API_BASE` | API 基础路径（默认空，同源或经 Vite proxy） |
