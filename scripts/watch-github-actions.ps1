# scripts/watch-github-actions.ps1
# 轮询 GitHub Actions REST API，等待指定提交对应的所有工作流完成。

[CmdletBinding()]
param(
  [string]$Repository = "ttf248/local-gallery",
  [Parameter(Mandatory = $true)]
  [string]$CommitSha,
  [string]$Token = "",
  [ValidateRange(1, 60)]
  [int]$IntervalSeconds = 15,
  [ValidateRange(30, 3600)]
  [int]$TimeoutSeconds = 900
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Repository -notmatch '^[^/\s]+/[^/\s]+$') {
  throw "Repository 必须是 owner/name 格式。"
}
if ($CommitSha -notmatch '^[0-9a-fA-F]{7,40}$') {
  throw "CommitSha 不是有效的 Git 提交 SHA。"
}

if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = $env:GH_TOKEN
}
if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = $env:GITHUB_TOKEN
}

$headers = @{
  Accept = "application/vnd.github+json"
  "User-Agent" = "local-gallery-actions-watcher"
}
if (-not [string]::IsNullOrWhiteSpace($Token)) {
  $headers.Authorization = "Bearer $Token"
}

$endpoint = "https://api.github.com/repos/$Repository/actions/runs?per_page=100"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$lastSummary = ""

while ($true) {
  try {
    $response = Invoke-RestMethod -Method Get -Uri $endpoint -Headers $headers -TimeoutSec 20
  } catch {
    Write-Warning "读取 GitHub Actions 状态失败：$($_.Exception.Message)"
    if ((Get-Date) -ge $deadline) {
      throw "监控超时，无法读取 GitHub Actions 状态。"
    }
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  # 支持 git rev-parse --short 生成的 SHA；完整 SHA 仍然按同样的前缀匹配。
  $runs = @($response.workflow_runs | Where-Object { $_.head_sha -like "$CommitSha*" })
  if ($runs.Count -eq 0) {
    $summary = "尚未发现提交 $CommitSha 对应的工作流，继续等待..."
  } else {
    $pending = @($runs | Where-Object { $_.status -ne "completed" })
    $failed = @($runs | Where-Object {
        $_.status -eq "completed" -and
        $_.conclusion -in @("failure", "cancelled", "timed_out", "action_required", "stale")
      })
    $states = ($runs | Sort-Object name, id | ForEach-Object {
        "$($_.name)#$($_.id):$($_.status)/$($_.conclusion)"
      }) -join ", "
    $summary = "已发现 $($runs.Count) 个工作流：$states"

    if ($failed.Count -gt 0) {
      $failedLinks = ($failed | ForEach-Object { "$($_.name)#$($_.id) $($_.html_url)" }) -join "; "
      Write-Error "GitHub Actions 执行失败：$failedLinks"
      exit 1
    }
    if ($pending.Count -eq 0) {
      Write-Host "GitHub Actions 全部成功：$summary" -ForegroundColor Green
      exit 0
    }
  }

  if ($summary -ne $lastSummary) {
    Write-Host $summary -ForegroundColor DarkGray
    $lastSummary = $summary
  }
  if ((Get-Date) -ge $deadline) {
    throw "监控超时（$TimeoutSeconds 秒）：$summary"
  }
  Start-Sleep -Seconds $IntervalSeconds
}
