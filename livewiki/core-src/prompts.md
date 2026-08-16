---
title: Prompt Templates for the livewiki Documentation Pipeline
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
  - packages/core/src/prompts.ts#formatTopicGroups
  - packages/core/src/prompts.ts#longestRunOf
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors
  - packages/core/src/prompts.ts#renderProseEvidenceBlock
  - packages/core/src/prompts.ts#renderRationaleEvidenceBlock
  - packages/core/src/prompts.ts#selectSafeFence
  - packages/core/src/prompts.ts#wrapInSafeFence
---

# Prompt Templates for the livewiki Documentation Pipeline

This page documents the prompt template builders that construct every LLM interaction in the livewiki batch documentation pipeline.

## When to use this page

- **Understand how prompts are assembled**: trace how system and user messages combine rules, evidence, and source code for each stage.
- **Audit what the LLM receives**: verify that untrusted content is neutralized and that the closed key list remains the sole anchor authority.
- **Extend or modify prompt contracts**: learn where shared rule arrays live so initial and repair prompts stay in sync.
- **Debug prompt-related generation failures**: identify which builder produced a problematic prompt and what constraints it enforces.

## How it fits

`prompts.ts` sits at the boundary between the orchestration layer and the LLM client in `packages/core`. The orchestrator calls the exported builder functions (`buildStage4Prompt`, `buildStage5Prompt`, `buildUnderstandingPrompt`, and their repair variants) to produce `PromptPair` objects — system and user message pairs — that the `LlmClient.generate` method accepts. The module consumes module metadata, symbol tables, truncated source code, and validation error structures from adjacent modules like `modules.js`, `flows.js`, and `topics.js`, and it imports repair contract renderers from `repair-contract.ts` and section guard utilities from `section-guard.ts`.

The file centralizes three layers of concern: shared editorial rule arrays that all prompt builders inherit, untrusted-content sanitization utilities that prevent prompt injection from source and prior artifacts, and the stage-specific builders that assemble complete system/user message pairs for module, flow, topic, understanding, and folder-purpose page generation.

## Shared Prompt Contracts and Editorials
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#LAY_READER_PROMPT_RULE packages/core/src/prompts.ts#NO_REASONING_WRAPPER_PROMPT_RULE packages/core/src/prompts.ts#WRITE_FOR_UNDERSTANDING_PROMPT_RULE packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET packages/core/src/prompts.ts#buildModuleDiagramPromptRules packages/core/src/prompts.ts#DEEP_HIERARCHY_PROMPT_RULE packages/core/src/prompts.ts#FILE_NARRATIVE_PROMPT_RULES packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE packages/core/src/prompts.ts#INVENTORY_AUTHORITY_PROMPT_RULE packages/core/src/prompts.ts#BRANCH_PRECISION_PROMPT_RULE -->

The `prompts.ts` module serves as the single source of truth for the editorial rules and structural contracts that govern every generated page in the wiki. Rather than scattering formatting guidance across the codebase, this file centralizes the prompt fragments into reusable constants and builder functions, so the orchestrator can assemble a complete, self-consistent instruction set for any page type without duplicating rule text.

The file opens by defining two token-budget defaults that bound how much text the model should produce:

```ts
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;
```

These constants set a ceiling for the context window available to the model and the maximum length of the generated document, respectively. They give the orchestration layer a sane upper bound when no explicit budget is supplied, preventing an overlong page from exceeding the model's output capacity.

Three editorial rules are shared across both flow and topic pages because they encode the stylistic baseline for all wiki content. `LAY_READER_PROMPT_RULE` tells the model to write for a capable developer who has never seen the repository — explain what things are *for* before *how* they work, and define project-specific terms on first use. `NO_REASONING_WRAPPER_PROMPT_RULE` forbids any reasoning, scratchpad, or `<think>` blocks in the output; only the Markdown document itself may be emitted. `WRITE_FOR_UNDERSTANDING_PROMPT_RULE` keeps prose tight and factual but prioritizes narrative comprehension over quick lookup — each section should leave a newcomer knowing *why* it exists and *when* they would care. These three rules recur verbatim in the page-specific rule arrays because they are non-negotiable for every generated artifact.

For module pages, `PAGE_OPENING_PROMPT_RULES` defines the mandatory opening structure: after frontmatter, the page must begin with an H1 human-meaningful title, exactly one sentence stating the page's responsibility, an H2 `When to use this page` with two to four action-verb task bullets, an H2 `How it fits`, and short prose paragraphs placing the module in repository context. The array also encodes the anchoring discipline — the opening carries no `lw:anchors` marker, and every closed key must appear exactly once in frontmatter and once across later anchored sections. It further warns against mischaracterizing a module as an "entry point" merely because it exports many symbols, and against giving fixtures, tooling, benchmarks, or documentation more prominence than their honest task context warrants.

Flow pages get their own contract in `FLOW_PAGE_PROMPT_RULES`, which dictates a rigid H2 sequence — `Purpose`, `Ordered flow`, `Invariants`, `Failure and recovery`, `Related pages` — with exact casing. The `Ordered flow` list is the textual fallback of the companion diagram, so it must convey the same end-to-end sequence to a reader who cannot render Mermaid. The rules are explicit that no `Diagram` section may be written by the model; the orchestrator inserts it later. `Related pages` must link participating modules as `../<moduleId>/index.md` and the flows hub *exactly* as `[How it works](index.md)` — any other hub path resolves outside `flows/` and fails verification. The array also constrains frontmatter shape (title, `owner: generated`, `anchors`, `updated`, `modules`) and the placement of `lw:anchors` markers: they live only inside `Purpose`, `Ordered flow`, and `Failure and recovery`, each of which must carry at least one distinct cited key.

`TOPIC_PAGE_PROMPT_RULES` governs standalone topic pages with a similar but distinct skeleton: H1 matching the title, one sentence stating the reader problem, then `Purpose`, `When to use this page`, `Behavioral contract`, `Failure and recovery`, `Change map`, and `Related pages` in that order. Anchors are allowed only in the first five sections, each needing at least one distinct closed-list key. The rules add quantitative targets — 500–900 prose words, never above 1,400 — and require at least 75% of cited keys to be non-test product symbols. A distinctive constraint here is how to name source symbols: they must appear as inline code with the exact closed-list key (e.g. `app/services/bgm.py#save_bgm_upload`) lead by a human-readable role, never as Markdown links to source paths since those live outside the wiki and would not resolve. Related pages link only to supplied existing paths with exact relative forms, and frontmatter `modules`, `flows`, and `anchors` must be YAML block lists — never comma-joined scalars, which parse as one string and fail validation. The array closes by banning absolute words like "only", "always", or "never" unless the supplied source proves the scope and names the controlling guard.

Diagram generation is parameterized through a budget object and a builder function:

```ts
export const FLOW_DIAGRAM_DEFAULT_BUDGET = { maxNodes: 12, maxEdges: 20 } as const;
```

This constant sets the default ceiling for how many nodes and edges a generated flow diagram may contain. It is the size limit the orchestrator applies when no explicit budget is given, keeping diagrams focused rather than sprawling.

```ts
export function buildModuleDiagramPromptRules(budget: FlowDiagramBudget): readonly string[] {
```

This function takes a `FlowDiagramBudget` — an object with `maxNodes` and `maxEdges` fields — and returns a list of prompt rules that constrain how the module diagram must be drawn. It interpolates the budget values directly into the rule text, so the model knows the exact node and edge ceilings before it starts composing. The rules require exactly one H2 `Diagram` section containing a single Mermaid fenced block, drawn at MODULE granularity (files, classes, or components) rather than one node per symbol. They also forbid the model from writing a `%% livewiki/...` placeholder comment — the orchestrator extracts the real diagram and substitutes the on-disk placeholder itself — and require the `Diagram` section to carry no `lw:anchors` marker.

Two rules shape the internal organization of module pages. `DEEP_HIERARCHY_PROMPT_RULE` activates when a module has 8 or more symbols: instead of a flat symbol list, the model must group symbols under concept-named H2 sections (e.g., "Parsing", "Scheduling") with H3 subsections per symbol or tight cluster. Each concept H2 carries exactly one `lw:anchors` marker listing the keys its subsections document, followed by real prose. `FILE_NARRATIVE_PROMPT_RULES` is the general storytelling charter for implementation sections: organize around the mechanism the file implements, start each section with *why* then *how*, explain behavior step by step while naming real symbols in inline code, and never write a `Tests` section — the orchestrator appends the test pointer itself. This array also contains the critical warning about the manual-block control marker: the literal HTML comment whose body names `lw:manual` must never appear in the page, not even inside a fenced example, because the validator rejects it byte-for-byte and only the orchestrator may re-inject human-owned manual blocks.

Three final rules police precision and authority. `LITERAL_SIGNATURE_PROMPT_RULE` mandates that when a section asserts behavior of a named function or method and the symbols table supplies a non-empty signature, the model must copy that signature byte-for-byte into the section *before* the behavioral explanation, followed by one plain-language sentence saying what the symbol takes and returns. `EXCEPTION_BRANCH_PROMPT_RULE` requires the model to describe any visible `throw`, `catch`, fallback, rollback, early return, or fail-open/fail-closed branch, or explicitly scope the prose to the normal path — absolute language like "guarantees" or "mandatory" is forbidden while a visible exception exists. `INVENTORY_AUTHORITY_PROMPT_RULE` declares the closed key list and symbol/file inventory authoritative for inventory facts, so the model must never copy stale counts or file lists from README text or excerpt prose. `BRANCH_PRECISION_PROMPT_RULE` demands exactness when describing bounds, clamping, or validation: state which side is enforced and which input shapes each check covers, never generalizing a one-sided check into a two-sided invariant.

Together, these constants and builders form a compact rule language. The page-type arrays compose the shared editorial rules with type-specific structural contracts, the builder function parameterizes diagram constraints, and the standalone rules refine how the model handles signatures, exceptions, inventory facts, and bounds — all so the orchestrator can assemble a complete, verification-safe prompt for any page without drifting from a single canonical source.

## Sanitizing Untrusted Content for Prompt Embedding
<!-- lw:anchors packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#renderRationaleEvidenceBlock packages/core/src/prompts.ts#renderProseEvidenceBlock packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors -->

The file's prompt-embedding pipeline must never let untrusted content inject its own instructions or structural directives into the LLM prompt. User-authored text, code comments, and prose from arbitrary files can contain backtick fences, tilde fences, or `lw:*` control markers that would otherwise be interpreted as literal syntax by the model or by downstream tooling. This section of the file implements a defense-in-depth sanitization chain: it first neutralizes any control markers that look like the file's own directives, then wraps the remaining untrusted content in a fence that is guaranteed not to be closable by anything inside it, so that no embedded run of backticks or tildes can escape the quoted block.

The first step is measuring the longest consecutive run of a fence character in a candidate string, because a closing fence is any run of the same character at least as long as the opening one. `longestRunOf(text: string, char: "`" | "~"): number` scans the text with a character-specific regex (`/`+`+/g` for backticks, `/`~`+/g` for tildes), tracks the length of each match, and returns the maximum run length found. It takes the text and the fence character, and returns the integer length of the longest run — this value drives every fence-length decision that follows.

When the longest run would be too long to fence safely, `boundEncodeLongRuns(text: string, char: "`" | "~", cap: number): string` modifies the text so that no run exceeds a cap. It builds a regex for runs of the given character of length `cap` or more, and for each match it splits the run into chunks of `cap - 1` characters joined by a space. The function takes the text, the character to bound, and the maximum allowed run length, and returns the text with any overlong runs broken into space-separated chunks — this guarantees the result contains no run longer than `cap - 1` for that character.

`selectSafeFence(enclosed: string): { fence: string; content: string }` picks a fence and, if necessary, an encoded content pair. It computes the backtick run; if that run plus one fits within `SAFE_FENCE_MAX_LEN`, it returns a backtick fence of length `max(3, backtickRun + 1)` and the original content unchanged. If backticks are pathologically long, it tries tildes the same way. If both characters have runs too long even for a capped fence, it falls back to a tilde fence of exactly `SAFE_FENCE_MAX_LEN` and applies `boundEncodeLongRuns` to both character classes, so the encoded content's longest surviving run is at most `SAFE_FENCE_MAX_LEN - 1` — the CommonMark rule that a closing fence must be at least as long as the opening one then guarantees the content cannot close the fence. The function takes the enclosed text and returns an object with the chosen fence string and the content to place inside it.

`wrapInSafeFence(enclosed: string): string` assembles the final quoted block: it calls `selectSafeFence` to get the fence and content, then joins them as `fence + "\n" + content + "\n" + fence`. It takes the untrusted text and returns a fenced triple-backtick-or-tilde block, ready for embedding.

The other half of the sanitization deals with control markers. Any occurrence of an `lw:*` directive inside untrusted content must be rendered inert, because otherwise the model could mistake it for a real instruction. `neutralizeUntrustedControlMarkers(text: string): string` replaces every match of `LW_CONTROL_MARKER_RE` with an equal number of spaces, leaving the text's overall shape intact but removing the directive's semantic force. It takes the raw untrusted text and returns the same text with all control markers blanked out.

The evidence-rendering helpers apply both layers in sequence. `renderRationaleEvidenceBlock(rationaleEvidence: string | undefined): string[]` returns an empty array if the evidence is undefined or whitespace-only; otherwise it returns a header line explaining that the following rationale evidence is untrusted, that it may hint at intent but must never supply anchor keys, and that any `lw:*` markers inside have been neutralized — followed by `wrapInSafeFence(neutralizeUntrustedControlMarkers(rationaleEvidence))` and a blank line. It takes the raw rationale string and returns a list of lines ready to be appended to the prompt.

`renderProseEvidenceBlock(proseEvidence: string | undefined): string[]` follows the same pattern for prose from files that have no canonical keys. It also returns an empty array for empty input; otherwise it emits a header warning that the prose is untrusted, that the files can never appear in the closed list, that the model should describe what they visibly do without citing or inventing anchors — then the fenced, neutralized content and a blank line. It takes the raw prose string and returns a list of prompt lines.

Finally, `neutralizeUntrustedControlMarkersExceptValidAnchors(text: string, closedKeyList: ReadonlyArray<string>): string` is the strictest variant: it permits one narrow kind of marker to survive. It builds a `Set` from the closed key list, then on each `LW_CONTROL_MARKER_RE` match it attempts to parse the match as a strict anchor marker of the exact shape `<!-- lw:anchors key1 key2 ... -->`. Only if that parse succeeds, the key list is non-empty, and every key is in the closed set does it return the match unchanged; in every other case it blanks the match with spaces. The function takes the untrusted text and the closed key list, and returns the text with all markers neutralized except the valid anchors block — so the prompt can carry an explicit anchor list without letting any other directive through.

## Stage 4 Module Page Generation
<!-- lw:anchors packages/core/src/prompts.ts#buildStage4Prompt -->

`buildStage4Prompt` is the constructor of the prompt pair that drives the final artifact-generation step of the pipeline. Its job is to turn the module's parsed metadata — the authoritative closed key list, the symbol table, and the truncated source — into a `PromptPair` whose `system` message encodes the strict invariants the generated page must satisfy, and whose `user` message carries the concrete, task-specific data the model must work from. The function assembles these two halves separately and returns them together.

The function begins by resolving the module's role, which determines which rule sets apply:

```ts
export function buildStage4Prompt(
  module: Module,
  closedKeyList: string[],
  symbolsTable: string,
  truncatedSource: string,
  language: Language = "en",
  moduleRoleOverride?: PathRole,
  rationaleEvidence?: string,
  formatOptions?: Stage4FormatOptions,
): PromptPair {
```

It takes the module object, the closed list of canonical anchor keys, the serialized symbol table, the source excerpt, an optional language override (defaulting to `"en"`), an optional role override, optional rationale evidence, and optional formatting options; it returns a pair of `system` and `user` strings. The effective role is `moduleRoleOverride ?? classifyModuleRole(module)` — an explicit override wins, otherwise the module's own classification is used.

Based on that role, the function chooses the auxiliary contract rules. For a `"product"` module it uses no compaction rules; for any other role (benchmark, fixture, documentation, tooling) it pushes rules that require a single `## Reference` section with one H3 per anchored symbol, a single short grounded sentence per symbol, a signature only for real exported entry points whose signature changes usage, and an honest statement of the auxiliary role. These rules, plus a fixed set of global invariants, are assembled into the `system` string via `.join("\n")`. That global block covers the page opening rules, the exact-key-copy authority of the closed list, the completeness requirement (frontmatter anchors and section markers must each independently contain every closed key exactly once), the primary-section rule (each key lives in exactly one section marker), the ban on aggregate or roundup markers, the requirement that every marker be followed by real prose, closed-Markdown hygiene, the `TODO`/`TBD` ban, and the explicit rejection criterion for an `lw:manual` block. Formatting options add targeted rules when present: `moduleDiagrams` injects diagram-specific requirements, and `deepHierarchy` adds its own rule.

The `user` half is built as a list of parts, joined at the end. It opens with the language line and the file or module identification (single-path modules name the file, multi-path modules name the module id), followed by the suggested display title if one exists, the path list, and the symbol count. Then it renders the authoritative closed list — each key on its own `- ` line — and states explicitly that these are the only valid anchor keys.

Next the function branches on whether the closed list is empty. If it has keys, it emits a concrete syntax example inside a fenced code block, showing a heading, a marker built from up to two real keys from the closed list, and a prose placeholder. If the list is empty, it instead pushes a zero-key contract: still generate a useful, complete page grounded in the paths and source, include the required page opening, use unanchored implementation sections, emit no frontmatter anchor entries, and never invent keys to fake anchoring.

Finally, the function neutralizes any `lw:*` control markers in the truncated source before embedding it. It appends the symbol table, the rationale-evidence block if supplied, the neutralized source wrapped in a safe fence, a forbidden note restating the `lw:manual` ban, and the output line naming the target page. The `system` and `user` strings are returned together as the `PromptPair`, ready for the model call that produces the module page.

## Stage 5 Flow and Topic Page Builders
<!-- lw:anchors packages/core/src/prompts.ts#buildStage5Prompt packages/core/src/prompts.ts#buildStage5RepairPrompt packages/core/src/prompts.ts#buildFlowGroupBlock packages/core/src/prompts.ts#buildFlowSectionAssignmentBlock packages/core/src/prompts.ts#buildTopicSectionAssignmentBlock packages/core/src/prompts.ts#buildTopicRefinePrompt packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRepairPrompt packages/core/src/prompts.ts#formatTopicGroups -->

The Stage 5 page builders are the final prompt-construction layer: they take a validated candidate (a `FlowCandidate` or a `TopicCandidate`), a closed list of canonical symbol keys, and supporting evidence (module digests, symbol tables, truncated source), and turn them into the exact `{ system, user }` prompt pair that drives the LLM. Their job is not just to assemble text — it is to encode the livewiki contract so rigorously that the model cannot drift from it: every anchor key must be copied byte-for-byte from the closed list, every cited key must appear exactly once in the frontmatter anchors list and exactly once in a section marker, and the page structure must match a fixed template. The builders fall into two families — flow page builders and topic page builders — and they share a set of helper blocks that render the key-grouping and section-assignment constraints into prompt text.

## Shared constraint blocks

Before the page-specific builders assemble their prompts, two helpers render the structural constraints that are common to the flow and topic families. Both produce arrays of Markdown lines that the callers splice into the user message, and both return empty arrays when no map is supplied, so the general prompt text can be reused whether or not a specific grouping exists.

`buildFlowGroupBlock` turns the flow's semantic key groups into an instruction the model must obey. It takes the closed key list and an optional `FlowKeyGroups` map, and filters each of the three tier lists — `entryKeys`, `boundaryKeys`, and `sinkKeys` — down to keys that actually appear in the closed list. For each tier with surviving keys it emits a line like `- entry keys: k1, k2`, and if any such lines exist it wraps them under a header explaining that the page MUST cite at least one key from each listed group. This is the mechanism that makes the "tier-coverage" rule checkable: the validator later confirms that every group listed here has at least one cited key, so the block's job is to make the requirement visible in the prompt itself.

`buildFlowSectionAssignmentBlock` handles the inverse constraint — where each key's anchor marker may live. Given a `FlowKeySectionMap` (a mapping from key to one of the three required flow sections: `purpose`, `ordered-flow`, or `failure-and-recovery`), it buckets keys by section and renders one bullet per non-empty section under a header that says the assignment is "AUTHORITATIVE AND FIXED": the key's marker must appear only in the named section. The section labels are human-readable (`purpose` → "Purpose", etc.), and the bullet lists the assigned keys joined by commas. When the map is absent or empty, the function returns an empty array, leaving the prompt's fallback "primary-section" rule to apply instead.

The topic-family counterpart, `buildTopicSectionAssignmentBlock`, does the same bucketing work for topic pages but over five required sections: `purpose`, `when-to-use-this-page`, `behavioral-contract`, `failure-and-recovery`, and `change-map`. It iterates the sections in a fixed display order, emits one bullet per non-empty section, and its header adds a topic-specific warning: the "Change map" section must NOT re-list a key already assigned elsewhere. This prevents the model from duplicating a key's marker across sections, a rejection the validator would catch.

A third helper, `formatTopicGroups`, is referenced in the source slice but its body is not visible in the supplied budget; from its name and signature (`groups: TopicKeyGroups` → `string[]`), it is the topic-side analog of `buildFlowGroupBlock` — it converts the topic's evidence groups (the `contract`, `state`, `output`, and `failure` buckets seen in the JSON schema of `buildTopicRefinePrompt`) into prompt lines that state which group each key belongs to, so the builder can cite the same group structure in the topic pages.

## Flow page generation

`export function buildStage5Prompt(` is the primary entry point for producing a flow page. Given a `FlowCandidate`, the closed key list, the participating modules' page digests (`moduleOpenings`), the symbol table, and the truncated source, it returns a `PromptPair` — the `system` and `user` messages that the orchestrator sends to the model.

The function first derives a small example from the closed list: it takes up to two keys to build a sample marker line used purely for syntax illustration. It then calls the two shared helpers — `buildFlowGroupBlock` and `buildFlowSectionAssignmentBlock` — to obtain the constraint blocks, and proceeds to assemble the `system` message as a single long string.

The `system` message is the heart of the contract. It opens with the model's role — a technical documentation generator for livewiki that receives one flow candidate, a closed key list, a module digest, a symbol table, and a bounded source excerpt, and must output ONE flow page in prose only, with no `Diagram` section (the orchestrator generates the diagram deterministically). It then lists strict output rules: the frontmatter must carry `title`, `owner: generated`, `anchors` (a YAML list), `updated`, and `modules`; anchor keys must be copied byte-for-byte from the closed list, never invented; `lw:anchors` markers must never be abbreviated with ellipses; markers inside fenced code blocks are not parsed; and each cited key must appear exactly once in the frontmatter anchors list AND exactly once across section markers.

The section-assignment handling is conditional: if a `flowKeySectionMap` is present and non-empty, the system message inserts a rule stating the assignment is fixed and the model must copy each key into the named section's marker only. If no map is supplied, it falls back to a "primary-section" rule: put each key in exactly one marker, the section that primarily documents it. The message continues with invariants (frontmatter anchors only from the closed list, modules list equal to the candidate set, fully closed Markdown) and a long rejection-criteria list that mirrors the validator's checks: missing frontmatter, invented keys, keys on only one side, duplicate keys, markers with no following prose, unclosed fences, TODO/TBD text, empty pages, `lw:manual` blocks (reserved for human content, only the orchestrator can re-inject them), missing required flow sections, or a module list mismatch.

The `user` message then delivers the concrete inputs: the language, flow slug and title seed, the participating module IDs, detection signals, the current date, and the closed key list rendered as one bullet per key. After that it splices the `flowGroupBlock` and `sectionAssignmentBlock` lines, then — if the closed list is non-empty — adds a concrete marker-syntax example in a fenced code block showing a `Purpose` heading with a marker followed by prose. The module openings and source excerpt are passed through `neutralizeUntrustedControlMarkers` and wrapped in a safe fence, the symbol table is appended verbatim. The message ends with a FORBIDDEN directive against emitting an `lw:manual` block, and the output instruction: a complete Markdown flow page at the candidate's slug path, prose only.

## Flow page repair

`export function buildStage5RepairPrompt(` is the correction pass for a rejected flow page. It takes the same candidate context plus the prior candidate text, the validator's structured errors, a character budget for the prior candidate, and a repair-attempt counter. It returns a `PromptPair` whose `system` message re-frames the model as a repair assistant.

The repair builder computes the attempt context: `isFinal` becomes true when the attempt number reaches the total, and the message tags the run accordingly — a non-final attempt is labeled "Repair attempt N of total", while the final one is marked "FINAL repair attempt in the current bounded execution" with a directive not to reproduce the prior candidate unchanged. It reuses `buildFlowGroupBlock` and `buildFlowSectionAssignmentBlock` so the repair prompt presents the same tier-coverage and section-assignment constraints as the original generation, keeping initial and repair runs from drifting on those requirements.

The `system` message repeats the hard constraints from the initial prompt (frontmatter fields, byte-for-byte key copying, no abbreviation, one marker per key, section assignment fixed when a map exists) and then adds error-specific repair instructions. For `anchor_outside_closed_list` errors, it directs the model to remove the offending anchor entirely rather than substitute another key. For `missing_closed_key` errors, it explains that they are grouped by location — frontmatter or section markers — and the model must add the exact missing key to that group's named target (or remove it from the opposite side to restore consistency). It covers `empty_section` errors by demanding real prose after each marker, `unclosed_markdown` by closing all fences and code spans, and `todo_marker_present` by replacing the placeholder with a concrete factual sentence about visible context. It again forbids `lw:manual` blocks and, on the final attempt, appends a full audit checklist: verify the required flow opening, that every cited key is in frontmatter, that every cited key appears exactly once across markers, and that every structured error is fixed.

The `user` message opens with the language, the attempt tag, and on the final attempt the audit checklist. It repeats the flow identity, participating modules, current date, and closed key list, then splices the same `flowGroupBlock` and `sectionAssignmentBlock`. The module digest, symbol table, and source are neutralized and fenced as before. The structured errors are rendered line by line — each with its code, location (section slug, frontmatter, or other), a neutralized message and offending token, and an `ACTION` directive appended via `renderActionDirective`, which draws from the closed repair contract for the exact per-code action text. `missing_closed_key` errors are special-cased: instead of one line per error, they are grouped by location into a block stating how many keys are missing, what to do, and listing the exact keys to add or remove. A `renderReportOnlyBlock` appends any additional report-only errors. Finally, the prior candidate is truncated to `maxCandidateChars`, passed through `neutralizeUntrustedControlMarkersExceptValidAnchors` so that section markers whose keys are all in the closed list survive as a correct syntax reference while every other `lw:*` marker is neutralized, and wrapped in a safe fence with a warning that preservation is not an instruction to keep every occurrence — a `duplicate_anchor` error means deleting the extras. The output instruction completes the message, asking for a corrected flow page with no `Diagram` section.

## Topic page planning and generation

The topic family opens with `export function buildTopicRefinePrompt(`, which serves the planning stage: it takes an already-valid list of topic proposals and asks the model to refine the plan within strict bounds. The `system` message defines the model as an information-architecture editor. It may reword titles and intents for clarity, merge two topics that share at least one module (unioning modules, flows, and groups exactly), or drop a topic that is redundant — but it may NOT add a module, flow, or anchor not already present, invent a new topic, or move an anchor to a different evidence group. The output must be JSON with the same schema as the input (`{"topics":[{"title":"...","intent":"...","modules":[...],"flows":[...],"groups":{"contract":[...],"state":[...],"output":[...],"failure":[...]}}]}`), with distinct titles, at most 80 characters for a title and 160 for an intent, no line breaks, and no more than `maxTopics` topics. The `user` message is minimal: the language, a note that the proposal is deterministic and already valid (so edits must stay within the rules), the proposals serialized as pretty JSON, and the instruction to output refined JSON only, with no prose or fences.

Then comes `export function buildTopicPrompt(`, which produces the actual topic page. It takes a `TopicCandidate`, a module digest, the symbol table, the source evidence, and an optional `TopicKeySectionMap`, plus optional `rationaleEvidence` and `proseEvidence` in the source slice (their use is not fully visible in the truncated budget). The function first calls `buildTopicSectionAssignmentBlock` to obtain the section-assignment lines. Its `system` message defines the model as a generator of "one concise semantic topic page from an accepted, closed evidence bundle." It states that frontmatter fields are exact — `title`, `owner: generated`, `kind: topic`, `order`, `intent`, `modules`, `flows`, `anchors`, `updated` — and that the order, modules, and flows must equal the supplied accepted values. When the section-assignment block is non-empty, it inserts the fixed-assignment rule, again emphasizing that "Change map" must not re-list a key already marked elsewhere. It includes the same exception-branch, inventory-authority, and branch-precision rules as the flow prompts, requires byte-for-byte key copying, and treats rationale evidence as untrusted. The message begins to state "Do not emit an lw:manual blo..." but is truncated at the budget boundary; the visible content establishes the same pattern of contractual constraints applied to the topic page shape.

## How the two families relate

The flow builders and topic builders are structurally parallel but semantically distinct. The flow builders enforce a three-section contract (`purpose`, `ordered-flow`, `failure-and-recovery`) with tiered evidence groups; the topic builders enforce a five-section contract (`purpose`, `when-to-use-this-page`, `behavioral-contract`, `failure-and-recovery`, `change-map`) with evidence groups keyed by contract/state/output/failure. Both share the same defensive posture: untrusted input (module digests, source, prior candidates, even error messages) is run through `neutralizeUntrustedControlMarkers` so the model never sees a copyable `lw:*` control marker, and both explicitly forbid emitting an `lw:manual` block, which is reserved for human content that only the orchestrator may re-inject. The repair builder adds one more layer — it reuses the exact same constraint blocks as the initial builder, groups revision instructions by error code, and on the final attempt demands a genuinely distinct page rather than a re-submission of the rejected candidate. Together, these builders ensure that every stage-5 prompt carries the full livewiki validation contract inline, so the model's output is structured to pass the validator on the first (or repaired) attempt.

## Understanding and Folder Purpose Prompts
<!-- lw:anchors packages/core/src/prompts.ts#UNDERSTANDING_PAGE_PROMPT_RULES packages/core/src/prompts.ts#buildUnderstandingPrompt packages/core/src/prompts.ts#buildUnderstandingRepairPrompt packages/core/src/prompts.ts#FOLDER_PURPOSE_PROMPT_RULES packages/core/src/prompts.ts#buildFolderPurposePrompt packages/core/src/prompts.ts#buildFolderPurposeRepairPrompt -->

The "Understanding and Folder Purpose Prompts" section of `prompts.ts` centralizes the construction of the two prompt families that generate the top-level "understanding" page and the per-folder "purpose" paragraphs of a wiki. Both families share the same architectural concern: separate a fixed, rule-bearing *system* prompt from an evidence-bearing *user* prompt, and provide a repair variant that receives the validator's rejection reasons to drive a bounded correction loop. The exported rule arrays and builder functions work together to keep these prompts consistent across generation and repair phases, and to prevent the model from treating validator output or prior candidates as authoritative instruction.

### `UNDERSTANDING_PAGE_PROMPT_RULES` and `buildUnderstandingPrompt`

`UNDERSTANDING_PAGE_PROMPT_RULES` is the ordered list of constraints that define the repository-understanding page's contract: it begins with the shared `LAY_READER_PROMPT_RULE` and `NO_REASONING_WRAPPER_PROMPT_RULE` (imported from elsewhere in the module), then adds page-specific rules governing the exact frontmatter keys (`title`, `owner: generated`, `kind: understanding`, `updated`), the single-purpose paragraph's character budget (40–600, aiming for 400–550), and the optional `Where to look in the code` section's bullet count and length limits. The array also forbids inline code, Markdown links, and images, and mandates that every claim trace to the supplied evidence inventory — with the wiki evidence outranking the README excerpt when they conflict. These rules are declared `as const` and are reused verbatim by both the initial and repair prompt builders, guaranteeing that the model never sees a different contract on retry.

`buildUnderstandingPrompt` assembles the initial generation request:

```ts
export function buildUnderstandingPrompt(
  evidenceBlock: string,
  language: Language = "en",
): PromptPair
```

It takes the closed evidence inventory as a string and an optional language code (defaulting to `"en"`), and returns a `PromptPair` object with `system` and `user` fields. The function joins the fixed system identity lines with a spread of `UNDERSTANDING_PAGE_PROMPT_RULES`, then builds the user prompt by labeling the language and current date (derived from `new Date().toISOString().slice(0, 10)`), and wraps the evidence in a safe fence via `wrapInSafeFence(neutralizeUntrustedControlMarkers(evidenceBlock))` — the latter neutralizing any `lw:*` control markers so the model treats the evidence as data, never as directives. The user prompt concludes with the target output path `livewiki/understanding.md`, anchoring the model's task to the file it must produce.

### `buildUnderstandingRepairPrompt`

`buildUnderstandingRepairPrompt` handles the case where the validator rejects the first generated page. Its signature:

```ts
export function buildUnderstandingRepairPrompt(
  evidenceBlock: string,
  priorCandidate: string,
  errors: ReadonlyArray<{ code: string; message: string }>,
  maxCandidateChars: number,
  language: Language = "en",
  attemptContext: RepairAttemptContext = { attempt: 1, total: 1 },
): PromptPair
```

It accepts the same evidence block, the previously rejected page, a list of validator errors (each with a `code` and `message`), a character cap for the rejected page, the language, and an `attemptContext` describing the current attempt number out of a total. The function first delegates to `buildUnderstandingPrompt` to obtain the initial `user` prompt, then derives `isFinal` from comparing `attempt` against `total`. It maps each error to a scoped directive: for `purpose_too_long` it instructs the model to shorten only the purpose paragraph (with a concrete target under 520 characters); for `purpose_too_short` it directs expansion of exactly that paragraph; for `surface_too_long` it targets only the oversized bullets. Any other error code triggers a generic "fix exactly this contract violation" instruction. Each directive embeds the neutralized error message via `neutralizeUntrustedControlMarkers(error.message)` so validator text cannot inject prompt behavior. The repair system prompt opens with the repair assistant identity and whether this is the final bounded attempt, spreads the same `UNDERSTANDING_PAGE_PROMPT_RULES`, and — when `isFinal` — adds a `FINAL ATTEMPT DIRECTIVE` demanding a genuinely distinct page rather than a verbatim reproduction. The user prompt reuses the initial `user` content, then appends the rejected page truncated to `maxCandidateChars` inside a safe fence, and finally asks for the corrected complete Markdown page. This design narrows the model's edit focus to the specific failing field, avoiding the flailing behavior observed when a full rewrite was requested.

### `FOLDER_PURPOSE_PROMPT_RULES` and `buildFolderPurposePrompt`

`FOLDER_PURPOSE_PROMPT_RULES` defines the contract for the folder-purpose paragraph — a shorter, more constrained output than the understanding page. It shares the same lay-reader and no-reasoning-wrapper base rules, then specifies: a single prose paragraph (at most two) synthesizing the directory's role — never a per-file concatenation; a character budget of 40–800 (aiming for 400–700); plain prose only, with no frontmatter, headings, code fences, or links (inline code spans for file names are allowed); mandatory traceability to the deterministic file inventory and accepted file-page openings; and an explicit prohibition on enumerating every file, since the file guide already does that. The rules also warn against adjective-stacking and placeholders like "TODO", favoring shorter honest paragraphs over padded filler.

`buildFolderPurposePrompt` constructs the initial request:

```ts
export function buildFolderPurposePrompt(
  contextBlock: string,
  language: Language = "en",
): PromptPair
```

It takes the directory evidence block and an optional language, returning a `PromptPair`. The system prompt states the task — writing the purpose paragraph of one folder page — asserts that all claims are verify-gated by the inventory and file-page openings, and spreads `FOLDER_PURPOSE_PROMPT_RULES`. The user prompt labels the language, wraps the directory evidence in a safe fence after neutralizing control markers, and ends with an explicit output spec: "the folder purpose paragraph (plain prose, 40–800 characters)". This explicit character range in the user prompt serves as a final reminder before the model begins its work.

### `buildFolderPurposeRepairPrompt`

`buildFolderPurposeRepairPrompt` mirrors the understanding repair flow but for the shorter paragraph output:

```ts
export function buildFolderPurposeRepairPrompt(
  contextBlock: string,
  priorPurpose: string,
  errors: ReadonlyArray<{ code: string; message: string }>,
  maxCandidateChars: number,
  language: Language = "en",
  attemptContext: RepairAttemptContext = { attempt: 1, total: 1 },
): PromptPair
```

It takes the same context block, the rejected prior paragraph, the validator errors, a truncation cap, the language, and the attempt context. The function starts from `buildFolderPurposePrompt` to reuse its `user` prompt, then branches on the error code. For `folder_purpose_too_long`, it does something the understanding repair does not: it computes `priorLength` by trimming and collapsing whitespace in `priorPurpose`, derives `mustDelete` as the excess over 650 characters (the safety-margin target), and instructs the model to delete at least that many characters, warning that one clause is rarely enough. This numeric directive turns a vague "shorten it" into a measurable target. For `folder_purpose_too_short`, it asks for one additional evidence-backed clause. All other error codes fall through to a generic "fix exactly this contract violation" without allowing the model to empty the paragraph as a workaround. The system prompt follows the same repair-assistant pattern: attempt counter, final-attempt directive when applicable, the shared `FOLDER_PURPOSE_PROMPT_RULES`, and the error-specific ACTIONs. The user prompt reuses the initial request, then presents the truncated prior paragraph as data and requests the corrected paragraph.

Across all four builders, several invariants hold: the rule arrays are shared between initial and repair prompts so the contract never drifts; every untrusted input — evidence blocks, error messages, prior candidates — passes through `neutralizeUntrustedControlMarkers` before being wrapped by `wrapInSafeFence`; and the repair prompts always embed the full original prompt context, so the model has the same evidence available on retry. The two families differ mainly in output complexity — the understanding page is a multi-section Markdown file with frontmatter, while the folder purpose is a single plain-prose paragraph — and the repair directives are correspondingly scoped: the understanding repair targets specific fields (purpose paragraph, surface bullets), while the folder repair applies a character-arithmetic directive when length is the only problem. This design keeps the model's job tightly bounded by the validator's actual complaint, converging faster than a full rewrite would.

## File Opening, Plan, and Section Builders
<!-- lw:anchors packages/core/src/prompts.ts#buildFileOpeningPrompt packages/core/src/prompts.ts#buildFilePlanPrompt packages/core/src/prompts.ts#buildFileSectionPrompt -->

The three prompt builders in this file are the front door of the documentation pipeline: each one takes raw inputs about a source file and returns a `PromptPair` (a system message plus a user message) that drives a distinct stage of the wiki page’s generation. They are coordinated by the orchestrator, which calls them in sequence — first the opening, then the plan, then each section — so the functions define what the model is asked to do at every step.

`buildFileOpeningPrompt` sets up the very first call. It accepts the file path, a pre-rendered symbol table, the (possibly truncated) source, and a language option, and returns a `PromptPair` whose system message instructs the model to act as a documentation generator focused exclusively on the page’s opening block. The function assembles the system prompt by joining a fixed set of rules (pulled from shared constants like `PAGE_OPENING_PROMPT_RULES` and `FILE_NARRATIVE_PROMPT_RULES`) with a directive that the output must contain only the H1, the one-line responsibility statement, the “When to use this page” bullets, and the “How it fits” paragraphs — no frontmatter, no implementation sections, and no anchor markers. The user message then concatenates the language, file path, symbol table, and the source code, which is first passed through `neutralizeUntrustedControlMarkers` (so any `lw:*` directives in the source can’t leak into the prompt) and wrapped in a safe fence via `wrapInSafeFence` to keep it as data. The result is a self-contained prompt that elicits just the page’s top matter.

Next, `buildFilePlanPrompt` is the planning stage for the whole page. It takes the file path, a closed list of canonical symbol keys, the symbol table, the truncated source, and the language, and returns a `PromptPair` that asks the model to design a section plan. The system prompt frames the model as a technical documentation planner whose job is to lay out the page as one coherent mechanism, not a list of symbols. It mandates a single fenced JSON object with a `sections` array, where each section has a heading and an array of `keys` that must be copied byte-for-byte from the provided closed list. The prompt enforces a strict partition: every key must appear exactly once across all sections, and the plan must contain between three and eight sections, ordered with entry points first, internals after, and failure or recovery last. The user message supplies the closed list as an authoritative set of bullet points, the symbol table, and the fenced, neutralized source, ending with a directive to output only the fenced JSON plan. This function is what gives the orchestrator the blueprint it later feeds into the per-section builder.

Finally, `buildFileSectionPrompt` is the workhorse for each section the plan produced. It takes the file path, the section’s H2 heading, the list of section-specific keys, the symbol table, the section’s source slice, a boolean flag `sourceTruncated`, and the language, and returns a `PromptPair` that asks for the prose of exactly one section. The system prompt instructs the model to write only the explanatory prose — the heading and anchor marker are owned by the orchestrator — and to explain the mechanism step by step, naming the real symbols in inline code. It references the shared `LITERAL_SIGNATURE_PROMPT_RULE` constant, which enforces the convention that when a function’s signature is available in the symbol table, the prose must reproduce it byte-for-byte before describing behavior. The `sourceTruncated` flag adjusts the instruction: if the slice was cut for token budget, the model is told to describe only what is visible and never invent behavior for unseen code; otherwise, it’s told the slice is complete. The user message assembles the language, file path, heading, symbol table rows, and the fenced, neutralized source slice, and closes with a request for the prose of that named section. This function thereby turns the plan from a list of headings into actual page content, one section at a time, while keeping the model’s focus narrow and its inputs sanitized.

## Repair Pipeline
<!-- lw:anchors packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildSurgicalRepairPrompt -->

The repair pipeline is the mechanism that turns a validator-rejected documentation artifact into a corrected page. It has two entry points with different scopes: `buildRepairPrompt` regenerates an entire module page after a full validation failure, while `buildSurgicalReprompt` limits changes to the specific H2 sections that produced section-scoped errors.

`buildRepairPrompt(module, closedKeyList, symbolsTable, truncatedSource, priorCandidate, errors, maxCandidateChars, language, attemptContext, moduleRoleOverride, rationaleEvidence, formatOptions)` is the full-page repair path. The caller passes the module to document, the authoritative closed list of anchor keys, the symbol table, a token-budget-truncated source slice, the previously rejected candidate page, the structured validation errors, and a character budget for how much of the prior candidate the model may see. The function returns a `PromptPair` of system and user messages that instruct the model to produce a corrected Markdown page.

The function first determines the module's role — either from `moduleRoleOverride` if provided, or by classifying it with `classifyModuleRole(module)`. For non-product modules it appends "compact auxiliary" rules that forbid the auxiliary sections from becoming product-runtime narratives. It then derives `isFinal` from `attemptContext` — a boolean that reports whether this is the last repair attempt in the current bounded execution, and builds an `attemptTag` that labels the attempt as final or not. The final-attempt status gates two pieces of content: a final directive in the system message warning against reproducing the prior candidate unchanged, and an audit checklist block that reminds the model of the required page opening, frontmatter anchors, and section-marker coverage.

The system message assembles the hard constraints as a joined array of lines. It opens with the repair-assistant role, the attempt tag, and a statement that the previous attempt was rejected. It then spreads in the standard page-opening rules, the compact auxiliary rules, and — for single-path product modules — the file-narrative and literal-signature rules. The message hard-codes the authority of the closed key list, requiring byte-for-byte copying and forbidding invented keys or placeholder tokens. It includes the complete rules for `lw:anchors` markers: never abbreviate them, never use ellipsis characters, never put real markers inside fenced code blocks, and never emit an aggregate summary marker. It then handles the two most important error classes with explicit directives: `anchor_outside_closed_list` errors demand deleting the offending anchor entirely (never substituting another key), while `missing_closed_key` errors demand adding each missing key only to the location named in the error. The message also covers empty sections, unclosed Markdown fences, placeholder tokens, and the hard rule that no `lw:manual` block may appear in output.

A distinct part of the message construction is the error grouping and neutralization. The function partitions the incoming errors into two buckets: `missing_closed_key` errors whose location is frontmatter or section are grouped by location into `groupedMissingKeys`, while all other errors — including `missing_closed_key` errors with other locations — pass through to the individual error-lines list. Each surviving error becomes a structured line that includes the error code, location (suffixed with the section slug if present), the error message, and the offending text. Both the message and the offending text are passed through `neutralizeUntrustedControlMarkers`, because they are untrusted strings from the model's own page that could contain a copyable control marker; the neutralization ensures no such marker can leak into the prompt. After building the line, the function appends a machine-generated `ACTION` directive from `renderActionDirective("module", e, …)`, using the closed repair contract's verbatim texts, and then re-neutralizes the completed line as defense-in-depth.

For each grouped missing-key location, the function emits a block that lists how many keys are missing and where they must be added: exactly one YAML list entry per key in frontmatter, or exactly one primary section marker per key in the section body. Each key is itself neutralized before being listed, preventing stale or untrusted keys from reintroducing control markers.

The user message is assembled from several data blocks. It begins with the language, the attempt tag, and either a final-attempt directive or a generic audit reminder. If this is the final attempt, it includes the full audit checklist. It then lists the module name or path, an optional suggested display title, all module paths, and — critically — the closed key list as an indented bullet list labeled authoritative. After the symbol table and any rationale evidence, the truncated source is wrapped in the safe-fence selector via `wrapInSafeFence`, so any neutralized control markers inside it are explicitly non-copyable. The structured error lines and the grouped missing-key blocks follow, along with any report-only entries for the module page kind. Finally, the prior candidate is truncated to `maxCandidateChars` and passed through `neutralizeUntrustedControlMarkersExceptValidAnchors`, which preserves section markers whose keys are all in the closed list as valid syntax references while neutralizing everything else — the model may keep those preserved markers but must delete duplicate copies when a `duplicate_anchor` error names a key.

`buildSurgicalRepairPrompt(pageKind, failedPage, errors, evidenceSlice, language)` is the narrower repair path for pages that failed with errors confined to specific H2 sections. The function derives the target section slugs from the errors via `surgicalRepairTargetSections(errors)`, then maps those slugs back to the page's actual headings by splitting the failed page into its H2 sections and building a slug-to-heading map. The model therefore sees the human-readable section names it wrote, with slugs as fallback for unrecognized headings.

The system message establishes a stricter contract than the full repair path: the model may change ONLY the content of the named sections, and everything else — frontmatter, page opening, all other sections, blank lines — must be returned byte-for-byte identical. Inside the named sections it must fix every structured error following each error's ACTION directive, preserve existing `lw:anchors` marker keys unless the directive says otherwise, and never invent anchor keys. When an ACTION requires citing an additional key, the model must choose one already declared in the frontmatter anchors list, because the frontmatter is outside the editable sections and must stay byte-identical.

The user message states the language, the page kind, and the list of section names the model may change. It then lists the structured errors, each formatted with the same neutralization discipline as the full repair path: message and offending text pass through `neutralizeUntrustedControlMarkers`, and each line gets an ACTION directive from `renderActionDirective(pageKind, e, …)`. The evidence slice — symbol rows and source spans for the keys cited in the affected sections — is neutralized and wrapped in the safe fence, or replaced with a note that no evidence exists if no anchor keys are cited. The failed page itself is wrapped in the safe fence, with its `lw:anchors` markers shown verbatim as exact syntax to preserve. The output directive is to return the complete corrected page with only the named sections changed.

Both functions share the same neutralization discipline — every piece of untrusted text (error messages, offending values, source, prior candidates) is swept for copyable control markers before it reaches the model — and both return a `PromptPair` whose system and user halves together constrain the model to repair only what the validator rejected, never to drift into rewriting the page wholesale.

## Tests

Covered by `packages/core/src/prompts.test.ts` (same-name test file on disk).
