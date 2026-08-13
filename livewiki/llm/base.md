---
title: Shared HTTP adapter for LLM provider requests
owner: generated
anchors:
  - packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS
  - packages/core/src/llm/base.ts#LlmTimeoutError
  - packages/core/src/llm/base.ts#LlmTimeoutError.constructor
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#parseRetryAfterMs
  - packages/core/src/llm/base.ts#readText
  - packages/core/src/llm/base.ts#requestWithRetry
  - packages/core/src/llm/base.ts#sleep
  - packages/core/src/llm/base.ts#withTimeoutMs
---

# Shared HTTP adapter for LLM provider requests

This page documents the single fetch/retry/timeout wrapper that every LLM provider client in `packages/core/src/llm/` shares.

## When to use this page

- **Configure** a provider's HTTP timeouts and retry behavior by reading the `AdapterConfig` options consumed by `requestWithRetry`.
- **Diagnose** provider failures by distinguishing `LlmRequestError` (HTTP status, retryable or terminal) from `LlmTimeoutError` (client-side abort, never retried).
- **Extend** the adapter (for example, to honor additional `Retry-After` semantics) by following the retry/status helpers documented below.
- **Override** `fetch` in tests via `adapterConfig.fetchImpl`, the single injection seam the adapter exposes.

## How it fits

`packages/core/src/llm/base.ts` lives alongside the per-provider client modules (Anthropic, OpenAI, local backends, …) inside `packages/core/src/llm/`. Each provider-specific client implements the `LlmClient` interface, but they all delegate the network call — including timeout, retry, and error normalization — to `requestWithRetry`. The adapter does not know about generation prompts, token streaming, or billing semantics; it only owns the HTTP envelope around a single provider call. Provider-typed errors (`LlmRequestError`, `LlmTimeoutError`) flow back up to the caller, which decides whether to surface the failure to a pipeline stage or surface the partial result.

## Diagram

```mermaid
%% livewiki/diagrams/llm-base.mmd
```

## Timeout policy and default

<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#withTimeoutMs -->

Every provider call flows through a per-attempt abort timer. The adapter has to decide three things before each fetch: how long to wait, whether the caller opted out of an abort timer, and how to forward the timeout value into the request options without losing the explicit `0`.

`DEFAULT_LLM_TIMEOUT_MS` is the fallback the adapter applies when the configuration omits `timeoutMs` entirely.

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
```

`DEFAULT_LLM_TIMEOUT_MS` is a five-minute (300,000 ms) upper bound applied whenever a caller does not pin `timeoutMs` in `AdapterConfig`. It exists so that a missing config value still produces a bounded client-side wait — long enough for slow reasoning-heavy completions, short enough to fail loudly when a provider stalls.

`withTimeoutMs` is the helper that decides whether the `timeoutMs` field is even forwarded onto a request shape.

```ts
export function withTimeoutMs(
  timeoutMs: number | undefined,
): { timeoutMs: number } | Record<string, never> {
```

`withTimeoutMs` takes either a number or `undefined` and returns an object literal — either `{ timeoutMs }` when defined or `{}` when undefined — so the caller can spread the result without dropping an explicit `0`. The reason `0` matters is that the adapter treats `0` as "disable the abort timer", and a normal truthy check would otherwise strip it.

## Timeout error type

<!-- lw:anchors packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor -->

When the abort timer fires, the adapter throws a typed error so callers can distinguish a client-side abort from a provider HTTP failure.

```ts
export class LlmTimeoutError extends Error {
```

`LlmTimeoutError` is an `Error` subclass used to signal that the client gave up waiting, regardless of whether the provider ultimately completes the generation in the background.

```ts
  constructor(provider: LlmProvider, timeoutMs: number) {
```

The constructor on `LlmTimeoutError` takes the provider identifier and the timeout value used for the attempt and stores both as readonly fields on the instance, with a human-readable message that records the provider, the configured timeout, and the explicit warning that the provider may still bill. It exists so callers can pattern-match a timeout without parsing the message string and so retries can be suppressed at the adapter level.

## Retry classification and `Retry-After` parsing

<!-- lw:anchors packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#parseRetryAfterMs -->

The retry loop only re-issues a request for a narrow set of HTTP statuses, and it lets the provider tell it how long to wait when the server cooperates.

```ts
function isRetryableStatus(status: number): boolean {
```

`isRetryableStatus` takes an HTTP status number and returns `true` only when the status is `429` or falls inside the `5xx` server-error range; every other status is treated as terminal for that attempt. The function exists to confine retries to statuses whose semantics actually justify a new request — transient overload and rate limiting — and to keep the adapter from accidentally retrying on `4xx` client errors.

```ts
function parseRetryAfterMs(res: Response): number | null {
```

`parseRetryAfterMs` takes a `Response` and returns the delay the server asked the client to honor, in milliseconds, or `null` when the header is absent or unparseable. It reads the `Retry-After` header, accepts the standard integer-seconds form by parsing it with `Number`, and falls back to HTTP-date parsing via `Date.parse` before returning `null` when neither form is valid; it does not cap the parsed value. The reason this lives in its own helper is that the retry loop wants to combine server-suggested delay with exponential backoff using `max(...)`, and it needs a single null-on-unknown signal to express "no opinion".

## Retry loop, abort, and error normalization

<!-- lw:anchors packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`requestWithRetry` is the actual HTTP envelope. It arms an abort timer for the attempt, runs `fetch`, classifies the outcome, and either resolves with a successful `Response` or throws one of two typed errors — never both, never neither.

```ts
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response> {
```

`requestWithRetry` takes a provider tag, the request URL, the request `init` object, and an `AdapterConfig`, and returns a `Response` once a non-retryable attempt succeeds or throws `LlmRequestError` / `LlmTimeoutError` after exhausting retries. The flow inside has three pieces: arming an `AbortController` only when `timeoutMs > 0` (so a configured `0` truly disables the timer), running `fetchImpl` with the abort signal, and deciding what to do with the result.

On a successful response (`res.ok`) the function returns immediately. On a status that `isRetryableStatus` rejects, the adapter reads the body for diagnostics and throws `LlmRequestError` once — that branch does not retry. On a retryable status, the loop records `lastStatus`, optionally consults `parseRetryAfterMs` for `429`/`503` only, drains the body with `readText`, and sleeps for `max(exponentialBackoff, retryAfterMs)` between attempts up to `maxRetries`.

The `catch` block has four explicit branches: re-throw `LlmRequestError` and `LlmTimeoutError` unchanged; translate a browser `AbortError` (the abort timer firing) into `LlmTimeoutError` and do **not** retry, because generation state is unknown and the provider may still bill; and treat remaining network errors as retryable with plain exponential backoff. When the loop exits without success, the function throws a final `LlmRequestError` whose message includes the last status or last error kind seen.

`sleep` is the small helper the loop uses to back off between attempts.

```ts
function sleep(ms: number): Promise<void> {
```

`sleep` takes a millisecond count and returns a `Promise<void>` that resolves after that delay; it exists so the retry loop can `await` a backoff without pulling in a larger utility dependency.

`readText` is the body-draining helper the retry path uses after a status decision is already made.

```ts
export async function readText(res: Response): Promise<string> {
```

`readText` takes a `Response` and returns `Promise<string>` resolving to the response body as text. It exists so the adapter can consume bodies without unhandled-rejection noise — the retry path actually invokes it inside a `.catch(() => "")`, which means a failing body read on a status the adapter has already classified will be silently ignored and the retry decision still stands.