# Inviolable rules and safety guarantees

> The SPEC's "Inviolable rules" are the architectural lines livewiki will not cross. They are enforced **in code**, not in prompts — that's why they are "inviolable" and not "conventions". Every release upholds them; every test set assumes them.

This page is the canonical reference. When in doubt, the [SPEC.md](../../SPEC.md#inviolable-rules) is authoritative; this page explains **why each rule exists and where it is enforced** so future agents can recognize a violation before merging.

## Rule #1 — Restricted writes (`safe-io`)

> "All code that writes to disk goes through a single I/O module (`src/core/safe-io.ts`) that validates the path against the allowlist: `livewiki/` and `.livewiki/` of the target repo (plus the pointer exception, rule #2). Writing outside that = throw an error. No exceptions, not even in tests."

Source: `packages/core/src/safe-io.ts`.

### Allowlist

```ts
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
```

The pointer exception (rule #2) is opt-in via `SafeIoOptions.allowPointer` and adds `AGENTS.md` / `CLAUDE.md` at the repo root.

### Path resolution — symlink defense

`resolveAndValidate(repoRoot, relPath)`:

1. Validate the declared path (no absolute, no `..` segments, no traversal) — fail fast.
2. Find the deepest existing ancestor of the target.
3. `realpath` that ancestor.
4. Reconstruct the final absolute path = `realpath(ancestor) + suffix`.
5. **Revalidate the allowlist** on the final path — closes symlink-escape attacks:
   - `livewiki` symlink → `/tmp/` → realpath shows `/tmp`, **outside** the allowlist → rejected.
   - `livewiki/sub` symlink → `../src` → realpath shows `src`, **outside** → rejected.
   - `livewiki/leaf` symlink → `/etc/x` → realpath shows `/etc`, **outside** → rejected.

Tested for both legitimate symlinks (allowed) and attack patterns (rejected) in `safe-io.test.ts`.

### Where to apply

**Every** disk write in the project must funnel through `safe-io.writeText`, `safe-io.mkdir`, `safe-io.remove`, or — for the opt-in pointer exception — `safe-io.writeText(repoRoot, path, content, { allowPointer: true })`. Even tests.

If you find yourself calling `node:fs/promises.writeFile` directly in production code, **stop** — that's the rule.

### `exists()` is also allowlist-bounded

Knowing whether a file exists **outside** `livewiki/` is itself a leak. `safe-io.exists()` validates the allowlist before checking access — even reads can be queried only for allowlisted paths.

## Rule #2 — Pointer in `AGENTS.md` / `CLAUDE.md` is opt-in

> "Only with an explicit flag (`--write-pointer`) or interactive confirmation. Never automatic. The modification is an append of a delimited block (`<!-- livewiki:start --> ... <!-- livewiki:end -->`), idempotent."

Source: `packages/core/src/pointer.ts` and `packages/cli/src/commands/pointer.ts`.

The pointer is the **only** exception to rule #1, and it is **conscious and explicit**:

- `safe-io.writeText(..., { allowPointer: true })` is the only sanctioned call site.
- `pickPointerFile(hasAgentsMd, hasClaudeMd, requested?)` decides the target (prefers existing `AGENTS.md`).
- `buildPointerBlock()` produces a short paragraph + link to `livewiki/quickstart.md`. Agents who read `AGENTS.md` see a pointer to the wiki — never content duplication.
- Without `--write-pointer` and without a TTY, the command prints instructions and exits — no silent writes.

## Rule #3 — The DB is derived

> "No information may exist only in SQLite. Everything that matters for handoff lives in versioned markdown/manifest."

This is the load-bearing rule that makes **cross-machine handoff** possible. A fresh clone + `livewiki index` rebuilds everything; the SQLite index is fully reconstituted from the wiki markdown + the code.

Implications:

- **Manifest lives in `livewiki/.manifest.json`** (versioned). It carries `lastDocumentedCommit`, `snapshotHash`, `pendingBatch`. A fresh machine reads the manifest, sees a pending run, and continues.
- **`moved` detection rewrites the markdown, not just the DB.** Without rewriting the markdown, the new path is lost on next rebuild (the DB's anchor rows are derived). Order: rewrite markdown → update DB → create debt.
- **`write_doc` rollback on verify failure.** If `verify` rejects the content, the file is `unlink`'d. The DB never carries an "intended" anchor — only what's on disk.

## Rule #4 — No telemetry, no network (with two narrow exceptions)

> "No telemetry, no network except: LLM calls in batch mode (opt-in, user's key) and a one-time download of WASM grammars on first use."

The WASM grammars live in the repo (`packages/core/grammars/*.wasm`); they are shipped, not downloaded. The LLM calls are:

- `livewiki init --batch` (Phase 3 batch mode) — calls the configured API with the user's key.
- `livewiki update --llm` (Phase 5) — delegates to batch.
- No telemetry, no analytics, no remote calls.

The MCP server also does not call the LLM today — it exposes wiki tools only. Future tools that call the LLM would do so via the same `createLlmClient` factory.

## Rule #5 — Test coverage

> "Tests: vitest; 80% minimum coverage in core (indexer, anchors, debt, safe-io). CLI/MCP may have lower coverage, but the main flows have integration tests."

Current coverage (per AGENTS.md, last validation):

- 80%+ statements / 80%+ branches / 90%+ funcs in core.
- `init.ts` and `batch.ts` are covered via E2E/subprocess tests in `cli-batch-e2e*.test.ts` rather than unit tests — they are intentionally out of the `vitest` unit suite because the orchestration spans multiple subsystems.

See [testing-and-validation.md](testing-and-validation.md) for the test map.

## Rule #6 — Human content is untouchable

> "`owner: human` pages and `lw:manual` blocks are never modified by automated writes (LLM or tool). `verify` compares manual blocks byte-for-byte after each update; a change = rejected write. Debt on a human-content anchor does not trigger a rewrite — it generates a 'human review' item in `status`."

This is what makes livewiki **not just an LLM toy**. The wiki is shared territory between LLM-generated docs (`owner: generated`), human-written business docs (`owner: human`), and mixed pages (`owner: mixed`) where `<!-- lw:manual -->…<!-- /lw:manual -->` blocks are human reservations inside otherwise-generated content.

Where it is enforced:

- **`anchor-ledger.ts`** — moves are rewritten in markdown **except** for anchors in `lw:manual` or on `owner: human` pages. Debt is emitted with `assignee: human` instead.
- **`batch.ts` stage 4** — `checkPageOwner` throws `refused_human_page` if the target page is `owner: human`.
- **`verify.ts`** — `manual_block_altered` issue when a baseline manual block's hash diverges; rolled back by `write_doc`.
- **`document-as-you-go` skill** — explicitly tells the agent "do not write to a page with `assignee: human` debt".

## Where to go next

- [Data model](../architecture/data-model.md) — `debt.symbol_key`, `manual_blocks`, `doc_pages` and how they support the rules.
- [Testing and validation](testing-and-validation.md) — which tests back which rules.