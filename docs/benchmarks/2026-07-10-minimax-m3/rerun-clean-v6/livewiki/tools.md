---
title: tools
owner: generated
anchors:
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#plannedSymbolsFromOverview
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#readJson
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#scanPage
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#walk
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save
---

# tools

Two Node.js helpers used by the livewiki harness:
`acceptance-analysis.mjs` (offline acceptance gating for clean runs) and
`token-proxy.mjs` (local pass-through HTTP proxy that measures token usage
at the wire). The helpers share no code but are typically paired: the proxy