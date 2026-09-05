---
title: LLM Prompt Templates for Livewiki's Documentation Pipeline
owner: generated
anchors:
  - packages/core/src/prompts.ts#BRANCH_PRECISION_PROMPT_RULE
  - packages/core/src/prompts.ts#DEEP_HIERARCHY_PROMPT_RULE
  - packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE
  - packages/core/src/prompts.ts#FILE_NARRATIVE_PROMPT_RULES
  - packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET
  - packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#FOLDER_PURPOSE_PROMPT_RULES
  - packages/core/src/prompts.ts#INVENTORY_AUTHORITY_PROMPT_RULE
  - packages/core/src/prompts.ts#LAY_READER_PROMPT_RULE
  - packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE
  - packages/core/src/prompts.ts#NO_REASONING_WRAPPER_PROMPT_RULE
  - packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES
  - packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#UNDERSTANDING_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#WRITE_FOR_UNDERSTANDING_PROMPT_RULE
  - packages/core/src/prompts.ts#boundEncodeLongRuns
  - packages/core/src/prompts.ts#buildFileOpeningPrompt
  - packages/core/src/prompts.ts#buildFilePlanPrompt
  - packages/core/src/prompts.ts#buildFileSectionPrompt
  - packages/core/src/prompts.ts#buildFlowGroupBlock
  - packages/core/src/prompts.ts#buildFlowSectionAssignmentBlock
  - packages/core/src/prompts.ts#buildFolderPurposePrompt
  - packages/core/src/prompts.ts#buildFolderPurposeRepairPrompt
  - packages/core/src/prompts.ts#buildModuleDiagramPromptRules
  - packages/core/src/prompts.ts#buildRepairPrompt
  - packages/core/src/prompts.ts#buildStage4Prompt
  - packages/core/src/prompts.ts#buildStage5Prompt
  - packages/core/src/prompts.ts#buildStage5RepairPrompt
  - packages/core/src/prompts.ts#buildSurgicalRepairPrompt
  - packages/core/src/prompts.ts#buildTopicPrompt
  - packages/core/src/prompts.ts#buildTopicRefinePrompt
  - packages/core/src/prompts.ts#buildTopicRepairPrompt
  - packages/core/src/prompts.ts#buildTopicSectionAssignmentBlock
  - packages/core/src/prompts.ts#buildUnderstandingPrompt
  - packages/core/src/prompts.ts#buildUnderstandingRepairPrompt
  - packages/core/src/prompts.ts#evidenceSection
  - packages/core/src/prompts.ts#formatTopicGroups
  - packages/core/src/prompts.ts#longestRunOf
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors
  - packages/core/src/prompts.ts#renderProseEvidenceBlock
  - packages/core/src/prompts.ts#renderRationaleEvidenceBlock
  - packages/core/src/prompts.ts#selectSafeFence
  - packages/core/src/prompts.ts#wrapInSafeFence
---

# LLM Prompt Templates for Livewiki's Documentation Pipeline

This page documents the centralized prompt construction and safety mechanisms that prepare every LLM call in livewiki's batch documentation pipeline.

## When to use this page

- **Trace how any stage-4 or stage-5 prompt is assembled** if you are debugging why a generated page or repair round behaves as it does.
- **Understand the untrusted-content safety layer** before adding or modifying any prompt builder that embeds source code, prior candidates, or evidence.
- **Extend the editorial contract** by adding or adjusting shared prompt rules that must stay consistent between initial generation and repair prompts.
- **Audit the closed-list distribution requirements** that force the LLM to place every canonical symbol key exactly once in frontmatter and exactly once across section markers.

## How it fits

`prompts.ts` is the single source of truth for every prompt template in the batch pipeline. It exports builder functions (`buildStage4Prompt`, `buildRepairPrompt`, and the stage-5 flow/topic/understanding builders) that the orchestrator calls with module metadata, closed key lists, symbol tables, and code excerpts. The module also owns the defensive encoding utilities that sanitize untrusted text before it reaches the model — critical because source code and prior LLM outputs can legitimately contain marker-shaped strings that would otherwise corrupt the generation contract.

The file sits at the boundary between the deterministic orchestrator and the stochastic LLM. Its exported `build*Prompt` functions receive structured data from the pipeline stages (defined in `modules.ts`, `flows.ts`, `topics.ts`, and `repair-contract.ts`) and return `PromptPair` objects ready for the `LlmClient`. The shared rule arrays (`PAGE_OPENING_PROMPT_RULES`, `FILE_NARRATIVE_PROMPT_RULES`, and the per-page-kind contracts) encode livewiki's editorial invariants so that initial and repair prompts never drift apart, and the `neutralize*` helpers ensure that only trusted, orchestrator-owned control markers survive into any prompt text.

## Prompt-building foundations: budgets, shared rules, and untrusted-content safety
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#LAY_READER_PROMPT_RULE packages/core/src/prompts.ts#NO_REASONING_WRAPPER_PROMPT_RULE packages/core/src/prompts.ts#WRITE_FOR_UNDERSTANDING_PROMPT_RULE packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES -->

This part of the file sets the shared, file-agnostic foundations that every prompt built elsewhere in the package relies on. Its job is twofold: to fix the token ceilings a page-generation call may consume, and to define a canonical set of behavioral rules that every opening prompt must obey, so that generated pages are consistent in voice, structure, and safety regardless of which module produced them.

The two budget constants establish the hard limits for a single model invocation. `DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;` caps the total context window available to a request — this is the pool from which both the prompt and the model's output draw. `DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;` reserves a smaller ceiling specifically for the generated response. Together they let callers calculate how much room remains for source excerpts and instructions before a request would be truncated, and they serve as the defaults that more specific prompt builders can override when a particular task needs a tighter or looser allowance.

The rule constants encode the non-negotiable expectations for how a model should behave when composing a page. `LAY_READER_PROMPT_RULE` tells the model to assume its reader is a capable developer who has never seen the repository, so every term or acronym must be explained on first use and purpose must precede mechanism. `NO_REASONING_WRAPPER_PROMPT_RULE` forbids the model from emitting any reasoning, scratchpad, or `<think>` blocks in its response — the output must be purely the Markdown document itself. `WRITE_FOR_UNDERSTANDING_PROMPT_RULE` steers the tone toward tight, factual prose that a newcomer can follow section by section, understanding not just what each part does but why it exists.

The final constant, `PAGE_OPENING_PROMPT_RULES`, aggregates all of these individual rules plus several structural mandates into a single ordered list that prompt builders can splice into any opening instruction. The list opens with the three named rule constants, then appends inline rules that dictate the exact opening structure (an H1 title, one responsibility sentence, a canonical `When to use this page` H2 with task bullets, and a `How it fits` H2), require non-empty bullet content, forbid using the module ID alone as a title, place the `lw:anchors` marker prohibition, and warn against inflating a module's prominence. Because the array is declared `as const`, the list is immutable and its string literals are preserved as literal types — meaning downstream code that consumes these rules can rely on their exact wording and ordering at compile time, and any attempt to alter the list elsewhere would be a type error.

## Fence selection and control-marker neutralization for embedding untrusted text
<!-- lw:anchors packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.ts#renderRationaleEvidenceBlock packages/core/src/prompts.ts#renderProseEvidenceBlock packages/core/src/prompts.ts#evidenceSection -->

The mechanism begins by measuring the longest run of a given fence character in untrusted text. `longestRunOf(text, char)` scans the input with a regex matching one or more consecutive backticks or tildes, tracking the maximum run length. This measurement is the foundation for choosing a safe fence because a closing fence in Markdown must be at least as long as the opening fence; any run in the content that matches or exceeds the opening fence length would prematurely terminate the code block.

When a pathological run is too long to out-fence, `boundEncodeLongRuns(text, char, cap)` steps in. It finds every run of the character that is at least `cap` characters long and splits each such run into chunks of `cap - 1` characters, joining the chunks with single spaces. This guarantees that no surviving run in the encoded text can reach `cap`. The function applies this transformation to both backticks and tildes in the worst case, ensuring the content contains no run long enough to close even a capped fence.

`selectSafeFence(enclosed)` then picks the actual fence. It first measures the backtick run: if adding one to that run stays within `SAFE_FENCE_MAX_LEN`, it returns a backtick fence of length `Math.max(3, backtickRun + 1)` — at least three, but one longer than the longest content run. If backticks are pathologically long, it tries the same logic with tildes and returns a tilde fence. Only when both character classes have excessive runs does it fall back to the final strategy: encode both character classes with `boundEncodeLongRuns` capped at `SAFE_FENCE_MAX_LEN`, then return a tilde fence of exactly `SAFE_FENCE_MAX_LEN` characters. The CommonMark rule that a closing fence must be at least as long as the opening one guarantees the encoded content — whose longest surviving run is at most `SAFE_FENCE_MAX_LEN - 1` — cannot close that fence.

`wrapInSafeFence(enclosed)` completes the embedding by calling `selectSafeFence` and formatting the result as `fence\ncontent\nfence`. This produces a self-contained code block that isolates the untrusted text from the surrounding prompt structure.

The control-marker neutralization works in two variants. `neutralizeUntrustedControlMarkers(text)` replaces every occurrence of the `LW_CONTROL_MARKER_RE` pattern — any `lw:*` control marker — with an equal number of spaces, effectively scrubbing the marker while preserving byte offsets. `neutralizeUntrustedControlMarkersExceptValidAnchors(text, closedKeyList)` takes a more surgical approach: it builds a set from the `closedKeyList`, and for each matched control marker, it checks against `strictAnchorsMarker`, a regex that matches exactly an `lw:anchors` HTML comment with a non-empty key list. If the marker is a valid anchors comment whose keys all appear in the closed set, it is preserved verbatim; otherwise the marker is replaced with spaces. This distinction matters because the `lw:anchors` marker is the one legitimate mechanism the generated output may carry, and only when it references keys the caller has already approved.

Three rendering helpers use these building blocks to assemble evidence blocks. `renderRationaleEvidenceBlock(rationaleEvidence)` returns nothing when the input is empty or whitespace; otherwise it emits a heading, the rationale text passed through `wrapInSafeFence(neutralizeUntrustedControlMarkers(rationaleEvidence))`, and a blank trailing line. `renderProseEvidenceBlock(proseEvidence)` mirrors this shape for prose evidence, with a heading noting these files can never appear in the closed list. `evidenceSection(heading, body, opts)` is the generic conveyor: it skips empty bodies, optionally wraps the body in a safe fence when `opts.fenced` is true, and emits a trailing blank line unless `opts.trailingBlank` is explicitly `false`.

```ts
function renderRationaleEvidenceBlock(rationaleEvidence: string | undefined): string[] {
```
This function takes optional rationale text and returns an array of lines to include in the output, or an empty array when there is nothing to render.

```ts
function renderProseEvidenceBlock(proseEvidence: string | undefined): string[] {
```
This function takes optional prose source text and returns an array of lines, again empty when the input is blank.

```ts
function evidenceSection(
```
This function takes a heading string, a body string, and an options object controlling fenced wrapping and trailing blank lines, returning the assembled line array.

All evidence blocks funnel through the same pipeline: the untrusted text is first neutralized so no `lw:*` marker inside it can be copied as live syntax, then wrapped in a fence length chosen by the measurement and encoding logic above, so the surrounding Markdown structure cannot be broken by any content the code did not itself author.

## Stage-4 module page generation: assembling the initial documentation prompt
<!-- lw:anchors packages/core/src/prompts.ts#buildStage4Prompt -->

`buildStage4Prompt` is the function responsible for assembling the two-part message that drives the final documentation generation pass. Its role is to translate a module's structured metadata, its authoritative key list, and the raw source excerpt into a precise, self-contained instruction set for the language model, such that the resulting Markdown page will satisfy the validator's strict invariants. It returns a `PromptPair` — an object with a `system` string (the rules the model must follow) and a `user` string (the concrete data the model operates on).

The function begins by determining the module's role. It uses the optional `moduleRoleOverride` when provided, otherwise it falls back to `classifyModuleRole(module)`. This classification branches the entire prompt construction: product runtime code gets one set of rules, while auxiliary roles (benchmarks, fixtures, documentation, tooling) get a stricter "compact" contract. For non-product roles, the function injects `compactAuxiliaryRules`, which tell the model to skip the normal multi-section implementation narrative, use a single `## Reference` section with one H3 per anchored symbol, emit one `lw:anchors` marker per symbol holding that symbol's single closed key, and never imply that auxiliary code is a product runtime path.

The bulk of the work happens in composing the `system` message — a long array of rule strings joined into one prompt. This array layers the static rules of the entire pipeline: the output format requirements, the `PAGE_OPENING_PROMPT_RULES` that define the mandatory leading structure, and the optional rule sets that are only included conditionally. For product modules with a single path, it adds `FILE_NARRATIVE_PROMPT_RULES`; for all product modules, it appends `LITERAL_SIGNATURE_PROMPT_RULE`. It always appends the exception-branch, inventory-authority, and branch-precision rules. If the caller passed `formatOptions` with a `moduleDiagrams` value, the function calls `buildModuleDiagramPromptRules` to generate those constraints; if `deepHierarchy` is set, it adds `DEEP_HIERARCHY_PROMPT_RULE`. The function then states the core invariants in its own words: the closed list is the only valid source of anchor keys, markers must be written in full without ellipses, markers inside fenced code blocks are never parsed as real, and completeness requires each key to appear exactly once in the frontmatter anchors list *and* exactly once across the section markers — two independent checks. It adds the primary-section rule (each key belongs to exactly one section marker), forbids roundup sections that aggregate keys, demands prose after every marker, requires fully closed Markdown constructs, and bans TODO/TBD placeholders. Finally, it appends the `WRITE_FOR_UNDERSTANDING_PROMPT_RULE` and, if diagrams are requested, a rejection criterion for the diagram section.

The `system` prompt then enumerates the rejection criteria verbatim — the exact conditions the artifact validator will check, such as a malformed frontmatter, invented keys, duplicates, markers without following prose, unclosed fences, and the presence of an `lw:manual` block (which is reserved for human content and can only be re-injected by the orchestrator).

The `user` message is built from parts that provide the model with its raw material. It opens with the language tag, then identifies the module by its single file path or by its module ID if it spans multiple paths. It includes the suggested display title (with a note that the model may improve it), the full path list, and the symbol count. The most critical part is the `# Closed list of canonical keys` block, which lists every valid anchor key one per line, prefixed with `- `; this is the byte-for-byte source the model must copy from.

The function then branches on whether the closed list is empty. If there are keys, it appends a concrete syntax example: a small fenced code block showing a `## Validation flow` heading followed by a marker holding up to two sample keys taken from the list. If the list is empty, it instead pushes a `# Zero-key contract`, instructing the model to still produce a useful, complete page grounded in the visible source, but with unanchored implementation sections, an empty or omitted `anchors` field in the frontmatter, and no control-marker comments at all — the goal being useful unanchored documentation rather than a placeholder.

The final major step is sanitizing the source excerpt. The function calls `neutralizeUntrustedControlMarkers(truncatedSource)` on the raw source text, ensuring that any `lw:*` control markers in the module's own code cannot be mistaken for real directives. It then appends the evidence blocks: the symbol table preceded by its `# Symbol table:` header (with the `evidenceSection` helper labeling and optionally fencing it), any optional `rationaleEvidence` rendered through `renderRationaleEvidenceBlock`, and the neutralized source code wrapped in a fenced block and labeled as truncated and untrusted. The message ends with an explicit prohibition against emitting `lw:manual` blocks and the target filename for the output page (`livewiki/${module.id}.md`). Joining these user parts with newlines yields the complete `user` member of the returned `PromptPair`.

## Stage-4 repair: corrective prompt built from validator errors and prior candidate
<!-- lw:anchors packages/core/src/prompts.ts#buildRepairPrompt -->

`buildRepairPrompt` is the corrective core of stage 4: it takes everything the validator rejected — the structured error list, the prior candidate page, and the authoritative closed key list — and assembles a two-part prompt (`system` and `user`) that instructs the model to produce a corrected page. The function's job is not to fix the page itself, but to convert machine-readable validation failures into precise, actionable instructions that converge on a valid artifact, escalating in strictness as repair attempts run out.

The function begins by classifying the module's role (`moduleRole = moduleRoleOverride ?? classifyModuleRole(module)`) and, for non-product modules, appending `compactAuxiliaryRepairRules` — a set of rules that preserve the compact auxiliary contract (one `## Reference` section with one H3 and one grounded sentence per anchored symbol). It then reads `attempt` and `total` from `attemptContext` and derives `isFinal = attempt >= total`; this boolean is deliberately computed from numbers rather than passed in, so callers cannot contradict the bounded-execution state by supplying a stale flag.

The `system` string is assembled by joining a long array of constraint lines. It opens by identifying the model as a repair assistant and stating the attempt number (`attemptTag`). It then lists the hard constraints that carry over from initial generation: required page opening rules (`PAGE_OPENING_PROMPT_RULES`), role-specific rules, and a battery of invariant rules — no invented keys, no abbreviated `lw:anchors` markers, no `lw:manual` blocks, no aggregate summary markers, and the rule that frontmatter anchors and section markers are two independent completeness requirements that must each contain every closed key exactly once. The system prompt also embeds per-error remediation guidance (how to resolve `anchor_outside_closed_list`, `missing_closed_key`, `empty_section`, `unclosed_markdown`, `todo_marker_present`), and, when `isFinal` is true, appends a `FINAL ATTEMPT DIRECTIVE` forbidding reproduction of the unchanged prior candidate.

The most delicate work happens before the error lines are rendered. Validation errors can carry untrusted text — `offending` and `message` fields may contain arbitrary lines copied from the model's own page, including a copyable `lw:manual` control marker that would otherwise re-enter the prompt and tempt the LLM to reproduce it. The function therefore sanitizes every error surface through `neutralizeUntrustedControlMarkers` before interpolation, then re-neutralizes the completed line as defense-in-depth.

The structured errors are processed in two streams. Individual errors (anything except `missing_closed_key`, or `missing_closed_key` errors whose location is anything other than frontmatter or section) are mapped to formatted lines that include the error code, a location qualifier (section slug, frontmatter, or generic location), the sanitized message and offending text, and — when `renderActionDirective` returns a non-empty directive — a machine-checkable `ACTION:` clause sourced from `repair-contract.ts`. Meanwhile, `missing_closed_key` errors with frontmatter or section locations are grouped by location into `groupedMissingKeys`, de-duplicated, and rendered as `missingKeyBlocks` — grouped remediation blocks that state plainly how many keys are missing from which location and instruct the model to add each listed key byte-for-byte to exactly that location, never duplicating or creating an aggregate marker.

The `user` string then assembles the full context for the model: the language and attempt tag, the module's file path or ID and display title, the authoritative closed key list (one key per line), the symbol table, any rationale evidence block, the truncated source code wrapped in a safe fence, the fully rendered error lines and missing-key blocks, and the prior candidate — truncated to `maxCandidateChars` and passed through `neutralizeUntrustedControlMarkersExceptValidAnchors`, which preserves section markers whose keys are all closed-list-valid (so the model can see correct marker syntax) while neutralizing every other `lw:*` marker. When `isFinal` is true, the user prompt also includes an explicit audit checklist (`auditBlock`) restating the four acceptance criteria. Finally, the function returns `{ system, user }` — a `PromptPair` ready to be sent to the model, with every instruction phrased so that the only viable output is a valid, corrected Markdown page.

## Prompt rules shared across page kinds and repair flows
<!-- lw:anchors packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES packages/core/src/prompts.ts#FILE_NARRATIVE_PROMPT_RULES packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE packages/core/src/prompts.ts#INVENTORY_AUTHORITY_PROMPT_RULE packages/core/src/prompts.ts#BRANCH_PRECISION_PROMPT_RULE packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET packages/core/src/prompts.ts#buildModuleDiagramPromptRules packages/core/src/prompts.ts#DEEP_HIERARCHY_PROMPT_RULE -->

These anchors identify indexed symbols whose implementation is part of this module.

## Prompt rules shared across page kinds and repair flows

The files exports an array of prompt rules that is used across every page kind and repair flow. Each set of rules shapes the output the model produces, and they are applied by many parts of the system including flow documents and topic pages. The file first exposes three page-kind rule arrays (`FLOW_PAGE_PROMPT_RULES`, `TOPIC_PAGE_PROMPT_RULES`, `FILE_NARRATIVE_PROMPT_RULES`) that structure how a page of each kind is written, and later builds the individual rule strings these reference.

`FLOW_PAGE_PROMPT_RULES` provides the skeleton for any flow document the generator produces. It opens by reusing shared rules (`LAY_READER_PROMPT_RULE` and `NO_REASONING_WRAPPER_PROMPT_RULE`), which likely tell the model to write for a general audience and to avoid wrapping the page in its own narrative commentary. The rule then demands a fixed page skeleton: an H1 flow title, a single-sentence summary of the behavior, and the exact ordered H2 sections `Purpose`, `Ordered flow`, `Invariants`, `Failure and recovery`, and `Related pages`, each spelled with the exact casing included in the rule. Notably, the flow rules exclude a `Diagram` section because the orchestrator will generate and inject the diagram itself. Each section is further constrained: `Purpose` and `Failure and recovery` accept only paragraphs (bullet lists in those sections are rejected), while `Ordered flow` forces a numbered list and `Invariants` allows paragraphs or bullets. The rule also covers the `lw:anchors` markers that must appear exactly in `Purpose`, `Ordered flow`, and `Failure and recovery`, requiring each of those sections to carry at least one marker of its own so that no single section dominates the citations. Finally, it prescribes the frontmatter content: a human-meaningful `title`, an `owner`, an `updated` date that the orchestrator passes, and the `modules` and `anchors` lists that come verbatim from the user's message.

`TOPIC_PAGE_PROMPT_RULES` does the same for topic pages but with slightly different section names — `Purpose`, `When to use this page`, `Behavioral contract`, `Failure and recovery`, `Change map`, and `Related pages` — and looser constraints around anchors placement. It tells the model where those markers may live (inside the first five H2s, with descendants belonging to their ancestor), and it requires each of those five to cite at least one distinct closed key. Topics also have length and sourcing constraints: the prose target is 500–900 words (never more than 1,400), and at least 75% of cited keys must be non-test product symbols. The model cannot emit source-signature dumps or non-Mermaid code fences; instead, it names symbols in prose with inline code adopting their closed-list key (for example `` `app/services/bgm.py#save_bgm_upload` ``) and never links directly to source, whereas Markdown links are reserved for wiki artifacts. The rule also warns against assigning canonical keys to prose evidence files, since those files cannot appear in the closed list, and it prohibits a comma-joined frontmatter scalar — `modules`, `flows`, and `anchors` must each be YAML block lists. Absolute wording like "only" or "always" is permitted only when the evidence proves the scope and names the guard.

`FILE_NARRATIVE_PROMPT_RULES` is the rule set steering the current file's own narrative style. It instructs the model to organize sections around what the file's code does as a mechanism — one responsibility per H2, never a flat per-symbol arrangement — and to lead each section with why the step exists before explaining how it executes. Symbols are cited inline only where the story touches them, and behavior is explained step by step so that a reader understands the environment without needing the callers. It prohibits a `Tests` section, and it explicitly forbids emitting the manual-block control marker in any context, since the validator rejects even a literal copy inside a code fence; the orchestrator alone re-injects human-owned manual blocks from an earlier version.

```ts
export const LITERAL_SIGNATURE_PROMPT_RULE =
  `- When a section asserts behavior of a named function or method and the symbols table supplies a non-empty signature, copy that signature byte-for-byte from the symbols table into inline code or a fenced code block in the same section before the behavioral explanation. Do not reconstruct, normalize, shorten, or "improve" it. One literal signature covers subsequent claims about that symbol within the section. If the table has no signature, do not invent one; limit the prose to facts visible in the supplied source and identify the symbol by its exact closed-list key. Immediately after each literal signature, add one plain-language sentence naming what the symbol takes and what it returns, in words a non-specialist understands.`;
```
`LITERAL_SIGNATURE_PROMPT_RULE` holds a single string: it takes no input and simply returns a rule the generator relays to the model.

```ts
export const EXCEPTION_BRANCH_PROMPT_RULE =
  `- When the supplied source visibly contains a material \`throw\`, \`catch\`, fallback, rollback, early return, or fail-open/fail-closed branch for the documented symbol, describe that branch or explicitly scope the prose to the normal path. Never use "always", "guarantees", "mandatory", or equivalent absolute language while omitting a visible exception. Document only what the visible evidence establishes; never narrate what the excerpt does or does not contain.`;
```
`EXCEPTION_BRANCH_PROMPT_RULE` holds a single string: it takes no input and returns a rule that instructs the model to either describe an exception branch or scope the prose to the normal path.

```ts
export const INVENTORY_AUTHORITY_PROMPT_RULE =
  `- The closed key list and the symbol/file inventory in this prompt are AUTHORITATIVE for inventory facts: counts, file lists, and what exists. README text and excerpt prose may be stale — never copy an inventory claim (for example, "3 test files") from prose when the prompt's own inventory says otherwise.`;
```
`INVENTORY_AUTHORITY_PROMPT_RULE` holds a single string: it takes no input and returns a rule that establishes the inventory in the prompt as the verifiable source of truth.

```ts
export const BRANCH_PRECISION_PROMPT_RULE =
  `- When describing bounds, clamping, validation, or containment, state exactly which side is enforced (upper, lower, or both) and which input shapes each check covers (for example, relative versus absolute paths). Never generalize a one-sided check visible in the source into a two-sided invariant — if the source caps only above a limit, do not claim it clamps to a range; if a containment check runs only for one input shape, do not claim it holds for every shape.`;
```
`BRANCH_PRECISION_PROMPT_RULE` holds a single string: it takes no input and returns a rule that tells the model to describe guards precisely, naming the side they enforce and the input shapes they cover.

```ts
export const FLOW_DIAGRAM_DEFAULT_BUDGET = { maxNodes: 12, maxEdges: 20 } as const;
```
`FLOW_DIAGRAM_DEFAULT_BUDGET` holds a single object: it takes no input and returns a constant budget object with `maxNodes` set to 12 and `maxEdges` set to 20, which the caller uses to constrain the diagram generator when no custom budget is provided.

```ts
export function buildModuleDiagramPromptRules(budget: FlowDiagramBudget): readonly string[] {
  return [
    `- After the \`How it fits\` opening section and before the first implementation section, emit ONE H2 \`Diagram\` section containing exactly one \`\`\`mermaid fenced block and nothing else. Draw the module's internal structure at MODULE granularity: files, classes, or components as nodes and their real dependency or call direction as edges — never one node per symbol, per function, or per line.`,
    `- The diagram must fit the budget: at most ${budget.maxNodes} nodes and ${budget.maxEdges} edges. Merge or drop detail until it fits; a focused small diagram beats a complete large one.`,
    `- Write the real Mermaid source inside the fence. NEVER write a \`%% livewiki/...\` placeholder comment — the orchestrator extracts your diagram and substitutes the on-disk placeholder itself.`,
    `- The \`Diagram\` section carries no \`lw:anchors\` marker and no anchor citations — closed keys live only in the frontmatter anchors list and the implementation section markers.`,
  ] as const;
}
```
`buildModuleDiagramPromptRules(budget: FlowDiagramBudget): readonly string[]` — this function takes a `budget` that specifies the maximum number of nodes and edges and returns a fixed list of prompt rules that tell the writer where in the page to place the diagram, how to draw the module's structure at a coarse granularity, how many nodes and edges are allowed, and what is forbidden inside the diagram section (such as placeholder comments).

```ts
export const DEEP_HIERARCHY_PROMPT_RULE =
  `- When the module has 8 or more symbols, group them under concept-named H2 sections (for example "Parsing", "Scheduling", "Persistence") with H3 subsections per symbol or tight symbol cluster, instead of one flat symbol list. Each concept H2 carries exactly one \`lw:anchors\` marker listing the keys its subsections document, followed by real prose — the one-marker-per-section, primary-section, and prose-after-marker rules are unchanged.`;
```
`DEEP_HIERARCHY_PROMPT_RULE` holds a single string: it takes no input and returns a rule that tells the model to arrange ten or more symbols into concept-headed H2 groups with subsections, rather than presenting a flat list.

The individual `..._RULE` constants are exported separately so any page-kind flow or repair flow can pull in a single rule without importing the whole array: a flow writer adds `LITERAL_SIGNATURE_PROMPT_RULE` to enforce signature fidelity, while a code-comment repair flow might include `EXCEPTION_BRANCH_PROMPT_RULE` and `BRANCH_PRECISION_PROMPT_RULE` to guard against overclaiming. Because they are plain strings stored in `as const` arrays, consumers embed them directly into the prompt they send to the model alongside the inventory and source excerpt, coupling the guided structure with the authority guarantee each rule makes.

The file also exports `FLOW_DIAGRAM_DEFAULT_BUDGET`, a fixed budget object of 12 nodes and 20 edges that the diagram generator uses when no custom budget is supplied. Together with `buildModuleDiagramPromptRules`, which receives a budget and returns the rules for drawing a module diagram within those limits, the file supplies both a preset and a way to tighten or relax the budget per invocation. Finally, `DEEP_HIERARCHY_PROMPT_RULE` is the consolidation rule for larger modules, guiding the model to group many symbols into concept-named sections so the prose stays navigable.

## Higher-stage prompt builders and their shared block renderers
<!-- lw:anchors packages/core/src/prompts.ts#UNDERSTANDING_PAGE_PROMPT_RULES packages/core/src/prompts.ts#buildUnderstandingPrompt packages/core/src/prompts.ts#buildUnderstandingRepairPrompt packages/core/src/prompts.ts#FOLDER_PURPOSE_PROMPT_RULES packages/core/src/prompts.ts#buildFolderPurposePrompt packages/core/src/prompts.ts#buildFolderPurposeRepairPrompt packages/core/src/prompts.ts#buildFileOpeningPrompt packages/core/src/prompts.ts#buildFilePlanPrompt packages/core/src/prompts.ts#buildFileSectionPrompt packages/core/src/prompts.ts#buildFlowGroupBlock packages/core/src/prompts.ts#buildFlowSectionAssignmentBlock packages/core/src/prompts.ts#buildTopicSectionAssignmentBlock packages/core/src/prompts.ts#buildStage5Prompt packages/core/src/prompts.ts#buildStage5RepairPrompt packages/core/src/prompts.ts#buildTopicRefinePrompt packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRepairPrompt packages/core/src/prompts.ts#formatTopicGroups packages/core/src/prompts.ts#buildSurgicalRepairPrompt -->

The functions in this section are the higher-stage prompt builders: they assemble the full `PromptPair` (system instructions plus user context) for the flow-documentation and topic-page stages of the pipeline, and several stages of repair. Unlike the lower-level builders that merely concatenate fixed strings, these functions must weave together closed-key lists, candidate metadata, untrusted evidence snippets, and deterministic block renderers. The key architectural insight is the deliberate separation between **instruction text**, which is static and lives in the system array, and **context blocks**, which are computed just-in-time and spliced into the user message. Both the initial-generation prompt and its repair counterpart share the same block renderers, ensuring that the model sees identical evidence on the first attempt and on every subsequent repair — a design constraint noted in the code comments as "initial and repair must not drift."

## Shared block renderers for flow pages

Before the stage-5 builders can assemble their messages, they rely on two private helpers that convert structured metadata into user-visible context blocks. The first, `buildFlowGroupBlock(closedKeyList, flowKeyGroups)`, takes the authoritative closed list of canonical keys and an optional `FlowKeyGroups` object that groups those keys into semantic tiers by their role in the flow — `entry`, `boundary`, and `sink`. The function builds a `Set` from the closed list, then iterates over the three tiers in a fixed order. For each tier, it filters the group's keys to keep only those present in the closed set, and if any survive, it appends a bullet line of the form `- <tier> keys: k1, k2`. If no keys survive for any tier, it returns an empty array. Otherwise it wraps the non-empty lines in a Markdown comment that explains the grouping is the "flow's role evidence" and that the page "MUST cite at least one key from EACH group."

The second helper, `buildFlowSectionAssignmentBlock(sectionMap: FlowKeySectionMap | undefined): string[]`, addresses the opposite concern: not *which* tier a key belongs to, but *which required section* of the flow page must carry its anchor. It takes an optional map from flow keys to `FlowRequiredSection` values (one of `purpose`, `ordered-flow`, or `failure-and-recovery`). The function initializes a `Record` with empty arrays for those three sections, then iterates the map, pushing each key into its assigned section's array. It defines a human-readable label for each section, then emits one bullet per non-empty section in the canonical order — `Purpose`, `Ordered flow`, `Failure and recovery`. These bullets are wrapped in a heading that declares the assignment "AUTHORITATIVE AND FIXED — this is not a suggestion," instructing the model to place each key's marker only in its listed section while allowing prose to mention the symbol anywhere.

## Stage-5 flow generation and repair

The main flow-generation entry point is `buildStage5Prompt`, which constructs the complete prompt for turning a `FlowCandidate` into a single Markdown flow page. Its signature is:

```ts
export function buildStage5Prompt(
  candidate: FlowCandidate,
  closedKeyList: string[],
  moduleOpenings: string,
  symbolsTable: string,
  truncatedSource: string,
  language: Language = "en",
  /** @deprecated No longer rendered into the prompt text (Priority-0 fix, 2026-07-22) — kept only so call sites don't all need updating. The diagram is generated deterministically by the orchestrator, never by the LLM. */
  _budgets: FlowDiagramBudget = FLOW_DIAGRAM_DEFAULT_BUDGET,
  flowKeyGroups?: FlowKeyGroups,
  flowKeySectionMap?: FlowKeySectionMap,
): PromptPair
```

This function takes the flow candidate, the closed list of canonical keys, the module digest, the symbols table, and the truncated source, plus optional grouping and assignment maps; it returns a `PromptPair` with a `system` string and a `user` string. The function first computes two example values from the closed key list: it slices up to two keys to serve as sample markers, and constructs an `exampleMarker` string only if at least one key exists. It then invokes both shared block renderers to obtain `flowGroupBlock` and `sectionAssignmentBlock`.

The `system` array is a long, carefully ordered list of instructions assembled with `.join("\n")`. It opens by identifying the model as a "technical documentation generator for the livewiki project" and describing the single task: write one flow page in prose, with no diagram section. It then expands into a series of strict output rules: copy keys byte-for-byte from the closed list; never abbreviate an `lw:anchors` marker with ellipses; treat markers inside fenced code blocks as non-parsed; cite each key exactly once in the frontmatter and once across section markers. Critically, the rule set is *conditional*: if a `flowKeySectionMap` was provided, the system includes a "SECTION ASSIGNMENT IS FIXED" instruction; otherwise it falls back to the "PRIMARY-SECTION RULE," which lets the model choose the single best section for a key relevant to several. The rules continue with rejection criteria that mirror the validator's checks — unclosed fences, TODO text, missing module lists, anchor placement outside allowed sections — enumerating the exact error codes the artifact validator will raise.

The `user` array is built incrementally. The function first pushes the language, the candidate's slug and title seed, the module IDs in walk order, the detection signals, and the current date. It then maps the entire closed key list into `- key` lines under an "AUTHORITATIVE" header, and pushes the two computed blocks (`flowGroupBlock`, then `sectionAssignmentBlock`) directly after. If at least one closed key exists, it appends a concrete marker-syntax example inside a fenced code block, showing the model exactly how an `lw:anchors` comment should be structured. The three untrusted content sources — `moduleOpenings`, `symbolsTable`, and `truncatedSource` — are then pushed through the `evidenceSection` helper, which wraps each in the appropriate heading and fence. Notably, both the module digital and the source are first passed through `neutralizeUntrustedControlMarkers`, a sanitizer that strips any `lw:*` control markers from the untrusted text so they cannot be copied into the output. The user section concludes with a FORBIDDEN notice about never emitting an `lw:manual` block and a final "Output:" directive.

The `buildStage5RepairPrompt` function is the repair counterpart for the flow stage. Its signature:

```ts
export function buildStage5RepairPrompt(
  candidate: FlowCandidate,
  closedKeyList: string[],
  moduleOpenings: string,
  symbolsTable: string,
  truncatedSource: string,
  priorCandidate: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  maxCandidateChars: number,
  language: Language = "en",
  attemptContext: RepairAttemptContext = { attempt: 1, total: 1 },
  /** @deprecated No longer rendered into the prompt text (Priority-0 fix, 2026-07-22) — kept only so call sites don't all need updating. */
  _budgets: FlowDiagramBudget = FLOW_DIAGRAM_DEFAULT_BUDGET,
  flowKeyGroups?: FlowKeyGroups,
  flowKeySectionMap?: FlowKeySectionMap,
): PromptPair
```

It takes the same candidate and context data as the initial builder, plus the prior rejected candidate, the structured validator errors, a maximum character budget for that candidate, and an attempt context; it returns a `PromptPair` whose user message instructs the model to fix every error. The function begins by computing the same `flowGroupBlock` and `sectionAssignmentBlock` as the initial prompt — again sharing the block renderers to keep evidence consistent. It derives an `attemptTag` from the attempt context, labeling the message as a "FINAL repair attempt" when the current attempt equals the total.

The system array mirrors the initial prompt's structure but reframes the model as a "technical documentation REPAIR assistant." It includes the same hard constraints and rule constants, and conditionally injects the fixed-section-assignment instruction when a section map is present. The repair-specific rules become more prescriptive about *how* to fix particular error codes: `anchor_outside_closed_list` errors must be removed entirely, not replaced with a different key; `missing_closed_key` errors are addressed by adding the exact key to the named location or dropping it from the opposite side. The system also includes either a "FINAL ATTEMPT DIRECTIVE" or an audit checklist, and closes with instructions not to wrap output in code fences or include reasoning.

The user message is where the repair prompt does its most intricate work. It starts with the language, attempt tag, and audit directives, then repeats the flow metadata and the closed key list. It pushes the two shared blocks, then the neutralized evidence sections. The core of the repair logic lies in processing the errors: the function iterates over the structured errors, filtering out `missing_closed_key` entries that have an `offending` value and a recognized location (`frontmatter` or `section`), grouping those missing keys by location into `groupedMissingKeys`. The remaining errors are mapped into individual bullet lines, each annotated with its location and — defense-in-depth — passed through `neutralizeUntrustedControlMarkers` on both the message and the offending text to prevent untrusted validator output from re-introducing control markers. Each line also receives an `ACTION` directive from `renderActionDirective`, a closed contract that supplies verbatim remediation instructions per error code. The grouped missing keys are then rendered as their own block, one per location, with a combined ACTION explaining how to restore consistency between the two sides. Finally, the prior candidate is sliced to `maxCandidateChars` and sanitized via `neutralizeUntrustedControlMarkersExceptValidAnchors`, which deliberately preserves section markers whose keys are all in the closed list (as correct syntax references) while neutralizing all other `lw:*` markers. The message ends with a directive to output the corrected page with no diagram section.

## Topic plan refinement and topic page generation

Beyond the flow pages, the file builds prompts for the topic-documentation stages. `buildTopicRefinePrompt` is a lighter function that targets an information-architecture editor rather than a prose writer. Its signature:

```ts
export function buildTopicRefinePrompt(
  proposals: readonly TopicPlanProposal[],
  maxTopics: number,
  language: Language = "en",
): PromptPair
```

It takes the deterministic, already-valid topic plan proposals and a maximum topic count, returning a `PromptPair` that asks the model to return refined JSON in the same schema as the input. The function's system message describes a deliberately narrow job: the model may reword titles and intents, merge two topics that share a module (unioning their modules, flows, and groups exactly), or drop a topic as redundant — but it may never add a module, flow, or anchor, never invent a new topic, and never move an anchor between evidence groups. The constraints (distinct titles, 80-character title limit, 160-character intent limit, no line breaks, at most `maxTopics` topics) are stated plainly, and the output is required to be "JSON only" with "No prose and no Markdown fences." The user message contains just the language, a header explaining the input is valid, and the `JSON.stringify` of the proposals with a restructured object grouping them under a `topics` key.

`buildTopicPrompt` then takes the refined plan and turns it into an actual topic page. Its signature:

```ts
export function buildTopicPrompt(
  candidate: TopicCandidate,
  moduleDigest: string,
  symbolsTable: string,
  sourceEvidence: string,
  language: Language = "en",
  topicKeySectionMap?: TopicKeySectionMap,
  rationaleEvidence?: string,
  proseEvidence?: string,
): PromptPair
```

It takes the accepted topic candidate, the module digest, symbols table, and source evidence, plus optional section-assignment and rationale/prose evidence; returns a `PromptPair` instructing the model to write one concise semantic topic page. The function calls `buildTopicSectionAssignmentBlock(topicKeySectionMap)` — the topic analog of the flow section-assignment block. Where the flow version fixed keys to three sections, this renderer handles the five required topic sections in canonical order: `purpose`, `when-to-use-this-page`, `behavioral-contract`, `failure-and-recovery`, and `change-map`. It initializes a `Record` mapping each section to an empty array, populates it from the supplied map, and emits one bullet per non-empty section under a header declaring the assignment "AUTHORITATIVE AND FIXED," with the additional warning that `Change map` must not re-list a key already assigned to another section.

The `system` array for `buildTopicPrompt` is more concise than its flow-stage sibling. It opens by addressing the model as a generator for a "concise semantic topic page" and mandates that the frontmatter fields `order`, `modules`, and `flows` equal the supplied accepted values. It splices in `TOPIC_PAGE_PROMPT_RULES`, then conditionally appends the fixed-section-assignment instruction when the assignment block is non-empty. The function builds its user message from the language, the candidate's page-title, and the evidence sections — though the truncated portion of the source leaves the remaining assembly steps out of view, the pattern is consistent with the flow builders: the section-assignment block is pushed early to constrain key placement, and the module and symbol evidence follows, with the optional `rationaleEvidence` and `proseEvidence` presumably enriching the context for the model's writing task.

## Tests

Covered by `packages/core/src/prompts.test.ts` (same-name test file on disk).
