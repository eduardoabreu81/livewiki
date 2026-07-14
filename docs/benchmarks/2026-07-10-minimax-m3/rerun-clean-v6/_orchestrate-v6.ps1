# Clean v6 harness - single foreground orchestration (proxy + batch).
# No product code changes. One pipeline attempt. Preserve failure if any.
# Base commit: d09550edaae1c383949b506b981d8ff4a8264e2c
#   fix(benchmark): align clean-run acceptance analysis
$ErrorActionPreference = "Stop"
$repoRoot = "C:\Users\Eduardo\OneDrive\Documentos\GitHub\livewiki"
$artifactRoot = Join-Path $repoRoot "docs\benchmarks\2026-07-10-minimax-m3\rerun-clean-v6"
$metricsDir = Join-Path $artifactRoot "metrics"
$targetSha = "d09550edaae1c383949b506b981d8ff4a8264e2c"
$proxyPort = 8900
$proxyLabel = "livewiki-clean-v6"

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date).ToString("o"), $msg
  Write-Output $line
  Add-Content -Path (Join-Path $metricsDir "orchestrator.log") -Value $line -Encoding utf8
}

function Test-PortOpen([int]$Port, [int]$TimeoutMs = 500) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
    if (-not $ok) { $client.Close(); return $false }
    $client.EndConnect($iar)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Wait-Port([int]$Port, [int]$MaxSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($MaxSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen $Port 400) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

# --- secrets (never log values) ---
. "C:\Users\Eduardo\bench-secrets.ps1"
if (-not $env:MINIMAX_API_KEY) { throw "MINIMAX_API_KEY missing" }
$env:OPENAI_API_KEY = $env:MINIMAX_API_KEY

New-Item -ItemType Directory -Force -Path $metricsDir | Out-Null
Write-Log "=== clean v6 orchestrator start ==="

# Free port
Get-NetTCPConnection -LocalPort $proxyPort -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq "Listen" } |
  ForEach-Object {
    Write-Log "killing listener PID $($_.OwningProcess) on $proxyPort"
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 1

# Disposable worktree
$cloneRoot = Join-Path $env:TEMP ("livewiki-clean-v6-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
Write-Log "creating worktree $cloneRoot @ $targetSha"
git -C $repoRoot worktree add --detach $cloneRoot $targetSha
$commit = (git -C $cloneRoot rev-parse HEAD).Trim()
if ($commit -ne $targetSha) { throw "commit mismatch: $commit" }
$msg = (git -C $cloneRoot log -1 --pretty=%s).Trim()
Write-Log "commit confirmed $commit - $msg"
[System.IO.File]::WriteAllText((Join-Path $metricsDir "clone-path.local.txt"), $cloneRoot)

# Strip versioned wiki / caches
foreach ($rel in @("livewiki", ".livewiki")) {
  $p = Join-Path $cloneRoot $rel
  if (Test-Path $p) {
    Remove-Item -Recurse -Force $p
    Write-Log "stripped $rel"
  }
}

# Build clone
Write-Log "pnpm install in clone"
Push-Location $cloneRoot
try {
  pnpm install --force 2>&1 | Out-File (Join-Path $metricsDir "pnpm-install.log") -Encoding utf8
} catch {
  Write-Log "pnpm install warning: $_"
}
$tsc = Join-Path $cloneRoot "node_modules\typescript\bin\tsc"
if (-not (Test-Path $tsc)) { $tsc = Join-Path $repoRoot "node_modules\typescript\bin\tsc" }
Write-Log "tsc=$tsc"
node $tsc -p packages/core/tsconfig.json
if ($LASTEXITCODE -ne 0) { throw "core tsc failed" }
node $tsc -p packages/cli/tsconfig.json
if ($LASTEXITCODE -ne 0) { throw "cli tsc failed" }
if (Test-Path packages/cli/scripts/make-executable.mjs) {
  node packages/cli/scripts/make-executable.mjs
}
Pop-Location
$cli = Join-Path $cloneRoot "packages\cli\dist\index.js"
if (-not (Test-Path $cli)) { throw "CLI missing: $cli" }
Write-Log "CLI ready $cli"

# Config (no key; product default timeout - timeoutMs omitted)
New-Item -ItemType Directory -Force -Path (Join-Path $cloneRoot ".livewiki") | Out-Null
$configObj = [ordered]@{
  provider              = "openai-compat"
  language              = "en"
  model                 = "MiniMax-M3"
  baseUrl               = "http://127.0.0.1:$proxyPort/v1"
  thinking              = "disabled"
  stage4MaxOutputTokens = 8192
  maxRepairAttempts     = 2
  maxModuleFiles        = 12
  maxModuleSymbols      = 80
}
$configJson = $configObj | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $cloneRoot ".livewiki\config.json"), $configJson)
[System.IO.File]::WriteAllText((Join-Path $metricsDir "livewiki-config.json"), $configJson)

$meta = @(
  "commitUnderTest=$commit"
  "message=$msg"
  "clonePath=<temporary-working-tree>"
  "startedPrep=$((Get-Date).ToString('o'))"
  "artifactRoot=docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v6"
  "command=livewiki init --batch --no-refine --json"
  "timeoutPolicy=product_default_300000_omitted_from_config"
  "model=MiniMax-M3"
  "thinking=disabled"
  "proxy=http://127.0.0.1:$proxyPort/v1 -> https://api.minimax.io"
  "proxyLabel=$proxyLabel"
  "harness=same_foreground_orchestration_proxy_plus_batch_validated_in_v5"
)
[System.IO.File]::WriteAllText((Join-Path $metricsDir "run-meta.txt"), ($meta -join "`n"))

# --- Start proxy (child; this shell stays alive until batch ends) ---
$env:LIVEWIKI_PROXY_OUT_DIR = $metricsDir
$env:LIVEWIKI_PROXY_PORT = "$proxyPort"
$env:LIVEWIKI_PROXY_UPSTREAM = "https://api.minimax.io"
$proxyStdout = Join-Path $metricsDir "proxy-stdout.log"
$proxyStderr = Join-Path $metricsDir "proxy-stderr.log"
$proxyScript = Join-Path $repoRoot "docs\benchmarks\2026-07-10-minimax-m3\tools\token-proxy.mjs"

Write-Log "starting proxy"
$proxyProc = Start-Process -FilePath "node" `
  -ArgumentList @($proxyScript, $proxyLabel) `
  -PassThru `
  -WindowStyle Hidden `
  -RedirectStandardOutput $proxyStdout `
  -RedirectStandardError $proxyStderr `
  -WorkingDirectory $repoRoot

if (-not $proxyProc) { throw "failed to start proxy process" }
Write-Log "proxy_pid=$($proxyProc.Id)"
[System.IO.File]::WriteAllText((Join-Path $metricsDir "proxy-pid.txt"), "$($proxyProc.Id)")

Write-Log "waiting for port $proxyPort"
if (-not (Wait-Port $proxyPort 45)) {
  Write-Log "port not open; proxy HasExited=$($proxyProc.HasExited)"
  throw "proxy port $proxyPort did not accept connections"
}
Write-Log "port $proxyPort accepting connections"

if ($proxyProc.HasExited) {
  throw "proxy exited before batch (code=$($proxyProc.ExitCode))"
}
$alive = Get-Process -Id $proxyProc.Id -ErrorAction SilentlyContinue
if (-not $alive) { throw "proxy PID $($proxyProc.Id) not alive before batch" }
Write-Log "proxy alive pre-batch PID=$($proxyProc.Id)"
Write-Log "no preflight chat completion issued"

# Early status poller job
$earlyJob = Start-Job -ScriptBlock {
  param($cloneRoot, $cli, $metricsDir)
  $deadline = (Get-Date).AddMinutes(12)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 6
    try {
      $out = & node $cli batch status --json --repo $cloneRoot 2>$null
      if ($LASTEXITCODE -eq 0 -and $out) {
        $path = Join-Path $metricsDir "batch-status-early.json"
        [System.IO.File]::WriteAllText($path, ($out | Out-String))
        $j = $out | ConvertFrom-Json
        $s4 = $j.byStage."4"
        if (-not $s4) { $s4 = $j.run.summary.byStage."4" }
        if (($s4 -and [int]$s4.inputTokens -gt 0) -or $j.tasks) {
          return "captured"
        }
      }
    } catch {}
  }
  return "timeout"
} -ArgumentList $cloneRoot, $cli, $metricsDir

# --- Batch (single attempt, no --only / resume / replay / retry) ---
$batchStdout = Join-Path $metricsDir "livewiki-batch-stdout.log"
$batchStderr = Join-Path $metricsDir "livewiki-batch-stderr.log"
$batchStarted = Get-Date
Add-Content (Join-Path $metricsDir "run-meta.txt") "`nbatch_started=$($batchStarted.ToString('o'))"
Write-Log "BATCH_START"

$batchProc = Start-Process -FilePath "node" `
  -ArgumentList @($cli, "init", "--batch", "--no-refine", "--json", "--repo", $cloneRoot) `
  -PassThru `
  -WindowStyle Hidden `
  -RedirectStandardOutput $batchStdout `
  -RedirectStandardError $batchStderr `
  -WorkingDirectory $cloneRoot

$batchTimeoutMs = 90 * 60 * 1000
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proxyDiedMid = $false
while (-not $batchProc.HasExited) {
  if ($sw.ElapsedMilliseconds -gt $batchTimeoutMs) {
    Write-Log "batch wall timeout - killing batch"
    Stop-Process -Id $batchProc.Id -Force -ErrorAction SilentlyContinue
    break
  }
  try { $proxyProc.Refresh() } catch {}
  if ($proxyProc.HasExited -and -not $proxyDiedMid) {
    $proxyDiedMid = $true
    Write-Log "PROXY DIED mid-batch exit=$($proxyProc.ExitCode)"
  }
  Start-Sleep -Seconds 2
  try { $batchProc.Refresh() } catch {}
}

$batchEnded = Get-Date
$batchExit = $batchProc.ExitCode
$durationSec = [math]::Round(($batchEnded - $batchStarted).TotalSeconds, 1)
Write-Log "BATCH_END process_exit=$batchExit durationSec=$durationSec proxy_alive=$(-not $proxyProc.HasExited) proxyDiedMid=$proxyDiedMid"

try {
  $earlyResult = Wait-Job $earlyJob -Timeout 5 | Receive-Job
  Write-Log "early_job=$earlyResult"
} catch {
  Write-Log "early_job_error=$_"
}
Remove-Job $earlyJob -Force -ErrorAction SilentlyContinue

$stdout = if (Test-Path $batchStdout) { Get-Content $batchStdout -Raw } else { "" }
$stderr = if (Test-Path $batchStderr) { Get-Content $batchStderr -Raw } else { "" }
Set-Content (Join-Path $metricsDir "livewiki-batch-run.log") -Value ("=== stdout ===`n$stdout`n=== stderr ===`n$stderr") -Encoding utf8

Write-Log "collecting batch status + verify"
$st = & node $cli batch status --json --repo $cloneRoot 2>&1 | Out-String
[System.IO.File]::WriteAllText((Join-Path $metricsDir "batch-status.json"), $st)
$vf = & node $cli verify --json --repo $cloneRoot 2>&1 | Out-String
$vfExit = $LASTEXITCODE
[System.IO.File]::WriteAllText((Join-Path $metricsDir "verify.json"), $vf)

$dstWiki = Join-Path $artifactRoot "livewiki"
if (Test-Path $dstWiki) { Remove-Item -Recurse -Force $dstWiki }
if (Test-Path (Join-Path $cloneRoot "livewiki")) {
  Copy-Item -Recurse (Join-Path $cloneRoot "livewiki") $dstWiki
  Write-Log "wiki copied"
} else {
  Write-Log "no livewiki/ in clone"
}

Write-Log "stopping proxy PID=$($proxyProc.Id)"
if (-not $proxyProc.HasExited) {
  Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
  try { $proxyProc.WaitForExit(10000) | Out-Null } catch {}
}
Write-Log "proxy stopped"

Write-Log "running versioned acceptance analysis helper"
$acceptScript = Join-Path $repoRoot "docs\benchmarks\2026-07-10-minimax-m3\tools\acceptance-analysis.mjs"
$proxyBasename = "token-proxy-$proxyLabel.json"
node $acceptScript $artifactRoot $proxyBasename

$batchExitCodeFromJson = $null
try {
  $jinit = $stdout | ConvertFrom-Json
  $batchExitCodeFromJson = $jinit.batchExitCode
} catch {}

$analysis = Get-Content (Join-Path $metricsDir "acceptance-analysis.json") -Raw | ConvertFrom-Json
$overall = $analysis.overallGate
Add-Content (Join-Path $metricsDir "run-meta.txt") @"

batch_ended=$($batchEnded.ToString('o'))
process_exitCode=$batchExit
batchExitCode=$batchExitCodeFromJson
batch_durationSec=$durationSec
verify_exitCode=$vfExit
finalStatus=$($analysis.runStatus)
overallGate=$overall
proxy_calls=$($analysis.proxy.calls)
proxy_died_mid_batch=$proxyDiedMid
"@

Write-Log "overallGate=$overall finalStatus=$($analysis.runStatus) proxyCalls=$($analysis.proxy.calls)"
Write-Log "=== orchestrator done ==="
