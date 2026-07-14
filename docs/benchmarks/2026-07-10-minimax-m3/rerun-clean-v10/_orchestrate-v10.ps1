# Clean v10 infrastructure precondition harness.
#
# The paid orchestration was intentionally not started because the caller
# environment did not contain MINIMAX_API_KEY. This script preserves the exact
# publish-safe check used for that terminal decision; it never prints a secret
# and cannot make a network request.
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$targetSha = "efd9b21e0ea902ce4d7f9e4b0ebe89ff65d8e3cc"

$head = (git -C $repoRoot rev-parse HEAD).Trim()
$originMain = (git -C $repoRoot rev-parse origin/main).Trim()
$minimaxKeyPresent = -not [string]::IsNullOrWhiteSpace($env:MINIMAX_API_KEY)
$openAiKeyPresent = -not [string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)
$keyPresent = $minimaxKeyPresent -or $openAiKeyPresent

Write-Output "HEAD_MATCH=$($head -eq $targetSha)"
Write-Output "ORIGIN_MAIN_MATCH=$($originMain -eq $targetSha)"
Write-Output "MINIMAX_API_KEY_PRESENT=$minimaxKeyPresent"
Write-Output "OPENAI_API_KEY_PRESENT=$openAiKeyPresent"

if ($head -ne $targetSha -or $originMain -ne $targetSha) { exit 2 }
if (-not $keyPresent) { exit 1 }
exit 0
