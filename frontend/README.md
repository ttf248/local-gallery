# Frontend - React + Vite + TypeScript

漫画阅读器前端 SPA。

## 启动

```bash
npm install
npm run dev
```

默认开发服务器：<http://localhost:5173>

通过 Vite proxy 转发 `/api` 到后端 `http://localhost:8080`。

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

| 变量 | 用途 |
|------|------|
| `VITE_API_BASE` | API 基础路径（默认空，同源或经 Vite proxy） |
