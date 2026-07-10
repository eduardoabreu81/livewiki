# LLM providers and presets

> The batch and update flows both need an LLM (the deterministic indexer does not). The `LlmClient` interface is small (`provider`, `model`, `generate(req)`); providers are wired through a thin `createLlmClient` factory driven by a **presets-as-data** table. Adding a provider is one row of data, not new code.

## Architecture

```
   config.json (preset + model)
        │
        ▼
   resolveProviderFromConfig(config)        ◀── presets.ts: PRESET_TABLE
        │                                     (data: adapter / baseUrl /
        ▼                                      envVar / pricing.defaults)
   createLlmClient(repoRoot, config)
        │
        ▼
   AnthropicAdapter  |  OpenAiCompatAdapter   ◀── llm/base.ts: requestWithRetry
        │                                         (timeout, retry, exponential backoff)
        ▼
   POST {baseUrl}/v1/messages  |  POST {baseUrl}/v1/chat/completions
        │
        ▼
   Normalize → { content, usage: { inputTokens, outputTokens, model } }
```

Source: `packages/core/src/llm/` (`base.ts`, `anthropic.ts`, `openai-compat.ts`, `types.ts`, `index.ts`).

## The `LlmClient` interface

```ts
interface LlmClient {
  readonly provider: LlmProvider;     // "anthropic" | "openai-compat"
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

interface GenerateRequest {
  system: string;
  user: string;
  maxTokens?: number;     // default 4096
  temperature?: number;
}

interface GenerateResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
}
```

Two adapters today:

- **`AnthropicAdapter`** — `POST {baseUrl}/v1/messages` (Anthropic Messages format). Normalizes `input_tokens → inputTokens`, `output_tokens → outputTokens`.
- **`OpenAiCompatAdapter`** — `POST {baseUrl}/v1/chat/completions` (Chat Completions format). Used by OpenAI, OpenRouter, DeepSeek, Kimi, MiniMax (via Gemini), NVIDIA NIM, Ollama, LM Studio.

Both share `requestWithRetry` from `llm/base.ts` for timeout + exponential-backoff retry. Both use the native Node 20+ `fetch` — no SDK.

## Presets table (Phase 5 step 5)

`packages/core/src/presets.ts` defines `PRESET_TABLE`, a const record. Each entry:

```ts
interface ProviderPreset {
  name:     "anthropic" | "openai" | "openrouter" | "deepseek" | "kimi"
           | "minimax"  | "gemini"| "nvidia"     | "ollama"   | "lmstudio";
  adapter:  "anthropic" | "openai-compat";
  baseUrl:  string;
  envVar:   string;                   // name only — value stays in process.env
  pricing:  PricingTable;             // USD/1M tokens, best-effort
  notes:    string;                   // operational hints, no secrets
}
```

Highlights:

- **`anthropic`** — official Anthropic Messages endpoint; adapter `anthropic`.
- **`minimax`** — MiniMax, which exposes an Anthropic-compatible endpoint, so it uses the `anthropic` adapter for optimized cache reads (prompt caching).
- **`ollama`** / **`lmstudio`** — local, no auth. baseUrl defaults to `localhost:11434` / `localhost:1234`. Adapter `openai-compat`.
- **Pricing is best-effort.** `PRICING_REFERENCE_DATE` lives in `pricing.ts`; the `notes` field on each preset surfaces freshness. Override via `config.pricing.<model>` when needed.

### Adding a preset

One row of data, no new code:

```ts
"newprovider": {
  name: "newprovider",
  adapter: "openai-compat",       // or "anthropic" if it speaks Messages
  baseUrl: "https://api.newprovider.com",
  envVar:  "NEWPROVIDER_API_KEY",
  pricing: {},                     // empty => no USD, tokens-only reports
  notes:   "openai-compat endpoint, no streaming support"
}
```

The factory in `llm/index.ts` picks the adapter by name; `validateConfigForBatch` ensures `preset` (or legacy `provider`) + `model` are set; `MissingApiKeyError` is thrown if the env var is missing.

## Configuration schema (`.livewiki/config.json`)

```ts
interface LivewikiConfig {
  preset?:    PresetName;             // Phase 5 — preferred
  provider?:  "anthropic" | "openai-compat";   // legacy
  model?:     string;                 // NO default — must be set
  baseUrl?:   string;                 // override preset baseUrl
  pricing?:   PricingOverride;        // { "<model>": { input, output } }
  language?:  string;                 // default "en"; only affects prompts
  languages?: string[];               // default ["ts","tsx","js","jsx","py"]
  ignores?:   string[];
}
```

Resolution order (in `resolveProviderFromConfig` + `createLlmClient`):

1. `config.preset` → expand into `adapter`, `baseUrl`, `envVar`, `pricing`.
2. Else `config.provider` → legacy defaults.
3. Else `MissingProviderConfigError` (clear message pointing at the config file).

API key: **`process.env[<resolved.envVar>]`**. Never in config, never in logs, never in checkpoints, never in errors. Regression test: `packages/core/src/key-leak.test.ts`.

### No hardcoded default model (commit 3894f6e)

`livewiki batch` without config fails with `MissingProviderConfigError`. The error message points at `.livewiki/config.json` and shows the schema (`preset`, `model`) — never falls back silently.

## Prompt templates (`prompts.ts`)

- All system prompts in **English** so contributors can audit them.
- `${language}` appears in the user prompt as an explicit "write in this language" instruction. It only affects the **generated doc**, not the prompt itself.
- **Closed key list.** Stage 4 hands the LLM the canonical symbol keys for the module and tells it to distribute them across sections — never invent a key. `verify` rejects keys not in the index.

There are two prompts:

- `buildStage2RefinePrompt(modules, language)` — module identification refinement (LLM may rename / merge / split modules from the heuristic).
- `buildStage4Prompt(module, closedKeyList, symbolsTable, truncatedSource, language)` — per-module documentation.

Default budgets:

- `DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000` — code passed to the LLM per module.
- `DEFAULT_OUTPUT_TOKEN_BUDGET  = 4_000` — response cap.

The orchestrator's `contextCharBudget` defaults to `60_000` chars (≈15k tokens).

## Validation (Fix I rev2)

The refined module list is validated before acceptance:

- JSON parses; `modules` is a non-empty array.
- Coverage ≥ 80% (preferred 100%) of heuristic files.
- No duplicate IDs, no ID-less modules, no out-of-repo paths.
- On rejection: heuristic wins, error recorded in stage-2 checkpoint with code `refine_rejected` (or similar). Task status remains `done` — not a task failure.

## Token accounting (SPEC §"Contabilidade de tokens (Fase 3)")

Every adapter returns `usage` in `GenerateResult`. The orchestrator (`batch.ts`) appends it to `usageHistory`:

```ts
{ attempt, usage: { inputTokens, outputTokens, model },
  costUsd: { input, output, total, refDate } | null,
  finishedAt }
```

`costUsd === null` whenever the model isn't in `PRICING_TABLE` or the user-supplied override. The CLI/JSON report leads with tokens; USD is a secondary line marked "estimated, table as of `<PRICING_REFERENCE_DATE>`".

## Known gotchas

- **Anthropic prompt caching** only kicks in when the request hits the Anthropic API via the `AnthropicAdapter`. Providers that re-host Anthropic-compat (e.g. MiniMax) get the same caching.
- **DeepSeek-style reasoning blocks** — OpenAI-compat adapters can break if the upstream streams `<think>…</think>` blocks inside assistant messages. Phase-6 backlog item: adapter hardening so the openai-compat adapter tolerates these in conversation history.
- **HTTP proxy support** — the LLM client uses native `fetch`; `HTTP_PROXY` / `HTTPS_PROXY` environment is honored by Node's `fetch` for most proxies. Phase-6 backlog item: explicit support is needed in some corporate environments.
- **No telemetry, no network** except for LLM calls in batch mode and a one-time WASM grammar download on first use.

## Where to go next

- [MCP server tools](mcp-server.md) — the consumer surface of this layer.
- [Batch pipeline](../workflows/batch-pipeline.md) — what calls the LLM and how usage is aggregated.
- [Inviolable rules](../operations/inviolable-rules.md) — API-key handling.