# Clean v8 harness: one paid MiniMax-M3 batch in a monitored foreground lifecycle.
#
# This script is publish-safe: repository paths are derived from PSScriptRoot,
# no local secret file is sourced, and the API key is read only from the
# calling process environment. It intentionally has no retry/resume/replay path.
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$artifactRoot = $PSScriptRoot
$metricsDir = Join-Path $artifactRoot "metrics"
$targetSha = "300e98e787f4b4faa019edec3380a8ff5d505fc4"
$proxyPort = 8900
$proxyLabel = "livewiki-clean-v8"
$proxyProc = $null
$batchProc = $null
$earlyJob = $null
$cloneRoot = $null
$proxyDiedMidBatch = $false
$batchAttempted = $false
$batchExit = $null
$batchExitCodeFromJson = $null
$durationSec = $null
$verifyExit = $null
$terminalError = $null

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date).ToString("o"), $Message
  Write-Output $line
  Add-Content -Path (Join-Path $metricsDir "orchestrator.log") -Value $line -Encoding utf8
}

function Test-PortOpen([int]$Port, [int]$TimeoutMs = 500) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $pending = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $connected = $pending.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
    if (-not $connected) { $client.Close(); return $false }
    $client.EndConnect($pending)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Wait-Port([int]$Port, [int]$MaxSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($MaxSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen $Port 400) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Sanitize-PublishArtifacts {
  if ($cloneRoot) {
    $localPathFile = Join-Path $metricsDir "clone-path.local.txt"
    if (Test-Path $localPathFile) { Remove-Item -LiteralPath $localPathFile -Force }
  }

  $replacements = @()
  if ($cloneRoot) { $replacements += @{ From = $cloneRoot; To = "<temporary-working-tree>" } }
  $replacements += @{ From = $repoRoot; To = "<repository-root>" }
  if ($env:TEMP) { $replacements += @{ From = $env:TEMP; To = "<temporary-directory>" } }
  if ($env:USERPROFILE) { $replacements += @{ From = $env:USERPROFILE; To = "<user-home>" } }

  $extensions = @(".json", ".jsonl", ".txt", ".md", ".mmd", ".ps1", ".log")
  Get-ChildItem -LiteralPath $artifactRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object {
      $content = [System.IO.File]::ReadAllText($_.FullName)
      $sanitized = $content
      foreach ($replacement in $replacements) {
        $sanitized = $sanitized.Replace($replacement.From, $replacement.To)
        $sanitized = $sanitized.Replace($replacement.From.Replace("\", "/"), $replacement.To)
        $sanitized = $sanitized.Replace($replacement.From.Replace("\", "\\"), $replacement.To)
      }
      # Redact credential headers defensively without recording the value.
      $sanitized = [regex]::Replace(
        $sanitized,
        '(?i)(authorization\s*[:=]\s*["'']?bearer\s+)[^"''\s,}]+',
        '$1<redacted>'
      )
      if ($sanitized -ne $content) {
        [System.IO.File]::WriteAllText($_.FullName, $sanitized)
      }
    }
}

function Write-Notes {
  $status = "FAIL"
  $finalGate = $null
  $qualitativeGate = $null
  $calls = 0
  $promptTokens = 0
  $completionTokens = 0
  $reasoningTokens = 0
  $tasksDone = 0
  $tasksFailed = 0
  $verifyIssues = $null
  $runStatus = "not_started"
  $paidAttempts = if ($batchAttempted) { 1 } else { 0 }

  $finalGatePath = Join-Path $metricsDir "final-gate.json"
  if (Test-Path $finalGatePath) {
    $final = Get-Content $finalGatePath -Raw | ConvertFrom-Json
    $finalGate = $final.overallGate
    $qualitativeGate = $final.qualitativeGate
    $calls = $final.proxy.calls
    $promptTokens = $final.proxy.promptTokens
    $completionTokens = $final.proxy.completionTokens
    $reasoningTokens = $final.proxy.reasoningTokens
    $tasksDone = $final.batch.tasksDone
    $tasksFailed = $final.batch.tasksFailed
    $runStatus = $final.batch.status
    if ($finalGate -eq "PASS") { $status = "PASS" }
  }
  $verifyPath = Join-Path $metricsDir "verify.json"
  if (Test-Path $verifyPath) {
    try { $verifyIssues = @((Get-Content $verifyPath -Raw | ConvertFrom-Json).issues).Count } catch {}
  }
  $failure = if ($terminalError) { $terminalError } else { "none" }
  $notes = @"
# Clean v8 — $status

## Identity

- Base commit: $targetSha
- Command: livewiki init --batch --no-refine --json
- Model: MiniMax-M3 through the monitored local proxy to api.minimax.io
- Thinking: disabled
- Product timeout: default (omitted from config)
- Paid batch attempts: **$paidAttempts**
- No preflight chat completion, `--only`, resume, replay, or retry was used.

## Harness

- Proxy and batch shared one foreground orchestration lifecycle.
- Proxy port readiness and PID liveness were checked before the batch.
- Proxy died mid-batch: `$proxyDiedMidBatch`
- Controlled proxy shutdown was attempted in `finally`.
- MINIMAX_API_KEY was read only from the caller environment and was never printed or stored.

## Early gate

- Stage 2 was disabled by `--no-refine`.
- The first paid wire request, if any, belonged to stage 4; no paid preflight was issued.

## Terminal metrics

- Product status: `$runStatus`
- Final gate: `$finalGate`
- Qualitative gate: `$qualitativeGate`
- Stage-4 tasks: `$tasksDone` done / `$tasksFailed` failed
- Batch process exit: `$batchExit`
- Structured batch exit: `$batchExitCodeFromJson`
- Wall clock: `$durationSec` seconds
- Proxy: `$calls` calls; `$promptTokens` prompt / `$completionTokens` completion / `$reasoningTokens` reasoning tokens
- Verify exit: `$verifyExit`; issues: `$verifyIssues`
- Harness error: `$failure`

## Dynamic acceptance

`metrics/acceptance-analysis.json` contains the versioned mechanical analysis.
`metrics/final-gate.json` additionally requires stage 2 and reasoning zero,
exact batch/proxy accounting, proxy liveness, and the qualitative gate.

## Qualitative audit

`metrics/qualitative-audit.json` checks the clean v7 regressions without
editing output: independent frontmatter/section coverage, non-empty sections,
closed Markdown, no visible neutralization sentinel, no TODO/TBD prose, no
missing `.mmd` target, no benchmark helper under Important symbols, no
duplicate deterministic Mermaid declaration, and no commands page claim that
contradicts the uniform `process.exitCode` implementation.

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.

This was the only paid clean v8 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.
"@
  [System.IO.File]::WriteAllText((Join-Path $artifactRoot "notes.md"), $notes)
}

New-Item -ItemType Directory -Force -Path $metricsDir | Out-Null
Write-Log "=== clean v8 orchestrator start ==="

try {
  if (-not $env:MINIMAX_API_KEY) {
    throw "MINIMAX_API_KEY missing from the calling environment"
  }
  if (Test-PortOpen $proxyPort 400) {
    throw "proxy port $proxyPort is already in use; refusing to stop an unrelated listener"
  }

  $head = (git -C $repoRoot rev-parse HEAD).Trim()
  if ($head -ne $targetSha) { throw "repository HEAD mismatch: expected $targetSha, got $head" }

  $env:OPENAI_API_KEY = $env:MINIMAX_API_KEY
  $cloneRoot = Join-Path $env:TEMP ("livewiki-clean-v8-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  Write-Log "creating detached worktree at target commit"
  git -C $repoRoot worktree add --detach $cloneRoot $targetSha
  if ($LASTEXITCODE -ne 0) { throw "git worktree add failed" }
  [System.IO.File]::WriteAllText((Join-Path $metricsDir "clone-path.local.txt"), $cloneRoot)

  $commit = (git -C $cloneRoot rev-parse HEAD).Trim()
  if ($commit -ne $targetSha) { throw "worktree commit mismatch: $commit" }
  $message = (git -C $cloneRoot log -1 --pretty=%s).Trim()
  Write-Log "commit confirmed $commit - $message"

  foreach ($relative in @("livewiki", ".livewiki")) {
    $candidate = Join-Path $cloneRoot $relative
    if (Test-Path $candidate) {
      Remove-Item -LiteralPath $candidate -Recurse -Force
      Write-Log "stripped versioned/generated $relative"
    }
  }

  Write-Log "installing exact lockfile dependencies in worktree"
  Push-Location $cloneRoot
  try {
    pnpm install --frozen-lockfile --prefer-offline 2>&1 |
      Out-File (Join-Path $metricsDir "pnpm-install.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    pnpm --filter @livewiki/core build
    if ($LASTEXITCODE -ne 0) { throw "core build failed" }
    pnpm --filter @livewiki/cli build
    if ($LASTEXITCODE -ne 0) { throw "cli build failed" }
  } finally {
    Pop-Location
  }

  $cli = Join-Path $cloneRoot "packages\cli\dist\index.js"
  if (-not (Test-Path $cli)) { throw "built CLI missing" }

  New-Item -ItemType Directory -Force -Path (Join-Path $cloneRoot ".livewiki") | Out-Null
  $config = [ordered]@{
    provider = "openai-compat"
    language = "en"
    model = "MiniMax-M3"
    baseUrl = "http://127.0.0.1:$proxyPort/v1"
    thinking = "disabled"
    stage4MaxOutputTokens = 8192
    maxRepairAttempts = 2
    maxModuleFiles = 12
    maxModuleSymbols = 80
  } | ConvertTo-Json
  [System.IO.File]::WriteAllText((Join-Path $cloneRoot ".livewiki\config.json"), $config)
  [System.IO.File]::WriteAllText((Join-Path $metricsDir "livewiki-config.json"), $config)

  $metadata = @(
    "commitUnderTest=$commit"
    "message=$message"
    "clonePath=<temporary-working-tree>"
    "artifactRoot=docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8"
    "command=livewiki init --batch --no-refine --json"
    "timeoutPolicy=product_default_300000_omitted_from_config"
    "model=MiniMax-M3"
    "thinking=disabled"
    "proxy=http://127.0.0.1:$proxyPort/v1 -> https://api.minimax.io"
    "proxyLabel=$proxyLabel"
    "harness=single_foreground_orchestration_proxy_plus_batch"
  )
  [System.IO.File]::WriteAllText((Join-Path $metricsDir "run-meta.txt"), ($metadata -join "`n"))

  $env:LIVEWIKI_PROXY_OUT_DIR = $metricsDir
  $env:LIVEWIKI_PROXY_PORT = "$proxyPort"
  $env:LIVEWIKI_PROXY_UPSTREAM = "https://api.minimax.io"
  $proxyScript = Join-Path $repoRoot "docs\benchmarks\2026-07-10-minimax-m3\tools\token-proxy.mjs"
  Write-Log "starting monitored proxy"
  $proxyProc = Start-Process -FilePath "node" `
    -ArgumentList @($proxyScript, $proxyLabel) `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $metricsDir "proxy-stdout.log") `
    -RedirectStandardError (Join-Path $metricsDir "proxy-stderr.log") `
    -WorkingDirectory $repoRoot
  if (-not $proxyProc) { throw "failed to start proxy process" }
  [System.IO.File]::WriteAllText((Join-Path $metricsDir "proxy-pid.txt"), "$($proxyProc.Id)")
  Write-Log "proxy_pid=$($proxyProc.Id)"

  if (-not (Wait-Port $proxyPort 45)) { throw "proxy port did not accept connections" }
  $proxyProc.Refresh()
  if ($proxyProc.HasExited) { throw "proxy exited before batch" }
  if (-not (Get-Process -Id $proxyProc.Id -ErrorAction SilentlyContinue)) {
    throw "proxy PID is not alive before batch"
  }
  Write-Log "proxy ready and alive; no preflight chat completion issued"

  $earlyJob = Start-Job -ScriptBlock {
    param($cloneRoot, $cli, $metricsDir)
    $deadline = (Get-Date).AddMinutes(12)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 6
      try {
        $out = & node $cli batch status --json --repo $cloneRoot 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) {
          [System.IO.File]::WriteAllText(
            (Join-Path $metricsDir "batch-status-early.json"),
            ($out | Out-String)
          )
          $json = $out | ConvertFrom-Json
          $stage4 = $json.byStage."4"
          if (-not $stage4) { $stage4 = $json.run.summary.byStage."4" }
          if (($stage4 -and [int]$stage4.inputTokens -gt 0) -or $json.tasks) { return "captured" }
        }
      } catch {}
    }
    return "timeout"
  } -ArgumentList $cloneRoot, $cli, $metricsDir

  $batchStdout = Join-Path $metricsDir "livewiki-batch-stdout.log"
  $batchStderr = Join-Path $metricsDir "livewiki-batch-stderr.log"
  $batchStarted = Get-Date
  Add-Content (Join-Path $metricsDir "run-meta.txt") "`nbatch_started=$($batchStarted.ToString('o'))"
  Write-Log "BATCH_START"
  $batchAttempted = $true
  $batchProc = Start-Process -FilePath "node" `
    -ArgumentList @($cli, "init", "--batch", "--no-refine", "--json", "--repo", $cloneRoot) `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $batchStdout `
    -RedirectStandardError $batchStderr `
    -WorkingDirectory $cloneRoot

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  while (-not $batchProc.HasExited) {
    if ($stopwatch.ElapsedMilliseconds -gt (90 * 60 * 1000)) {
      Stop-Process -Id $batchProc.Id -Force -ErrorAction SilentlyContinue
      throw "batch exceeded the 90-minute harness wall timeout"
    }
    try { $proxyProc.Refresh() } catch {}
    if ($proxyProc.HasExited -and -not $proxyDiedMidBatch) {
      $proxyDiedMidBatch = $true
      Write-Log "PROXY_DIED_MID_BATCH exit=$($proxyProc.ExitCode)"
    }
    Start-Sleep -Seconds 2
    try { $batchProc.Refresh() } catch {}
  }

  $batchEnded = Get-Date
  $batchExit = $batchProc.ExitCode
  $durationSec = [math]::Round(($batchEnded - $batchStarted).TotalSeconds, 1)
  Write-Log "BATCH_END process_exit=$batchExit durationSec=$durationSec proxy_alive=$(-not $proxyProc.HasExited) proxyDiedMid=$proxyDiedMidBatch"

  if ($earlyJob) {
    try {
      $earlyResult = Wait-Job $earlyJob -Timeout 5 | Receive-Job
      Write-Log "early_job=$earlyResult"
    } catch { Write-Log "early_job_error=$_" }
    Remove-Job $earlyJob -Force -ErrorAction SilentlyContinue
    $earlyJob = $null
  }

  $stdout = if (Test-Path $batchStdout) { Get-Content $batchStdout -Raw } else { "" }
  $stderr = if (Test-Path $batchStderr) { Get-Content $batchStderr -Raw } else { "" }
  [System.IO.File]::WriteAllText(
    (Join-Path $metricsDir "livewiki-batch-run.log"),
    "=== stdout ===`n$stdout`n=== stderr ===`n$stderr"
  )

  $statusText = & node $cli batch status --json --repo $cloneRoot 2>&1 | Out-String
  [System.IO.File]::WriteAllText((Join-Path $metricsDir "batch-status.json"), $statusText)
  $verifyText = & node $cli verify --json --repo $cloneRoot 2>&1 | Out-String
  $verifyExit = $LASTEXITCODE
  [System.IO.File]::WriteAllText((Join-Path $metricsDir "verify.json"), $verifyText)

  $wikiDestination = Join-Path $artifactRoot "livewiki"
  if (Test-Path $wikiDestination) { Remove-Item -LiteralPath $wikiDestination -Recurse -Force }
  if (Test-Path (Join-Path $cloneRoot "livewiki")) {
    Copy-Item -LiteralPath (Join-Path $cloneRoot "livewiki") -Destination $wikiDestination -Recurse
    Write-Log "generated wiki copied without modification"
  }

  try { $batchExitCodeFromJson = ($stdout | ConvertFrom-Json).batchExitCode } catch {}

  if (-not $proxyProc.HasExited) {
    Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
    try { $proxyProc.WaitForExit(10000) | Out-Null } catch {}
  }
  Write-Log "proxy stopped after evidence collection"

  $acceptance = Join-Path $repoRoot "docs\benchmarks\2026-07-10-minimax-m3\tools\acceptance-analysis.mjs"
  node $acceptance $artifactRoot "token-proxy-livewiki-clean-v8.json"
  if ($LASTEXITCODE -ne 0) { throw "versioned acceptance analysis failed" }
  node (Join-Path $artifactRoot "_qualitative-audit.mjs") $artifactRoot
  if ($LASTEXITCODE -ne 0) { throw "qualitative audit failed" }
  node (Join-Path $artifactRoot "_combine-gates.mjs") $artifactRoot "$proxyDiedMidBatch"
  if ($LASTEXITCODE -ne 0) { throw "gate combination failed" }

  Add-Content (Join-Path $metricsDir "run-meta.txt") @"

batch_ended=$($batchEnded.ToString('o'))
process_exitCode=$batchExit
batchExitCode=$batchExitCodeFromJson
batch_durationSec=$durationSec
verify_exitCode=$verifyExit
proxy_died_mid_batch=$proxyDiedMidBatch
"@
} catch {
  $terminalError = $_.Exception.Message
  Write-Log "TERMINAL_FAIL $terminalError"
} finally {
  if ($earlyJob) {
    Remove-Job $earlyJob -Force -ErrorAction SilentlyContinue
  }
  if ($batchProc -and -not $batchProc.HasExited) {
    Stop-Process -Id $batchProc.Id -Force -ErrorAction SilentlyContinue
  }
  if ($proxyProc -and -not $proxyProc.HasExited) {
    Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
    try { $proxyProc.WaitForExit(10000) | Out-Null } catch {}
  }
  Write-Notes
  Sanitize-PublishArtifacts
  Write-Log "=== clean v8 orchestrator end ==="
}

if ($terminalError) { exit 1 }
$finalGatePath = Join-Path $metricsDir "final-gate.json"
if (-not (Test-Path $finalGatePath)) { exit 1 }
$gate = (Get-Content $finalGatePath -Raw | ConvertFrom-Json).overallGate
if ($gate -ne "PASS") { exit 1 }
exit 0
