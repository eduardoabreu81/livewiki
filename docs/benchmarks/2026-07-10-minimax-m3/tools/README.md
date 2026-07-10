# Benchmark tools

## `token-proxy.mjs`

OpenAI-compatible reverse proxy that tallies tokens at the wire (same
instrument for livewiki and competitors). Forwards `Authorization`
untouched — no key is stored in the proxy.

### Outputs

| File | Content |
|---|---|
| `token-proxy-<label>.json` | Running summary + full `callLog` |
| `token-proxy-<label>.jsonl` | One JSON object per chat completion call |

### Per-call fields

`id`, `startedAt`, `endedAt`, `durationMs`, `method`, `path`, `model`,
`stream`, `statusCode`, `ok`, `usage` (prompt/completion/total + optional
`cachedPromptTokens` / `reasoningTokens` + raw provider object), `error`.

### Env

| Variable | Default |
|---|---|
| `LIVEWIKI_PROXY_PORT` | `8900` |
| `LIVEWIKI_PROXY_UPSTREAM` | `https://api.minimax.io` |
| `LIVEWIKI_PROXY_OUT_DIR` | `%TEMP%` / `$TMP` |

### Example

```powershell
$env:LIVEWIKI_PROXY_OUT_DIR = "C:\path\to\rerun\metrics"
node token-proxy.mjs livewiki-ux-rerun
# client baseUrl: http://127.0.0.1:8900/v1
```

See `../RERUN.md` for the post-U–X livewiki-only MiniMax procedure.
