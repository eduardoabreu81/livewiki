# Roadmap — post-MVP backlog

> Phase status lives in `AGENTS.md` §Status (source of truth). This file
> tracks evaluated, approved backlog items that come AFTER the committed
> phases (Phase 6 export, Phase 7 viewer) and records why rejected ideas
> were rejected, so they are not re-litigated.

## Current execution order (see AGENTS.md)

> **Reconciled 2026-08-03** (maintainer decision; supersedes 2026-08-02):
> #16 dogfood batch DONE, cross-platform CI DONE (matrix green twice),
> #6 v1 DONE. The remaining pre-beta queue is **#17 viewer version
> stamp + source deep-links → #18 `view --ref` → #19 Go / #20 Rust /
> #21 Java tier-1 (Go pilot first) → #23 repository understanding
> layer → #22 CodeWiki-grade output format (promoted pre-beta
> 2026-08-03) → beta launch (npm publish, with the naming/domain
> decision before it)**. #6 v2 (pay-variant) and the optional
> hardening list stay post-beta.
> items 1–5 below are DONE (acceptance E2E passed with exit 0; the blind
> dual-eval A/B cycle closed the gap to OpenWiki to Δ0.40–0.45 weighted at
> ~6% of its token cost; R11-A validated and kept; commit/push done).
> The active queue is now: **Phase 6 export-target validation (DONE
> 2026-07-26: generic/github-wiki/gitlab-wiki on a real corpus) → Phase 7
> local viewer → cross-platform CI (last) → post-Phase-7 backlog below.**
> Also delivered beyond this plan: tier-2 universal prose floor, closed
> repair contract, rationale evidence, risk-weighted debt ordering, MCP
> workflow hints, the recovery tier (surgical repair + relaxed completion
> round), product-first quickstart orientation, concept-topic coverage,
> nav/clarity hardening, and the concern-topic refine pin.


1. Review the uncommitted R10/R10.1 + R11-NAV body. R11-NAV's deterministic
   intent routes and auxiliary de-emphasis are implemented and green; strict
   autonomous paid-E2E acceptance remains open.
2. Run one fresh standalone-provider acceptance E2E only after explicit
   at-the-moment authorization. Do not use a rerun-to-green loop.
3. After review, decide separately whether to commit/push and launch the beta.
4. Review the R11-A concept-topic implementation now present in the working
   tree; validation and any launch-gate decision remain separate.
5. Revise the blind-evaluation instrument before using scores for another
   product decision.
6. Phase 6 Lot 6A follow-up — manually validate the remaining local export
   targets after `generic` (already implemented and locally validated).
7. Cross-platform/GitHub validation after the local product flows pass.
8. Phase 7 — local viewer + templates (self-contained static site, client-side
   search, rendered Mermaid, no executable template code).

The independent quality review vs frozen OpenWiki
(`docs/benchmarks/2026-07-10-minimax-m3/QUALITY-REVIEW-V18.md`) is **complete**.
Its navigation findings were implemented in Lots M (`0746860`, deterministic
quickstart/tasks/navigate) and N (`59b1112`, page-opening contract + semantic
titles + `missing_page_opening` / `title_equals_module_id` validations). The
clean-v18 benchmark run (13/13 modules, verify clean, exact accounting) is the
final state of the public comparison evidence; no further benchmark or harness
run is planned unless a product defect requires a focused reproduction. The
maintainer decides when (and whether) to publish a `docs/BENCHMARK.md` note.

## Required product-flow visibility (agent first, human next)

This is an original product requirement, not a benchmark-only optimization.
`VISION.md` defines two content layers: a structural wiki for agents and a later
human/product narrative generated from that structure — "map first, then a
story." The current deterministic Mermaid artifacts (`structure.mmd`,
`modules.mmd`, and per-module class diagrams) provide useful inventory and
traceability, but they do not by themselves explain how a product, application,
or repository works. A directory tree says what exists; a product-flow view must
show how responsibilities communicate to produce behavior.

The bounded semantic flow layer is implemented in the uncommitted R10/R10.1
body. R11-NAV now exposes those existing flows directly from Quickstart and
Tasks and moves auxiliary inventory out of primary navigation. R11-A
concept-topic synthesis is implemented in the working tree and remains
unvalidated, uncommitted, and outside the beta-launch gate until review.
Phase 7 must render the same canonical artifacts for humans instead of
inventing a separate, competing narrative.

Required content:

- a concise "How it works" entry from Quickstart to the repository's principal
  end-to-end flows;
- component/data-flow diagrams that show entry points, responsibility
  boundaries, state or persistence, external systems, outputs, and the arrows
  between them;
- sequence or state views for a small number of critical workflows when order,
  retry, rollback, recovery, or ownership transitions materially affect the
  behavior;
- companion prose for every diagram: purpose, ordered flow, invariants, failure
  paths, and links to the relevant topic and module pages; and
- topic-oriented synthesis across modules, so a reader does not have to assemble
  one workflow manually from many per-module pages.

Generation constraints:

- infer flow candidates generically from repository entry points, module/import
  relationships, commands/routes, configuration, persistence, and external
  boundaries; never hardcode livewiki-specific guide names into the product;
- retain the existing deterministic structure/import/class diagrams as the
  source map, but do not count them as satisfying the semantic-flow requirement;
- keep diagrams bounded and readable; prefer several focused flows over a
  mega-diagram or an edge-dense call graph;
- LLM-assisted semantic diagrams are allowed only as batch artifacts, clearly
  identified as synthesized documentation, source-cited/anchored, Mermaid-
  parsed, link-validated, and subject to the existing artifact/repair gates;
- preserve a textual fallback so agents and humans can understand the flow
  without rendering Mermaid; and
- generate one canonical flow artifact that CLI, MCP, export, and the Phase 7
  viewer all consume. Do not maintain separate agent and human truths.

Acceptance evidence must demonstrate that, on a real repository, both an agent
reading the low-token entry path and a human using the Phase 7 viewer can answer:

1. What starts the principal workflow?
2. Which components participate, and how do they communicate?
3. Where does state move or persist?
4. What is produced at the end?
5. What happens on the critical failure/recovery path?

The answer must come from a short topic path plus a readable diagram, not from a
directory tree or manual reconstruction of module pages. `SPEC.md` is aligned
for bounded semantic flows and R11-NAV's deterministic intent routes. The
R11-A amendment is implemented under maintainer authorization but still needs
review and validation; it preserves the
distinction between rejected automatic mega-call-graphs and approved, bounded
semantic synthesis.

## Approved backlog (post Phase 7, in priority order)

Source: maintainer-approved evaluation (2026-07-13) of
[DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp),
a structural code-intelligence MCP, and the 2026-07-14 evaluation of GitHub's
cross-repository agentic documentation workflow. They are design references,
not dependencies or required integrations. Useful patterns are reproduced
natively through livewiki's own core, CLI, MCP server, and skills.

### Native patterns to preserve

- persistent, incremental, rebuildable local structural memory;
- compact and bounded context packages for agents;
- deterministic change/debt detection before optional LLM work;
- parity across CLI, MCP, skills, and automation surfaces;
- a narrow validated action boundary between generated intent and disk/host
  changes; and
- draft-first Git-host automation with human review and operational metrics.

### 1. Identifier-aware FTS5 tokenizer for `livewiki_search` ✅ DONE 2026-07-28

`packages/mcp/src/search.ts` uses the porter tokenizer, so camelCase /
snake_case identifiers are single opaque tokens: searching "resolve debt"
does not match `resolveDebt`. Add identifier splitting (camelCase,
snake_case, kebab-case) at index and query time. `search.db` is rebuilt on
MCP startup, so no schema/migration cost. Acceptance: a search for a
sub-word of any anchored symbol name returns the page that anchors it.

### 2. Native compact change-impact context ✅ DONE 2026-07-28

Extend the existing `livewiki update` work package and MCP responses with a
bounded, documentation-focused impact view: changed symbols, affected anchors,
pages, modules, dependencies, and only the relevant source snippets. Reuse the
local livewiki index; do not call or require another graph/MCP product. The same
structured payload must be available through CLI JSON and MCP so an active agent
or standalone provider receives equivalent context.

### 3. Index freshness and automatic local synchronization ✅ DONE 2026-07-28

Make index freshness explicit and cheap. Long-running livewiki surfaces should
detect repository changes, debounce local re-indexing, and expose snapshot age
and stale/ready state. Startup and recovery remain rebuildable from the repo and
wiki. No daemon, cloud service, or external watcher may be required for normal
CLI use.

### 4. `livewiki install` — agent auto-detection ✅ DONE 2026-07-28

One command that detects installed coding agents (Claude Code, Codex,
Cursor, Zed, ... — start with the agents already covered by the Phase 5
presets/templates) and offers to configure, per agent: the MCP server
entry, hook templates (`packages/cli/templates/`), and the AGENTS.md /
CLAUDE.md pointer. Constraints: pointer stays opt-in per rule #2 (explicit
flag or interactive confirmation, never silent); every write outside the
repo allowlist is shown before it happens; idempotent re-run.

### 5. `livewiki status --diff` — pre-commit debt preview ✅ DONE 2026-07-28

The anchor ledger detects debt AFTER a commit/index. Add a mode that maps
the UNCOMMITTED working-tree diff to the wiki pages whose anchors it would
invalidate ("this diff will invalidate anchors in pages X, Y"), closing
the document-as-you-go loop at pre-commit time instead of post-commit.
Read-only: no ledger mutation, no debt creation — preview only.

### 6. GitHub Actions template — "docs-debt on merge" ✅ v1 DONE 2026-08-02

Source: maintainer-approved evaluation (2026-07-14) of GitHub Agentic
Workflows for cross-repo documentation
(github.blog, Aspire team: docs draft-PRs on product merge, SME
auto-review, 82 merged doc PRs at a 44.8h median). Their pattern validates
livewiki's document-as-you-go thesis; livewiki's structural advantages to
preserve: mechanical verification gates hallucination BEFORE human review
(their only gate is the SME), and the anchor-ledger answers "does this
merge need docs?" deterministically with ZERO tokens (78% of their runs
spent a model call to conclude "no docs needed").

The template: on PR merge, run livewiki's own `index` + debt check
(deterministic, no LLM). When debt exists, livewiki may use the configured
standalone provider to pay it, validates every write, and opens a DRAFT PR with
the original PR author as reviewer. The no-debt case costs zero tokens. The
workflow uses ordinary repository permissions and narrowly allowlisted outputs;
it does not require GitHub Agentic Workflows, a custom GitHub App, or an external
agent/memory service. Protected-path changes are refused, and failure to create
a safe draft leaves a visible actionable result rather than silently writing.
Depends on Phase 6 (export) for the separate-docs-repo variant; the same-repo
variant could ship earlier. Also adopt their operational-metrics discipline
(median hours from feature merge to merged docs — `update-metrics.ts` is the
base).

**v1 shipped 2026-08-02 (detect + report, zero tokens):**
`packages/cli/templates/github-actions/docs-debt.yml` — push-triggered
`index --quiet` + `status --json`, debt table in the step summary,
`LIVEWIKI_DEBT_MODE=enforce|report` (fail vs informational),
`contents: read`, no secrets/GitHub App. Dogfooded by
`.github/workflows/docs-debt.yml` (local build pre-publish, report mode
for the first window). **Still open (v2):** the pay-variant — provider
pays the debt via `update --llm`, then `gh pr create --draft` with the
merge author as reviewer; needs provider secrets and
`pull-requests: write`.

### 7. Bounded parallel stage-4 execution (`batchConcurrency`) ✅ DONE 2026-08-01

Source: 2026-08-01 market scan (`docs/market-research.md`): Mintlify cut a
large-repo run 70→45 min with parallel section writers; RepoAgent ships
multi-threaded generation; Graphify ships concurrent LLM extraction
(`--max-concurrency`) with 429/Retry-After discipline. livewiki's stage 4
runs tasks sequentially (`packages/core/src/batch.ts:726`), and with
quality/cost already solved (Etapa 3: exit 0, verify zero, ~6–8% of
OpenWiki tokens) wall-clock is now the weakest axis. Add a
`batchConcurrency` config key (default 1 = current behavior; 3–5 typical).
Tasks are already atomic (transactional write, per-task checkpoint,
monotonic usage accounting), so they parallelize cleanly. Design care:
circuit-breaker semantics under interleaved failures, shared rate-limit
backoff honoring `Retry-After`, monotonic per-task usage history, and a
deterministic barrier before stage 5 (flows/topics consume stage-4
results).

**Result (2026-08-01, shipped in `dac874d`):** the sequential loop is
gone — stage 4 runs a bounded worker pool over the shared task cursor
(`batchConcurrency` config, integer 1..16, default 1; `--concurrency`
on `batch` and `init --batch`). Breaker/rollback stop NEW dispatch and
drain in-flight tasks; the pool is awaited before stage 5; reports
stay sorted by stage-3 priority; `Retry-After` is honored in
`llm/base.ts:parseRetryAfterMs`. Stage 5 stays sequential (shared hub
files inside transactions). Tests: `batch-concurrency.test.ts`.
The "runs tasks sequentially" premise above is historical — kept as
the source rationale.

### 8. Native CALLS edges with confidence tags

Source: 2026-08-01 Graphify analysis (EXTRACTED/INFERRED edge tags) plus
the standing watch-list item. Extend the indexer beyond imports with call
edges tagged by extraction confidence, and consume them in flow/topic
candidate detection: fewer false candidates, fewer burned repair rounds
(the class of bug fixed in `733fc53` came from weak graph evidence).
Native only (rule #8); never a general-purpose call-graph database — the
rejection below stands; this is the documentation-focused edge set only.

### 9. Community-detection cross-check for stage-2 modules

Source: 2026-08-01 Graphify analysis (Leiden communities with LLM-free
labels) plus the standing watch-list item. Use deterministic graph
clustering as a cross-check or fallback for the directory heuristic in
module identification. The exact-partition contract (100% of the indexed
inventory, heuristic wins on any rejection) is preserved; the goal is
better partitions with less reliance on the LLM refine pass.

### 10. Viewer freshness badge + social previews (Phase 7 polish)

Source: maintainer request + the codec8 thread insight (2026-08-01
`docs/market-research.md`). (a) A deterministic "new/recently changed"
badge in the viewer (sidebar + page header), derived from anchor-ledger
`detected_at` and/or git history — zero LLM, consistent with the
staleness-is-deterministic principle. (b) Social/OG preview metadata
(title, description, generated card) in the exported/built site so shared
doc links render professionally on Slack/Discord.

### 11. `export readme` — README as an output, not just an input

Source: 2026-08-01 codec8 analysis (`docs/market-research.md`) — their
sharpest idea is generating the repo README itself, and it connects to
the no-README fallback question: today a repo without a README gets an
omitted block plus a synthesized digest fallback; with this target the
answer becomes "livewiki writes you a starter README from the wiki".
An opt-in `export readme` target (Phase 6 family) that synthesizes a
README from accepted wiki pages (quickstart purpose, module digests,
flows). Hard constraints: only for repos without a README, or explicitly
opt-in overwrite of a `owner: generated`-marked block — never touches
human-authored README content (rule #6); content anchored and verified
like any generated artifact; positions livewiki's top-of-funnel ("your
first artifact in minutes") against one-shot generators while the debt
ledger keeps the long-term moat.

### 12. EOL-insensitive content hashing (phantom-debt fix)

Source: 2026-08-01 incremental-loop test on the real MPTP repo
(`docs/market-research.md` session; corpus `/c/tmp/livewiki-e2e/incremental-mptp-2026-08-01/`).
A CRLF↔LF-only difference (which git produces silently on checkout via
`core.autocrlf`) changes every `content_hash` and floods the ledger with
phantom `changed` debt — ~50% of 956 items in the test were exactly this.
Normalize line endings to `\n` before all content hashing (file-level and
symbol-level). The upgrade must NOT emit a one-time phantom debt wave for
EOL-only files: silently migrate hashes when the stored hash still matches
the legacy raw-bytes hash.

### 13. Conservative twin-file `moved` detection

Source: same 2026-08-01 test. Provider twins (`elevenlabs_music.py` hardened,
`sonilo.py` unchanged, identical old bodies) produced `moved` rewrites
pointing page anchors at the twin that KEPT the old implementation — verify
passes (anchors exist) while prose and anchor describe different
implementations: an anti-hallucination hole. Policy (maintainer-approved):
accept a `moved` only when the symbol is gone from ALL active files (no
same-name twin survives anywhere); otherwise classify as `changed` (donor)
and let the new occurrence surface as new/undocumented.

### 14. In-session cost accounting

Source: maintainer review of the 2026-08-01 incremental MPTP update. The
in-session payment path (the agent already in the user's session writes
the prose) rides the host subscription instead of per-token billing — a
real cost in a different currency, and today it is UNMEASURED: batch has
exact checkpoint accounting, in-session has nothing. Make the loop
measurable: every payment session records estimated tokens written +
debt closed (wire `--record-write` / `update-metrics.ts` into the flow as
a required step, surfaced in `status`/metrics), so the in-session vs
batch economics per repo are decided on numbers, not guesses.

### 15. Activity dashboard (viewer)

Source: maintainer directive 2026-08-01 ("everything accounted and
expressed to the client"). Once item 14's accounting history exists
(`update_metrics.json` + batch checkpoints), the Phase 7 viewer gains an
Activity/dashboard page rendering the full documentation-activity history
of the repo: packages emitted, tokens consumed per period (estimated
in-session vs provider-billed batch), debt burndown over time, writes per
page, and time-to-document metrics (median hours from code change to paid
debt — the operational-metrics discipline of backlog #6). Static, offline,
deterministic — built at site-build time from the metrics file and
index.db, zero LLM. Implemented after item 14.

### 16. Dogfood batch on the livewiki repo itself ✅ DONE 2026-08-02

Source: maintainer directive 2026-08-02, after the deterministic `init`
regen of the repo's own stale wiki. The reindex surfaced the real debt
behind months of drift: 208 `changed` items across the dogfood module
pages (`core.md`, `cli.md`, `mcp.md`) — pages anchored to code written
long before the U–X/R10/R11/Etapa series. Run one approved `init --batch`
(paid, MiniMax-M3 or current reference provider) on this repository to
regenerate the module pages from current code, closing the 208 items and
leaving `verify` at zero issues. Side benefits: a live self-hosting
corpus for the Activity dashboard and a real-world acceptance pass over
the current pipeline (recovery tier, topics, concurrency). Requires
explicit paid-call approval at execution time.

**Result (2026-08-02, MiniMax-M3 via openai-compat + token proxy,
`--no-refine`):** run #1 `completed`, 138 tasks done / 0 failed, exit 0,
~30 min. Verify OK (141 pages, zero issues). Accounting exact:
checkpoint 583,202 in + 159,491 out = 742,693 tokens == proxy
(742,735 − 42 smoke ping). 29 anchored modules LLM-documented (stage 4,
561k tokens), 107 prose-tier auxiliary modules via the deterministic
compact zero-token contract, stage 5: 3 flows + 1 topic-plan (3 flow
candidates skipped on seed-key overlap, `flowMaxOverlap` working as
designed). Zero degraded pages. The 208 stale `changed` debt rows
dangled after the rewrite and were closed (`resolved_at`) with a
`debt_resolved` ×208 ledger entry; `status` now reports debt 0.

### 17. Viewer version stamp + source deep-links (PRE-BETA)

Source: CodeWiki review 2026-08-03 (Google's codewiki.google — hosted,
Gemini-generated; its strongest mechanic is pinning every code mention
to the generating commit). Maintainer decision 2026-08-03: pre-launch,
not post-beta. livewiki already versions the wiki in git; ship the
surface: the viewer stamps `Updated on / Commit <sha>` (one bounded git
call, freshness-badge discipline — no git ⇒ no stamp, never an error)
and renders per-anchor source links (local file offline; GitHub blob URL
when a remote is detected — optional surface, graceful degrade). Zero
LLM, no generation-contract change.

**Result (2026-08-03, implemented, uncommitted):** the chrome stamps
`Updated on <date> · Commit <short-sha>` under the brand from one bounded
`git log -1 --format=%H%n%cI -- livewiki/` probe (`probeWikiStamp` /
`parseWikiStamp`; git state only, any failure ⇒ no stamp). Source
deep-links are gated on BOTH a GitHub remote (`git remote get-url origin`
normalized by `normalizeGitHubRemote`, https/git@ forms) and the stamp
commit: a compact `Sources:` line after the page H1 (unique file paths
from the frontmatter `anchors:`, deduped and sorted, file-level blob
links) and each `<!-- lw:anchors ... -->` marker replaced with a
`source: <path>` blob link. All probes share the new `runGitCaptured`
bounded-spawn helper (shell:false, injectable); no remote ⇒ no links
(offline posture preserved). Shipped in `be9c8c4`; gate core 1631 /
CLI 125 / MCP 56; matrix green run 30784207402.

### 18. `livewiki view --ref <tag|sha>` (PRE-BETA)

Source: maintainer request 2026-08-03 — "version the wikis so the user
can compare 0.1 vs 0.2"; pre-launch per the same decision. Build the
site from `livewiki/` as it existed at any git ref via `git show`
(read-only, no checkout, working tree untouched). Two builds side by
side (e.g. `--out .livewiki/site-v0.1` vs current) give the real version
comparison; combined with item 17's stamp the user always knows which
version they are reading.

**Result (2026-08-03, implemented, uncommitted):** `livewiki view --ref
<tag|sha>` builds the site from the wiki as of the ref via a small
`WikiSource` abstraction (disk vs git-ref) inside `buildSite` — artifacts
enumerated with `git ls-tree -r --name-only <ref> -- livewiki/` (filtered
by the same canonical rules as the disk walker, exported as
`filterWikiArtifactPaths`) and read with `git show <ref>:<path>`; the
working tree is never touched. Freshness badges are off in ref mode (they
compare against the working-tree log); the item-17 stamp uses the ref's
own newest wiki commit and deep links use its sha. An unresolvable,
empty, or flag-like ref throws `ViewError("invalid_ref")` → CLI exit 1
with the git detail (human and JSON). Default output stays
`.livewiki/site/`; `--out` is the documented way to keep two versions
side by side. Shipped in `be9c8c4`; gate core 1631 / CLI 125 / MCP 56;
matrix green run 30784207402; smoke: `--ref HEAD~5` built 158 pages vs
62 current.

### 19. Tier-1 anchored support: Go (PRE-BETA) ✅ DONE 2026-08-03

Source: maintainer decision 2026-08-03 — tier-1 language expansion moves
from "usage-driven post-beta" to PRE-LAUNCH, starting with Go, Rust, and
Java (one item each). Per language: vendor/download the tree-sitter WASM
grammar (rule #4 one-time download exception), write the symbol extractor
in `symbols.ts` (function/class/method rules with the same anchor-quality
bar as TS/Python — this machinery is the anti-hallucination core, so
extraction fidelity is the acceptance bar), extend import resolution in
`modules.ts` (Go package paths), and add unit + stub-E2E coverage.
Pilot language: do Go FIRST to prove the extractor pattern before
replicating to Rust and Java. Validation: one `init --batch` acceptance
run on a real Go repo (paid, requires approval at execution time).

Result (implementation, 2026-08-03, uncommitted — coordinator reviews):
`tree-sitter-go.wasm` vendored in `packages/core/grammars/` (built with
tree-sitter-cli 0.26.10 + auto-downloaded wasi-sdk from tree-sitter-go
2346a3a; the `tree-sitter-wasms` npm build was rejected — legacy `dylink`
section, web-tree-sitter 0.26 requires `dylink.0`). `.go` mapped in
`parser.ts`/`walker.ts`. `symbols.ts`: `function_declaration` → function,
`method_declaration` → method keyed `path#Type.method` (pointer receivers
stripped: `*T` → `T`, value/pointer share the key), `type_declaration` →
`class` for `struct_type`, new `SymbolKind` `"interface"` for
`interface_type` (additive; class diagrams only match `class`; DB column
is free-text), local type declarations inside function bodies skipped
(same policy as local classes), grouped `type ( ... )` handled, aliases
to non-struct/iface types skipped. Calls: `call_expression` with bare
identifier → `extracted`, `selector_expression` field → `inferred`.
Rationales: tagged `comment` nodes work unchanged (Go has no docstrings).
Imports: `imports.ts` extracts `import_declaration`/`import_spec` (single,
grouped, aliased, blank, raw-string paths) as `go-import`;
`import-resolution.ts` gains `loadGoModulePath` (root `go.mod` module
directive) + `resolveGoSpecifier` — an import `<module>/<sub>` produces
one edge per direct `.go` file of directory `<sub>` (Go packages are
directories; nested dirs excluded, `_test.go` included); stdlib /
third-party / no-go.mod ⇒ external. Wired into batch.ts, init.ts,
status.ts (risk), change-impact.ts. Fixture `test/fixtures/sample-go-repo`
(go.mod + cmd/main.go + server/server.go). Tests: parser, walker,
symbols (10 Go), calls (6 Go), imports (3 Go), import-resolution (10 Go:
with/without go.mod, internal vs external, nested-dir exclusion, module
edges, loadGoModulePath), indexer fixture integration (tiers, key shapes,
calls, rationales). Existing prose-tier tests that used `.go` as the
grammar-less example switched to `.rb`/`.rs` (walker, indexer, CLI
prose-tier E2E). Gate: `pnpm -r build` clean; core 1668 / CLI 125 / MCP
56; live CLI smoke on the fixture: 7 symbols (3 functions, 1 class, 1
interface, 2 methods), `go: anchored` tier. **Acceptance run
(2026-08-03, approved paid):** `init --batch --no-refine` on
`spf13/cobra` (36 .go files) via MiniMax-M3 proxy — run #1 `completed`,
17 tasks done / 0 failed, exit 0, verify OK (21 pages, zero issues),
checkpoint 342,905 in + 98,129 out = 441,034 tokens == proxy
(441,076 − 42 smoke). Real Go anchors confirmed
(`command.go#Command.Execute`, `bash_completions.go#Command.GenBashCompletion`),
orientation pulls the real README purpose, 1 flow accepted / 3 skipped
on overlap. Clone preserved locally at `/c/tmp/cobra` (evidence, not
in the repo).

### 20. Tier-1 anchored support: Rust (PRE-BETA) ✅ DONE 2026-08-03

Same shape as item 19 (grammar + extractor + import resolution — Rust
`mod`/`use`/crate resolution) after the Go pilot proves the pattern.
Acceptance: batch run on a real Rust repo (paid, approved at the time).

Result (implementation, 2026-08-03, uncommitted — coordinator reviews):
`tree-sitter-rust.wasm` vendored in `packages/core/grammars/` (built with
tree-sitter-cli 0.26.10 + auto-downloaded wasi-sdk from tree-sitter-rust
77a3747; loads verified by parsing a probe file with web-tree-sitter
0.26.10 before vendoring). `.rs` mapped in `parser.ts`/`walker.ts`.
`symbols.ts`: `function_item` → function; inside an `impl_item` body →
method keyed `path#Type.name` for BOTH `impl T` and `impl Trait for T`
(decision: trait-impl members are callable on T, so they share the key
space; generic `impl<T> Vec<T>` keys under the base `Vec`, scoped
`impl a::B` under `B`); `struct_item` → `class`; `enum_item` → `class`
(least invasive — variants are not citable symbols); `trait_item` →
`interface` with member signatures NOT extracted (same policy as Go
interfaces); items inside function bodies skipped (local-class policy);
nested `fn` keeps the plain key (same as TS). Calls: `call_expression`
with bare identifier → `extracted`, `generic_function` (bare `foo::<T>()`)
→ `extracted`, `field_expression` (`x.m()`) and `scoped_identifier`
(`path::f()`, `Type::assoc()`) right-most name → `inferred`; macro
invocations (`println!`) are not call_expressions and are skipped.
Rationales: Rust comment nodes are `line_comment`/`block_comment` (added
alongside `comment`); `///` outer and `//!` inner doc comments (and `/**`
blocks) count as docstrings (≥20 normalized chars; `////` excluded);
tagged WHY/NOTE/HACK/TODO/FIXME comments work unchanged. One extractor
fix the Rust grammar forced: `line_comment` nodes INCLUDE the trailing
newline, so the positional attribution line range is clamped to a single
line. Imports: `imports.ts` extracts `use_declaration` as `rust-use`
(braces `use a::{b, c}` record the shared prefix `a`, aliases `as` record
the original path, wildcards drop `::*`, `pub use` identical) and
bodiless `mod foo;` as `rust-mod` (inline `mod { }` ignored).
`import-resolution.ts`: `loadRustCrateName` reads the root `Cargo.toml`
`[package] name` (comment-tolerant; null without it); resolution v1 —
`crate::` from the crate source root (`src/` when a known
`src/lib.rs`/`src/main.rs` exists, else repo root), `self::` relative to
the current file's module dir, one `super::` per module-dir climb, the
crate's own name (hyphens read as underscores — the integration-test
form) as a `crate::` alias; remaining segments resolve longest-prefix-
first against `<path>.rs` / `<path>/mod.rs`; `mod foo;` resolves under
the current file's module dir (stem dir for non-mod/main/lib files);
external crates (`std`, `core`, third-party) and unknown paths stay
external. Cargo workspaces (multi-crate) OUT OF SCOPE for v1. Wired into
batch.ts, init.ts, status.ts (risk), change-impact.ts. Fixture
`test/fixtures/sample-rust-repo` (Cargo.toml + src/{main,models,server}.rs).
Tests: parser (2), walker (1 new + grammar-less example moved .rs → .kt),
symbols (10 Rust extraction + 6 Rust rationales), calls (8 Rust), imports
(6 Rust), import-resolution (12 Rust + 4 loadRustCrateName), indexer
fixture integration (3: tiers/key shapes, calls+rationales). Prose-tier
tests that used `.rs` as the grammar-less example switched to `.rb`
(indexer) and `.kt` (walker, CLI prose-tier E2E). Also fixed a latent
defect exposed while validating: the committed Go fixture had picked up
a stale `.livewiki/` cache from the item-19 live smoke (gitignored,
invisible to git), which made its indexer test report `filesAdded: 0` —
cache deleted, Go test green again. Gate: `pnpm -r build` clean; core
1719 / CLI 125 / MCP 56; live CLI smoke on a fixture copy: 13 symbols
(4 functions, 3 classes, 5 methods, 1 interface), `rust: anchored`
tier. **Acceptance run (2026-08-03, approved paid):** `init --batch
--no-refine` on `ajeetdsouza/zoxide` (25 .rs files) via MiniMax-M3
proxy — run #1 `completed`, 15 tasks done / 0 failed, exit 0, verify
OK (19 pages, zero issues), checkpoint 148,633 tokens == proxy
EXACTLY (no smoke ping this run). Real Rust anchors confirmed
(`src/db/dir.rs#Dir`, `#Dir.score`, `#DirDisplay.fmt` — impl method
keys live). Clone preserved locally at `/c/tmp/zoxide` (evidence, not
in the repo).

### 21. Tier-1 anchored support: Java (PRE-BETA) ✅ DONE 2026-08-03

Same shape as item 19 (grammar + extractor + package/import resolution)
after the Go pilot. Acceptance: batch run on a real Java repo (paid,
approved at the time).

Result (implementation, 2026-08-03, uncommitted — coordinator reviews;
gate numbers filled: `pnpm -r build` clean, core 1758 / CLI 124+1
EBUSY load-flake (isolated 21/21 + 5/5 green) / MCP 56; smoke on a
fixture copy: 16 symbols — 4 class / 1 interface / 11 method,
`java (anchored)` tier): `tree-sitter-java.wasm`
vendored in `packages/core/grammars/` (built with tree-sitter-cli
0.26.10 + auto-downloaded wasi-sdk from tree-sitter-java e10607b; loads
verified by parsing a probe file with web-tree-sitter 0.26.10 before
vendoring). `.java` mapped in `parser.ts`/`walker.ts`. `symbols.ts`:
`class_declaration` → `class` via the EXISTING shared TS case (same node
type name); `interface_declaration` → `interface`; `enum_declaration` and
`record_declaration` → `class` (mirrors the Rust enum decision — named
data types; constants/components are not citable); `method_declaration` →
method keyed `path#Type.name` under the innermost enclosing type (one
shared case with Go: qualifier = `receiver ?? parentClassName` — Go's
node always has a receiver, Java's never does); interface member
signatures ARE extracted as `Interface.name` (documented delta from the
Go/Rust no-signatures policy — Java interfaces carry default/static
bodies and their members are the callable surface); the
interface/enum/record cases are GATED to `.java` — TypeScript shares the
`interface_declaration`/`enum_declaration` node type names and TS
interfaces/enums were never extracted before item 21 (a scope leak
caught in self-review, closed with a guard test);
`constructor_declaration` → method keyed `Type.Type`; local classes
inside method bodies skipped (existing local-class policy);
`annotation_type_declaration` not extracted v1. Calls: `method_invocation`
confidence from the PRESENCE of the `object` field — bare `m()` →
`extracted`, `x.m()`/`Type.m()`/`a.b.m()`/`this.m()` → `inferred`;
`object_creation_expression` (`new X()`, scoped `new a.b.C()`, generic
`new ArrayList<String>()`) → always `extracted` with the right-most
type_identifier as the callee (same policy as TS `new_expression`).
Rationales: Java uses the `line_comment`/`block_comment` nodes added for
Rust; Javadoc `/** */` counts as a docstring via the shared TS branch
(≥20 normalized chars); tagged comments unchanged. One behavior worth
noting: Javadoc above a method attributes to the ENCLOSING CLASS (rule 1
of the pinned positional-attribution contract — the comment sits inside
the class's line range; same as TS, regression-tested).
Imports: `imports.ts` extracts `import_declaration` as `java-import`
(shares the Go node type — disambiguated by child shapes:
`import_spec`/`import_spec_list` = Go, `scoped_identifier`/`identifier` =
Java); plain/static/wildcard forms all record the full dotted path (the
wildcard's `*` is a separate asterisk child; a static import's member
stays in the path). `import-resolution.ts`: NO loader — a Java package
IS a directory, so pom.xml/gradle parsing is out of scope v1 and the
five `resolveImportEdges` call sites stay untouched (Java differs from
Go/Rust precisely here: their manifests name modules by string, Java's
dotted path is already a repo-relative directory path). Resolution v1:
the FIRST candidate source root containing a known `.java` file wins
(`src/main/java`, then `src/`, then the repo root); under it the LONGEST
segment prefix naming a directory that directly holds `.java` files is
the target package (drops the plain import's type name, the static
import's member, matches the wildcard's package through one walk); the
edge targets that package's direct `.java` files (non-recursive);
`java.*`/`javax.*`/unknown packages stay external. Fixture
`test/fixtures/sample-java-repo` (Maven layout:
src/main/java/com/fixture/{Main,server/{Server,Handler,Mode},model/Item}.java).
Tests: parser (2), walker (1 new + grammar-less example dropped `.java`,
now `.kt`/`.rb`/`.zig`), symbols (8 Java extraction + 5 Java rationales),
calls (7 Java), imports (4 Java), import-resolution (9 Java), indexer
fixture integration (3: tiers/key shapes, calls+rationales). **Acceptance
run (2026-08-03, approved paid):** `init --batch --no-refine` on
`google/gson` main module (210 .java files) via MiniMax-M3 proxy — run
`completed_with_failures` (71 done / 1 flow repair_exhausted: the model
kept omitting the required lw:anchors marker in the "Ordered flow"
section, same model-residual class as Etapa 3) then ONE disclosed
`--only` retry on the failed flow → run #1 `completed`, 72/72 done, 0
failed, exit 0, verify OK (76 pages, zero issues). Accounting:
1,343,614 in + 533,034 out = 1,876,648 tokens == proxy EXACTLY
(1,852,822 + 23,826 retry). Java anchors live incl. constructor and
nested-type keys (`Gson.java#Gson.Gson`, `TypeAdapter.java#TypeAdapter.read`,
`#NullSafeTypeAdapter.read`, `TypeToken.java#TypeToken`). Clone
preserved locally at `/c/tmp/gson` (evidence, not in the repo). The
no-recovery autonomous bar was NOT met (one disclosed retry) — same
standing caveat as previous acceptances.

### 22. CodeWiki-grade output format (PRE-BETA) ✅ DONE 2026-08-03 (A/B passed, defaults ON)

Source: CodeWiki review 2026-08-03 — the maintainer's first reaction to
Google's codewiki.google was "o wiki final está muito bom; a formatação
está excelente". **Maintainer decision 2026-08-03: promoted from
post-beta to PRE-BETA (after #23, before publish).** Two gaps vs our
corpus, both generation-contract
changes (LLM prompts + artifact validation + repair contract, so NOT
free like #17): (a) **one Mermaid diagram per section** — CodeWiki
opens every H2/H3 section with a diagram; our pages have diagrams only
for flows and class inventories; (b) **deeper concept hierarchy** —
their pages run H2 sections with H3 subsections (e.g. "Building MCP
Servers" → "Advanced OAuth 2.0 Implementation"); our module pages are
flatter. Design questions before implementation: diagram budget per
page (stage-5 flow budgets are the precedent), diagram validity gate
(mermaid-validator already exists), and whether this ships as a page-
kind variant or a prompt-contract revision. Evaluate on the A/B harness
before adopting — CodeWiki's static text quality was impressive but
unmeasured against our corpus.

**Result (implementation, 2026-08-03 — gate: `pnpm -r build` clean,
core 1814 / CLI 125 / MCP 56):** implemented as a prompt-contract REVISION on the
existing module page kind behind two config flags, both default off (D3 —
flags off is byte-identical pre-#22 behavior, proven by the full
deterministic suite). `moduleDiagrams` (D1/D2 hard contract): ONE diagram
per module page (not per section) reusing the stage-5 flow machinery — the
model emits the diagram INLINE in a new `## Diagram` section after `How it
fits`, the orchestrator extracts it to `livewiki/diagrams/<slug>.mmd`, and
the page keeps only the exact `%% livewiki/diagrams/<slug>.mmd` placeholder;
page + diagram land in ONE transactional write (flow dual-artifact
pattern), gated by `validateMermaidSyntax` and the reused
`flowMaxDiagramNodes`/`flowMaxDiagramEdges` budgets. Naming: model-drawn
module diagram `<slug>.mmd`; deterministic class diagram stays
`<slug>.classes.mmd`; flow diagrams keep `flow-<slug>.mmd`. Validation: new
`Stage4ValidationContext.expectedModuleDiagram` placeholder check with the
new `module_diagram_placeholder` code; `invalid_flow_diagram` /
`flow_diagram_too_large` move from report-only to supported module fixes
(the module gate is LIVE — the model draws the diagram); every new/changed
code classified in `repair-contract.ts` (exhaustiveness test green).
`deepHierarchy` (D2 soft contract): prompt guidance only — ≥ 8 symbols ⇒
concept-named H2 sections with H3 symbol subsections; no new validation
code. Tests: `module-diagram-format.test.ts` (20 unit) +
`batch-module-diagrams.test.ts` (4 stub E2E: extraction, placeholder, valid
mermaid, verify zero, repair ACTION directive, monotonic `--only` rerun,
flags-off byte-identical) + config key validation. The A/B acceptance
evaluation comes later per D3 — not in this pass.

**Acceptance A/B + default flip (2026-08-03, maintainer decision):** the A/B
passed — 18/18 tasks completed, 14/14 diagrams valid, +11% tokens — so BOTH
flags now default to `true` in `CONFIG_DEFAULTS`. Batch fixtures exercising
the pre-#22 stage-4 contract pin `moduleDiagrams: false` /
`deepHierarchy: false` explicitly (config.json or BatchOptions) with a
pointer comment; the #22-on suites (`module-diagram-format.test.ts`,
`batch-module-diagrams.test.ts`) are unchanged and still test flags ON.
Gate after the flip: full core suite 1814 passed / 14 skipped, CLI 125,
build clean.

### 23. Repository understanding layer (PRE-BETA) ✅ DONE 2026-08-03

Source: maintainer 2026-08-03 — the quickstart orientation proved the
gap on this very repo: with no README, the deterministic fallback
synthesized a module enumeration, not a purpose ("organized around Core
Repair, Status…"). Broader than a no-README patch: **the README is one
evidence input, never the authority** — a bad README ("porcaria") must
not poison the orientation either. Design: batch stage 5 gains ONE
bounded task (same machinery as flows/topics) that synthesizes the
**repository understanding** — what the repo is, for whom, key surfaces
— from the closed evidence inventory (accepted module pages, flows,
topics, entry points, README when present). Everything it may claim is
already verify-gated, so the synthesis inherits the anti-hallucination
contract. Orientation rules: synthesis is the primary `## What this
repository is` content with provenance marking; README purpose becomes
provenance-marked evidence inside it. `export readme` uses the
synthesis as its purpose paragraph; the refuse-to-overwrite-human-README
contract (rule #6) is unchanged — the wiki is where the understanding
lives. Cost: one LLM call per batch, always — detection stays zero-token,
writing stays minimal. Acceptance: on a no-README repo AND on a
bad-README repo, the quickstart states the product's purpose correctly
without human edits.

Result (implementation, 2026-08-03 — uncommitted): implemented as stage
5c. ONE bounded `understanding:<evidenceHash>` task after topics
(`runUnderstandingStage` in `batch.ts`) synthesizes
`livewiki/understanding.md` from the closed inventory (accepted module
digests, flows, topics, entry surfaces, README purpose). Persistence form:
option (a) — a real wiki page, read back by the deterministic quickstart
regeneration exactly like module digests (rule #3 stays clean). The
artifact carries no anchors and follows a dedicated strict contract in the
new `packages/core/src/understanding.ts` (single 40–600-char purpose
paragraph, optional ≤10-bullet `Key surfaces`, no code spans/links/TODO);
deliberately NO new `ArtifactPageKind`/`ArtifactValidationCode` (the Etapa
2a exhaustiveness test pins both) and no surgical/relaxed round (the
artifact is one paragraph). Checkpoint reuse on unchanged evidence ⇒ zero
LLM calls; `--only understanding` reruns; ownership mirrors topics
(`refused_owned_understanding`); `understandingSynthesis` config (default
true). Quickstart priority: synthesis (provenance-marked, README quoted
as evidence) → README purpose → digest fallback, byte-exact without a
synthesis; `export readme` prefers the synthesis. Tests:
`understanding.test.ts` (12), `batch-understanding.test.ts` (7, stub
LLM), plus blocks in `navigation.test.ts` and `readme-export.test.ts`.
Gate: `pnpm -r build` clean; core 1783 / CLI 125 / MCP 56. **Acceptance
(2026-08-03, approved paid):** batch on a no-README zoxide copy — the
quickstart opened with a correct synthesized purpose (provenance:
"Synthesized from the verified wiki pages") with zero human edits;
then a sabotaged README (badges + lorem) was added and a free `init`
regen kept the synthesis primary, demoting the junk README to a quoted
evidence line ("one evidence input, not the authority"). Both design
cases PASS. Run: 16 tasks done / 0 failed, exit 0, verify OK (20
pages), checkpoint 116,975 + 35,855 = 152,830 tokens == proxy EXACTLY.

## Evaluated and rejected (do not re-litigate without new evidence)

- **Committed graph/cache artifact in the repo** (their
  `.codebase-memory/graph.db.zst` pattern): violates rule #3 — `.livewiki/`
  is a derived cache and never travels in git (`init` enforces this via
  `.gitignore`). livewiki's shared artifact is the wiki itself: reviewable
  text, not a binary database.
- **Semantic search with bundled embeddings**: adds a model, weight, and
  nondeterminism to a product whose promise is deterministic validation.
  FTS5 + anchors covers the agent use case.
- **General-purpose call graph / dead code / cross-service graph database /
  Cypher queries**: broader than livewiki's documentation mission. Reproduce
  only the documentation-focused impact and context patterns natively; never
  require an external graph or MCP product to complete the livewiki workflow.
- **Runtime dependency on GitHub Agentic Workflows, codebase-memory-mcp,
  CodeGraph, or any equivalent product**: rejected. References may inform the
  design, but the shipped capability belongs to livewiki and works without the
  reference product installed or configured.
- **Built-in ADR management**: `owner: human` pages already provide the
  mechanism; at most a page template someday, not a feature.
