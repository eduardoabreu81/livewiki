# Timeout / retry policy (post clean-v3 review)

**Status:** product policy decided and implemented in core (no paid API for this change).

## Observed clean-v3 issue

Five MiniMax responses took **> 60 s** (old default) but returned HTTP 200 on the
proxy. The client aborted and retried while the provider finished and billed.
Proxy−batch gap: **101 619 prompt + 37 147 completion** tokens.

A second bug: even after adapter-level no-retry on AbortError, the **stage-4
repair loop** treated any `llmError` with `continue`, so timeouts still started
new generations. That is fixed: **`llm_timeout` is terminal for the task**.

## Decided policy

1. Timeout is a **client/provider** setting, **not** stage-4-specific.
2. Expose **`timeoutMs`** in `.livewiki/config.json`.
3. **Default: 300_000** ms (5 minutes).
4. Local providers may use higher values; **recommendation: 900_000** ms.
5. **`timeoutMs: 0`** disables the client abort timer.
6. **`AbortError` / timeout must not auto-retry** (adapter or batch repair).
7. Keep retry for **explicitly retryable HTTP** statuses (**429**, **5xx**).
8. **Network errors** keep existing retry for now; risk of unknown outcome after
   the request was sent is documented.
9. Batch records **`llm_timeout`** (and other generate throws without usage)
   as **usage unknown** — not cost zero, not synthetic models; aggregates set
   **`usageIncomplete`**; human status **and** result output warn when
   incomplete.
10. **Proxy or provider billing** remains authoritative for wire cost.
    Network errors can also leave provider state/cost unknown after send.

## Implementation map

| Layer | Behavior |
|-------|----------|
| `config.ts` | `timeoutMs` 0..2_147_483_647; `assertValidTimeoutMs` on load + `validateConfigForBatch` |
| `createLlmClient` | validates + passes `timeoutMs` including `0` |
| adapters | `withTimeoutMs()` (not truthy-gated) |
| `requestWithRetry` | default 300_000; timer only if `> 0`; AbortError → `LlmTimeoutError`, no retry |
| stage-4 loop | `llm_timeout` → fail task, **no** repair `continue` |
| UsageAttempt | `usage: null`, `usageKnown: false` on timeout |

## Tests (offline only)

Adapter, config, factory generate, and **batch integration** (`llm_timeout` +
`maxRepairAttempts: 2` → `callCount === 1` for that module, no repair prompt).
No real API; no multi-minute wall waits.
