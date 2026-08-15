# scripts/test-e2e.ps1
# 端到端测试
# 占位脚本，将在 T15 阶段完善
#
# 准备临时测试漫画目录，写入临时 backend/config.yaml 指向该目录；
# 不再依赖 COMIC_ROOT 等环境变量。

$ErrorActionPreference = "Stop"

Write-Host "[1/3] 准备测试漫画与临时 config.yaml..." -ForegroundColor Cyan
$testRoot = Join-Path $env:TEMP "comic-reader-e2e-$([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Path $testRoot | Out-Null

$sampleDir = Join-Path $testRoot "sample-album"
New-Item -ItemType Directory -Path $sampleDir | Out-Null

# 占位图片（PNG 1x1 透明）
$pngBytes = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
1..3 | ForEach-Object {
  $imgPath = Join-Path $sampleDir "page-$_.png"
  [System.IO.File]::WriteAllBytes($imgPath, $pngBytes)
}

# 临时配置写入仓库根的 backend/test-config.yaml，端口避开 8080
$testCfg = @"
comicRoot: "$testRoot"
port: 18080
staticDir: ""
"@
$cfgPath = Join-Path (Resolve-Path "backend").Path "test-config.yaml"
Set-Content -Path $cfgPath -Value $testCfg -Encoding UTF8

$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; go run ./cmd/server --config test-config.yaml" -PassThru
Start-Sleep -Seconds 3

try {
  Write-Host "[2/3] 运行 Playwright e2e..." -ForegroundColor Cyan
  Push-Location frontend
  npx playwright install --with-deps chromium | Out-Null
  npx playwright test
  Pop-Location
} finally {
  Write-Host "[3/3] 清理..." -ForegroundColor Cyan
  Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $testRoot -ErrorAction SilentlyContinue
  Remove-Item -Force $cfgPath -ErrorAction SilentlyContinue
}