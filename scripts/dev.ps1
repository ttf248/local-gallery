# scripts/dev.ps1
# 一键启动开发环境（后端 + 前端）
# 占位脚本，将在 T15 阶段完善

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Comic Reader - Dev Launcher" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

if (-not $env:COMIC_ROOT) {
  $env:COMIC_ROOT = "E:\漫画"
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
