# scripts/dev.ps1
# 一键启动开发环境（后端 + 前端）
#
# 后端读取 backend/config.yaml（不存在则用内置默认值）。
# 缓存目录默认创建在 backend/.local-gallery/。

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Local Gallery - Dev Launcher" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

if (-not (Test-Path "backend/config.yaml")) {
  Write-Host "未找到 backend/config.yaml，使用内置默认值启动。" -ForegroundColor Yellow
  Write-Host "（提示：复制 backend/config.example.yaml 为 backend/config.yaml 并设置 mediaRoots）" -ForegroundColor Yellow
}

# 并行启动后端和前端
$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; go run ./cmd/server" -PassThru
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev" -PassThru

Write-Host "Backend PID:  $($backend.Id)" -ForegroundColor Green
Write-Host "Frontend PID: $($frontend.Id)" -ForegroundColor Green
Write-Host "按 Ctrl+C 终止..."

try {
  while ($true) { Start-Sleep -Seconds 1 }
} finally {
  Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue
}