# scripts/build.ps1
# 一键构建：前端 + 后端单二进制
# 占位脚本，将在 T15 阶段完善

$ErrorActionPreference = "Stop"

Write-Host "[1/3] 构建前端..." -ForegroundColor Cyan
Push-Location frontend
npm ci
npm run build
Pop-Location

Write-Host "[2/3] 构建后端..." -ForegroundColor Cyan
Push-Location backend
go build -ldflags="-s -w" -o ../bin/server ./cmd/server
Pop-Location

Write-Host "[3/3] 完成！" -ForegroundColor Green
Write-Host "产物：bin/server （Linux/Mac 需在对应平台编译）" -ForegroundColor Green
