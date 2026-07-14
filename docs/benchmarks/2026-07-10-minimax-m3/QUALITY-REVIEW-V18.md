# Independent quality review — livewiki clean v18 vs frozen OpenWiki

**Review mode:** offline and read-only. No API call, OpenWiki rerun, product change, commit, or push was performed. The only new artifact is this review.

## Corpus caveat: this is not a page-by-page comparison

The two tools documented different source snapshots:

- OpenWiki documented a temporary-repository commit `02436b0`, recorded as a snapshot of livewiki `04d6198c8844a1f402a41ee4f9da1553494ba0d9`.
- livewiki clean v18 documented `572b8a3d0fa6f075f2bd51e84a10d543764f372b`.

This is therefore a **tool-vs-tool comparison on each tool's respective snapshot**, not a page-by-page diff and not a controlled same-commit A/B test. The snapshot gap materially affects currentness, module inventory, phase status, tests, configuration, retry behavior, and some architecture claims. Factual checks below use `git show`/`git grep` against the snapshot relevant to each corpus. Any conclusion about coverage or currentness is limited accordingly.

The evidence is adequate for a narrow, qualified comparison of these two preserved runs. It is not adequate for a general claim that either tool always produces better documentation.

## Evidence and method

Reviewed inputs:

- v18 corpus: `rerun-clean-v18/livewiki/`
- v18 execution evidence: `rerun-clean-v18/metrics/` and `rerun-clean-v18/notes.md`
- frozen OpenWiki corpus: `raw/openwiki/`
- OpenWiki execution evidence: `raw/metrics/openwiki.json`, the ignored-but-preserved `raw/metrics/openwiki-run.log`, and `raw/metrics/openwiki-proxy.log`
- source snapshots: `572b8a3` for livewiki claims and `04d6198` for OpenWiki claims

I inventoried every page, checked Markdown link targets, sampled fragment links, inspected the v18 verifier and batch reports, and selected eight adversarial factual claims from each side. The samples emphasize error handling, exit codes, configuration, security boundaries, and operational guarantees rather than pages praised in the run notes. This is a structured sample, not an exhaustive fact check.

## 1. Completion

### livewiki clean v18

The run finished completely:

- `metrics/batch-status.json` records run status `completed`, 13 tasks done, 0 failed, and 0 pending.
- The preserved corpus contains all 13 planned module pages, plus `quickstart.md` and `architecture/overview.md`: 15 Markdown pages in total. Deterministic Mermaid files are also present.
- The corrected acceptance evidence records 427/427 closed keys covered.
- `metrics/verify.json` is `{"ok":true,"pagesChecked":15,"issues":[]}`. Thus the full on-disk corpus had zero verifier issues of any severity.
- Spot-check: `quickstart.md:7-9` links to `architecture/overview.md#core-src-02`, `#core-src-03`, and `#core-src-04`; the corresponding explicit HTML IDs exist at overview lines 16, 22, and 28.

This is strong completion evidence: the planned inventory, generated pages, anchor coverage, and independent post-run verification agree.

### OpenWiki frozen baseline

OpenWiki also finished its process: `raw/metrics/openwiki-run.log:26` reports `elapsed: 819.4s exit=0`. The frozen output contains 11 Markdown pages: one quickstart and ten topic pages. The run log says the quickstart links every other page and that `_plan.md` was removed; the files support that statement.

Manual link inspection found:

- 45 links targeting files within the frozen OpenWiki corpus, with no missing targets.
- Three links from `operations/development-workflow.md` leave the preserved corpus for repository-level `VISION.md` and `SPEC.md`; those targets existed at `04d6198`, including the referenced SPEC heading, but the raw corpus is not self-contained for those links.

What cannot be established is **full source-module coverage**. No preserved module plan, closed-key inventory, or verifier report maps the 11 narrative pages to every source file or symbol at `04d6198`. Exit 0 establishes process completion, not exhaustive documentation coverage. No page is visibly truncated or left as TODO/TBD filler, but absence of missing topics is not machine-verifiable from the baseline evidence.

**Completion finding:** livewiki is better evidenced and more complete for its own snapshot. OpenWiki completed a coherent narrative corpus, but exhaustive module coverage is unverified.

## 2. Factual quality: symmetric source checks

### livewiki v18 — eight sampled claims against `572b8a3`

| # | Generated claim | Finding | Source check |
|---|---|---|---|
| L1 | “`setExitCode` maps ... `completed` → `0`, `completed_with_failures` → `1`, `aborted` → `2`. When `--json` is used, exit code is left at `0`.” (`commands.md:58`) | **CORRECT** | `572b8a3:packages/cli/src/commands/batch.ts:300-306` returns immediately for JSON and assigns exactly those three codes. |
| L2 | `CONFIG_DEFAULTS` includes language `en`, five default languages, two repair attempts, two incomplete retries, 8192 output tokens, 12/80 split thresholds, and a 300,000 ms timeout. (`core-src-02.md:145`) | **CORRECT** | `572b8a3:packages/core/src/config.ts:145-170` contains those values; `applyDefaults` merges them without mutating the input. |
| L3 | “`refinePeerDirectoryFragmentationError(...)` takes a candidate `ExactPartitionError` and refines its message...” (`core-src-03.md:210`) | **INCORRECT** | `572b8a3:packages/core/src/modules.ts:554-564` declares `refinePeerDirectoryFragmentationError(modules: Module[]): string \| null`. It scans modules directly; it does not accept an `ExactPartitionError`. Exact-partition validation is a separate operation. |
| L4 | `requestWithRetry` defaults to three attempts, retries 429/5xx and plain network failures with exponential backoff, and converts `AbortError` to a timeout error without retry. (`llm.md:53`) | **CORRECT** | `572b8a3:packages/core/src/llm/base.ts:63-65,91-145` implements those status, timeout, and retry branches. |
| L5 | Safe I/O restricts normal operations to `livewiki/` and `.livewiki/`, admits pointer files only by opt-in, and revalidates canonicalized paths after symlink resolution. (`core-src-04.md:184-204`) | **CORRECT** | `572b8a3:packages/core/src/safe-io.ts:29-30,65-68,95-115,196-225` defines the allowlist, pointer exception, prefix check, realpath reconstruction, and final recheck. |
| L6 | `livewiki_write_doc` writes through safe I/O, verifies the page, rolls back on an error-level issue, supports `skipVerify`, and indexes a successful write. (`mcp-src.md:49`) | **CORRECT, BUT INCOMPLETE** | The stated normal flow is in `572b8a3:packages/mcp/src/server.ts:182-241`. However, lines 231-236 keep the written file and return a “wrote ... verify step crashed” result if verification itself throws. The page omits this fail-open exception, which matters to its security narrative. |
| L7 | `recordUpdateMetric` reads, appends, writes, and swallows errors so metrics cannot block update. (`core-src-04.md:247`) | **CORRECT** | `572b8a3:packages/core/src/update-metrics.ts:89-99` performs the operation inside a catch-all `try`/`catch`. |
| L8 | `livewiki serve` is currently a Phase-0 stub built with `makeStubAction`. (`commands.md:113`) | **CORRECT** | `572b8a3:packages/cli/src/commands/serve.ts:8-12` registers exactly that stub, despite the separate MCP package being implemented. |

Sample result: **7 correct, 1 incorrect**. One of the correct claims is materially incomplete because it omits the verifier-crash branch.

### OpenWiki — eight sampled claims against `04d6198`

| # | Generated claim | Finding | Source check |
|---|---|---|---|
| O1 | “Coverage must be 100% ... (`< 80%` is rejected).” (`workflows/batch-pipeline.md:33`) | **INCORRECT** | `04d6198:packages/core/src/batch.ts:734-742` rejects only when `coverage < 0.8` and says “need ≥80%.” The code accepted 80%-99.99% coverage. |
| O2 | The manifest is versioned JSON at `.livewiki/.manifest.json`. (`architecture/data-model.md:3,89`) | **INCORRECT AND INTERNALLY CONTRADICTORY** | `04d6198:packages/core/src/manifest.ts:26` defines `livewiki/.manifest.json`. The same generated page corrects itself at line 105, so readers receive two incompatible paths. |
| O3 | `OpenAiCompatAdapter` is used by “MiniMax (via Gemini).” (`integrations/llm-providers.md:53`) | **INCORRECT** | `04d6198:packages/core/src/presets.ts:163-180` configures MiniMax with the Anthropic adapter. Gemini is a separate openai-compatible preset at lines 182-191. |
| O4 | The API key is read from `process.env[resolved.envVar]`, never from config, and missing provider/model configuration fails rather than choosing a model fallback. (`integrations/llm-providers.md:118-122`) | **CORRECT** | `04d6198:packages/core/src/llm/index.ts:54-65` validates config and reads the resolved environment variable; `config.ts:85-100,169-175` raises `MissingProviderConfigError` for absent required fields. |
| O5 | “Verify-after-write is mandatory ... if `write_doc` succeeds, the page passes `verify`.” (`integrations/mcp-server.md:91`) | **INCORRECT** | `04d6198:packages/mcp/src/server.ts:207-229` rolls back reported page errors, but lines 231-236 keep the file and return “wrote ...” if verify throws. Success therefore does not guarantee a passed verify. |
| O6 | The post-commit hook never blocks the commit and exits 0 even if livewiki fails. (`workflows/incremental-update.md:45`) | **CORRECT** | `04d6198:packages/cli/templates/git/post-commit:26-28,43-48,65-66` uses `set +e` and explicit `exit 0` paths. |
| O7 | Default ignored directories include `.git`, `node_modules`, `.livewiki`, `dist`, and `coverage`, and symlinks are not followed. (`workflows/indexing-and-debt.md:51-54`) | **CORRECT** | `04d6198:packages/core/src/walker.ts:54-62` adds those defaults; lines 116-125 process only real directories/files and skip symlinks. |
| O8 | Native `fetch` honors `HTTP_PROXY` / `HTTPS_PROXY` “for most proxies.” (`integrations/llm-providers.md:167`) | **UNVERIFIABLE FROM THE REPOSITORY** | `04d6198:packages/core/src/llm/base.ts:21-22,46-61` merely selects `globalThis.fetch` and supplies no proxy agent or dispatcher. The repository does not establish the claimed environment behavior; it depends on the external Node runtime and configuration. |

Sample result: **3 correct, 4 incorrect, 1 unverifiable**.

### Factual-quality assessment

The v18 sample is stronger, but neither corpus is error-free. livewiki's one clear error misstates a helper's API and data flow. OpenWiki's errors include an acceptance threshold, a persisted path, a provider adapter, and an absolute MCP safety guarantee. These are operational facts an agent could act on, not merely stylistic imprecision.

The snapshot caveat remains important: this result compares each corpus with its own code, not whether OpenWiki describes the newer v18 feature set.

## 3. Structure, navigability, duplication, and traceability

### livewiki

Strengths:

- Every module page has a closed list of source keys and section-level `lw:anchors`. The full corpus has 427/427 key coverage and passed the verifier.
- The architecture overview is a dependable generated index: its page and diagram links resolve, and explicit IDs avoid renderer-dependent fragments.
- File and symbol names are dense enough for code surgery. A reader can move from a statement to a specific implementation surface quickly.

Weaknesses:

- The information architecture is mostly implementation-shaped (`core-src-01` through `core-src-05`, `cli-src`, `mcp-src`) rather than task-shaped. Those names are stable machine IDs but weak human labels.
- `quickstart.md` is only 127 token-like words and exposes three “important modules”; it is not a true onboarding guide to the product or its workflows.
- The 13 module pages contain almost no editorial cross-linking among themselves. Most of the corpus's 25 Markdown links are concentrated in the deterministic architecture overview.
- Pages are dense and repetitive: source coverage list, anchors, API inventory, then prose. This is useful for retrieval but tiring for sequential reading.
- Benchmark tooling, a one-file offline inventory script, and two fixture modules receive first-class pages. That proves inventory coverage but dilutes the product narrative.

### OpenWiki

Strengths:

- The corpus is organized around architecture, workflows, integrations, and operations. Its quickstart links all ten topic pages and gives an effective “where next” path.
- There are 48 Markdown links in 11 pages (45 within the corpus), and topic pages regularly direct readers to related concepts.
- Headings are more granular: the corpus has roughly 144 headings versus 114 in the larger livewiki corpus. It is easier to skim by task or concern.
- The baseline is more editorially focused: fixtures and benchmark mechanics do not crowd the primary navigation.

Weaknesses:

- File paths and symbol names appear as prose, not verifiable anchors. A claim can sound precise while pointing to the wrong path, as the manifest error demonstrates.
- Rules and phase summaries recur across quickstart, architecture, operations, and workflow pages. Some repetition is useful orientation; some creates drift opportunities.
- Three links depend on files outside the preserved corpus.
- There is no machine equivalent of `livewiki verify`, so manual link success does not establish factual or symbol integrity.

**Structure finding:** OpenWiki is better for human onboarding and navigability in this sample. livewiki is better for machine-verifiable symbol/file traceability. Treating either strength as the whole of “documentation quality” would be misleading.

## 4. Side effects

The benchmark runbook states that the OpenWiki baseline modified `AGENTS.md` and created `.github/` in its target. The preserved evidence only partly permits independent verification:

- `git ls-tree 04d6198 -- .github` is empty, while `raw/metrics/openwiki-run.log:23` and `raw/openwiki/quickstart.md:27` describe `.github/workflows/openwiki-update.yml` as an actual workflow in the target. That strongly corroborates creation of `.github/` during the OpenWiki run.
- The frozen `raw/openwiki/` copy contains neither `.github/` nor `AGENTS.md`; it preserves only OpenWiki's wiki output and `.last-update.json`. The claimed `AGENTS.md` mutation has no before/after artifact here and is **not independently content-verifiable** from the immutable baseline. The runbook remains the provenance statement for it.

For livewiki v18, batch stdout lists generated outputs under `livewiki/`; configuration and databases used by the run are under `.livewiki/`. The preserved generated corpus is under `livewiki/`, and no evidence artifact reports a write to `AGENTS.md`, `.github/`, source, or product documentation. This is consistent with the product's safe-I/O allowlist. It is not an operating-system syscall trace, so it supports—but cannot absolutely prove—the absence of every unrecorded write.

**Side-effect finding:** livewiki is better on the available evidence. Its observed writes remained within its declared derived/generated roots; OpenWiki created at least a workflow outside its wiki tree, and its claimed AGENTS mutation is an evidence-preservation gap.

## 5. Time, calls, retries, and tokens

| Metric | livewiki clean v18 | OpenWiki frozen baseline |
|---|---:|---:|
| Wall clock | 538.5 s | 819.4 s |
| Paid calls / attempts | 16 | 157 |
| Prompt tokens | 217,785 | 13,668,064 |
| Completion tokens | 35,228 | 38,724 |
| Total tokens | 253,013 | 13,706,788 |
| Cached prompt tokens | 42,212, included in prompt total | Not reported separately |
| Reasoning tokens | 0 | Not reported separately |
| Calls without usage | 0 | 0 |

The livewiki total is the honest wire total, including overhead:

- 13 planned stage-4 tasks required 16 calls.
- `core-src-01` used three calls: two provider-abort incomplete generations marked `budgetConsumed:false`, then success.
- `core-src-05` used an initial artifact-invalid call and one successful repair.
- The other 11 module tasks succeeded on their initial calls.
- Stage 2 was disabled by `--no-refine` and consumed zero tokens.

The batch report and proxy reconcile exactly at 217,785 prompt and 35,228 completion tokens. The proxy also records 0 errors and 0 calls without usage.

OpenWiki's proxy log has one header plus 157 call lines; its final cumulative total agrees with `openwiki.json`. It records no cached-token or reasoning-token fields, so neither category may honestly be inferred as zero. OpenWiki's prompt context grew from 14,458 tokens on call 1 to 137,283 on call 157.

For these runs, OpenWiki used approximately **54.17×** as many total tokens, **62.76×** as many prompt tokens, and **9.81×** as many calls. Completion tokens were only **1.10×** livewiki's, showing that the difference is overwhelmingly prompt/context overhead rather than final output volume. livewiki finished 280.9 seconds sooner, or 34.3% below OpenWiki's elapsed time.

These numbers are descriptive, not a controlled efficiency proof: the generators use different orchestration strategies and document different snapshots. Even with that limitation, the preserved-run accounting decisively favors livewiki for measured token and call efficiency.

## 6. livewiki weaknesses found

1. **A concrete API/data-flow hallucination:** `core-src-03.md` says `refinePeerDirectoryFragmentationError` takes an `ExactPartitionError`; it actually takes `Module[]`.
2. **A missing safety caveat:** `mcp-src.md` describes rollback on verifier issues but omits that a verifier exception leaves the write in place and returns a “wrote” message.
3. **Weak onboarding:** the quickstart is an index fragment, not a product/workflow introduction.
4. **Machine-shaped navigation:** numbered core-module slugs are poor human concepts, and module pages contain little cross-linking.
5. **Coverage can reduce focus:** fixtures, benchmark tools, and a one-file script are elevated alongside product modules.
6. **Generation was not one-call-per-page:** two provider aborts and one repair increased v18 from 13 to 16 paid calls; the 253,013-token total correctly includes them.
7. **Evaluation provenance needed correction:** v18's initially preserved qualitative gate applied a noncompliant raw `process.exit` rule and was corrected post-run. The corrected evidence is explicit, but the incident shows that benchmark-evaluator semantics are a fragile part of the evidence chain.

## 7. OpenWiki strengths and weaknesses found

Significant strengths:

1. The architecture/workflows/integrations/operations hierarchy is substantially easier to browse than numbered implementation modules.
2. The quickstart is a genuine entry point and links every other topic page.
3. Several adversarial operational claims were accurate, including API-key environment handling, the non-blocking hook, and walker/symlink behavior.

Significant weaknesses:

1. Four of eight sampled claims were wrong against OpenWiki's own source snapshot: refine coverage, manifest path, MiniMax adapter, and the absolute write-doc verification guarantee.
2. There is no closed-key plan or verifier, so full source coverage and symbol integrity cannot be demonstrated.
3. The run required 157 calls and 13.7 million tokens, mostly repeated/growing prompt context.
4. The baseline has side effects outside its wiki directory; `.github/` creation is corroborated, while the claimed `AGENTS.md` mutation was not preserved for direct review.
5. The corpus is not fully self-contained: three documentation links depend on repository files outside `raw/openwiki/`.

## 8. Per-dimension verdict

| Dimension | Verdict | One-line justification |
|---|---|---|
| Snapshot/currentness | **Not comparable** | The corpora document `04d6198` and `572b8a3`; feature/currentness differences cannot be attributed to the tools. |
| Process completion | **Tie** | Both processes exited successfully and produced coherent corpora. |
| Demonstrated corpus completeness | **livewiki better** | v18 has 13/13 tasks, 427/427 keys, 15/15 pages verified, and zero issues; OpenWiki has no preserved exhaustive plan or verifier. |
| Sampled factual accuracy | **livewiki better** | v18 scored 7 correct / 1 incorrect; OpenWiki scored 3 correct / 4 incorrect / 1 unverifiable against their respective snapshots. |
| Human structure and navigability | **OpenWiki better** | Its task-oriented hierarchy, substantive quickstart, and dense cross-linking outperform livewiki's flat numbered modules. |
| Symbol/file traceability | **livewiki better** | Closed keys, section markers, deterministic overview links, and full-corpus verify provide stronger traceability. |
| Editorial focus / redundancy | **OpenWiki better** | OpenWiki is more curated around product concerns; livewiki's exhaustive fixture/tool coverage and repeated page template add noise. |
| Link integrity | **livewiki better** | Both had no missing inspected internal targets, but livewiki also machine-verified all 15 pages and anchors; OpenWiki required manual checking. |
| Side-effect containment | **livewiki better** | v18 evidence stays within `livewiki/` and `.livewiki/`; OpenWiki created an external workflow and has an unpreserved AGENTS mutation claim. |
| Wall-clock time | **livewiki better** | 538.5 seconds versus 819.4 seconds in the preserved runs. |
| Token/call efficiency | **livewiki better** | 253,013 tokens / 16 calls including retries and repair, versus 13,706,788 / 157. |
| Reasoning-token comparison | **Not comparable** | v18 records zero; the OpenWiki metric does not expose reasoning tokens separately. |

## Overall assessment and publication threshold

The passing v18 run closes the earlier completion problem: it produced a fully planned, fully anchored, mechanically clean corpus with exact wire accounting. In the symmetric factual sample it also made fewer errors than the frozen OpenWiki baseline, while using far fewer calls and tokens. Those are meaningful results.

OpenWiki nevertheless produced the better human-oriented information architecture. Its quickstart and task-based hierarchy are more useful for onboarding than livewiki's numbered module map. livewiki's traceability advantage does not erase that editorial weakness, and v18 still contains one clear factual error plus an omitted MCP failure-mode caveat.

I consider the evidence **sufficient for the maintainer to publish a carefully qualified comparison note about these two preserved runs**, provided it states the different source snapshots, reports livewiki's retry/repair overhead, distinguishes machine traceability from human navigability, and mentions the factual sample rather than implying exhaustive correctness. The evidence is **not sufficient** for a universal “winner” claim, a same-commit quality claim, or a claim that livewiki is better on every documentation dimension.
