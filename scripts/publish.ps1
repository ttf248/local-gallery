# scripts/publish.ps1
# 校验当前改动 → 创建提交 → 推送当前分支 → 轮询 GitHub Actions 结果。
# 默认不强制推送；远端拒绝时保留本地提交并让调用方处理分支分歧。

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Message,
  [string]$Remote = "origin",
  [string]$Branch = "",
  [string]$Repository = "ttf248/local-gallery",
  [string]$Token = "",
  [switch]$SkipValidation,
  [switch]$SkipMonitor,
  [ValidateRange(1, 60)]
  [int]$MonitorIntervalSeconds = 15,
  [ValidateRange(30, 3600)]
  [int]$MonitorTimeoutSeconds = 900
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Invoke-GitChecked {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  Push-Location $repoRoot
  try {
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Git 命令失败（退出码 $LASTEXITCODE）：git $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Invoke-ValidationCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "校验命令失败（退出码 $LASTEXITCODE）：$FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

$currentBranch = (& git -C $repoRoot branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($currentBranch)) {
  throw "当前处于 detached HEAD，不能自动推送。"
}
if ([string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = $currentBranch
}

if (-not $SkipValidation) {
  Write-Host "[1/5] 构建前端与后端..." -ForegroundColor Cyan
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot "build.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "构建失败，已停止提交和推送。"
  }

  Write-Host "[2/5] 运行后端测试..." -ForegroundColor Cyan
  Invoke-ValidationCommand "go" @("test", "./...") (Join-Path $repoRoot "backend")

  Write-Host "[3/5] 运行前端静态检查与测试..." -ForegroundColor Cyan
  Invoke-ValidationCommand "npm" @("run", "lint") (Join-Path $repoRoot "frontend")
  Invoke-ValidationCommand "npm" @("run", "test") (Join-Path $repoRoot "frontend")
} else {
  Write-Host "[1/5] 已跳过本地构建和测试。" -ForegroundColor Yellow
}

$statusBefore = (& git -C $repoRoot status --porcelain)
if ([string]::IsNullOrWhiteSpace(($statusBefore -join "`n"))) {
  throw "工作区没有可提交的改动。"
}

Write-Host "[4/5] 暂存改动并创建提交..." -ForegroundColor Cyan
Invoke-GitChecked @("add", "--all")
Invoke-GitChecked @("diff", "--cached", "--check")
Invoke-GitChecked @("commit", "--message", $Message)
$commitSha = (& git -C $repoRoot rev-parse HEAD).Trim()

Write-Host "[5/5] 推送 $commitSha 到 $Remote/$Branch..." -ForegroundColor Cyan
Invoke-GitChecked @("push", $Remote, "HEAD:$Branch")
Write-Host "推送完成。" -ForegroundColor Green

if (-not $SkipMonitor) {
  Write-Host "开始等待 GitHub Actions 处理 $commitSha..." -ForegroundColor Cyan
  $watchArgs = @(
    "-NoProfile",
    "-File",
    (Join-Path $PSScriptRoot "watch-github-actions.ps1"),
    "-Repository",
    $Repository,
    "-CommitSha",
    $commitSha,
    "-IntervalSeconds",
    $MonitorIntervalSeconds,
    "-TimeoutSeconds",
    $MonitorTimeoutSeconds
  )
  if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $watchArgs += @("-Token", $Token)
  }
  & pwsh @watchArgs
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub Actions 未成功完成，请打开 https://github.com/$Repository/actions 查看详情。"
  }
}
