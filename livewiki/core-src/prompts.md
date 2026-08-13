---
title: Documentation Prompt Construction and Safety
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

# Documentation Prompt Construction and Safety

This file defines the shared rules, safeguards, and builders that turn repository evidence into prompts for generating and repairing livewiki documentation.

## When to use this page

- Understand how module, flow, topic, folder, and file documentation prompts are assembled.
- Adjust token budgets or editorial rules shared across generation and repair stages.
- Trace how untrusted source text and control-marker-like content are neutralized before reaching a large language model (LLM).
- Extend prompt builders while preserving anchor, Markdown, and validation contracts.

## How it fits

Within the core package, `prompts.ts` is the prompt-construction layer between repository analysis and documentation generation. It combines module metadata, canonical symbol keys, source excerpts, language settings, and validation requirements into the system-and-user prompt pairs consumed by the configured LLM client.

The module also protects that boundary: it safely encloses untrusted evidence, removes copyable livewiki control markers, and builds targeted repair instructions from validator errors. It works alongside module, flow, topic, repair-contract, and section-guard modules that supply classifications, semantic plans, repair directives, and section analysis.

## Defining shared writing contracts and output budgets
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#LAY_READER_PROMPT_RULE packages/core/src/prompts.ts#WRITE_FOR_UNDERSTANDING_PROMPT_RULE packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#FILE_NARRATIVE_PROMPT_RULES packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE packages/core/src/prompts.ts#INVENTORY_AUTHORITY_PROMPT_RULE packages/core/src/prompts.ts#BRANCH_PRECISION_PROMPT_RULE packages/core/src/prompts.ts#DEEP_HIERARCHY_PROMPT_RULE packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET -->

This shared contract keeps generated pages readable without letting prompts or diagrams grow without bound. `DEFAULT_CONTEXT_TOKEN_BUDGET` sets the input context allowance to 30,000 tokens, while `DEFAULT_OUTPUT_TOKEN_BUDGET` caps the expected generated output at 4,000 tokens. Together they give the surrounding prompt pipeline consistent limits for how much source material it can supply and how much documentation it should request.

The writing rules then establish the reader and the intended outcome. `LAY_READER_PROMPT_RULE` assumes a capable developer who is new to the repository, requiring explanations to introduce purpose before implementation and define project-specific language on first use. `WRITE_FOR_UNDERSTANDING_PROMPT_RULE` complements that requirement by favoring concise, factual prose that still explains why a section exists and when it matters.

`PAGE_OPENING_PROMPT_RULES` turns those principles into a fixed opening sequence. It begins with a meaningful H1 and a one-sentence responsibility statement, follows with `When to use this page` and two to four action-led task bullets, and then adds `How it fits` with concise repository context. The rules also require meaningful titles, non-empty bullets, and an honest description of fixtures, tooling, benchmarks, and documentation. They keep inventories and anchor bookkeeping out of the opening and prevent symbol-rich modules from being labeled as entry points without supporting evidence.

After the opening, `FILE_NARRATIVE_PROMPT_RULES` governs the implementation story. Sections must follow the file’s responsibilities or pipeline stages, explain why each stage exists before describing how it works, and connect real symbols through step-by-step behavior instead of presenting a flat catalogue. These rules also reserve test-pointer handling for the orchestrator and prohibit generated prose from emitting the human-owned manual-block control marker; when necessary, that concept may be named only as `lw:manual`.

For larger modules, `DEEP_HIERARCHY_PROMPT_RULE` refines that narrative structure. Once a module has eight or more symbols, related behavior is grouped beneath concept-named H2 sections, with H3 subsections for individual symbols or tightly related clusters. Each concept section owns the anchor entries for the symbols it explains and must contain substantive prose after that metadata.

The remaining contracts provide named enforcement points for more specific documentation concerns. `LITERAL_SIGNATURE_PROMPT_RULE` covers literal signature treatment, `EXCEPTION_BRANCH_PROMPT_RULE` covers exceptional branches, `INVENTORY_AUTHORITY_PROMPT_RULE` covers inventory authority, and `BRANCH_PRECISION_PROMPT_RULE` covers precise branch descriptions. Their assigned rule text is not present in the supplied slice, so no more detailed requirements can be established here without inventing behavior.

Finally, `FLOW_DIAGRAM_DEFAULT_BUDGET` limits a default flow diagram to 12 nodes and 20 edges. This keeps diagrams focused on the mechanism’s important transitions rather than reproducing the entire symbol or call inventory.

## Generating module pages and optional structure diagrams
<!-- lw:anchors packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildModuleDiagramPromptRules -->

Module-page generation exists to turn module metadata, an authoritative symbol inventory, and a bounded source excerpt into a strict two-message documentation request. `export function buildStage4Prompt(`

This function takes module details, canonical keys, symbol and source text, language and role settings, optional rationale evidence, and formatting options, and returns the system and user prompts as a `PromptPair`.

`buildStage4Prompt` first determines the module’s role with `classifyModuleRole` unless `moduleRoleOverride` supplies one. Non-product modules receive a compact reference contract: the generated page must retain the required opening, use one reference section with one subsection per anchored symbol, describe each symbol briefly, and avoid presenting auxiliary code as a product runtime path. Product modules instead receive the file-narrative and literal-signature rules appropriate to implementation documentation.

The function then assembles the system prompt as a layered validation contract. It combines the common page-opening rules with role-specific rules, exception and branch-precision requirements, inventory authority, rationale-handling safeguards, and optional formatting rules. It also defines the canonical-key invariants: keys must come from `closedKeyList`, appear exactly once in both frontmatter and section markers, and belong to one primary documentation section. Additional rejection criteria make malformed Markdown, incomplete key coverage, duplicate keys, empty sections, placeholders, reserved human content, and an invalid page opening explicit failures.

When diagrams are enabled through `formatOptions.moduleDiagrams`, `buildStage4Prompt` inserts the rules returned by `buildModuleDiagramPromptRules`. When deep hierarchy is enabled, it similarly adds `DEEP_HIERARCHY_PROMPT_RULE`. This keeps optional output features inside the same system-level contract instead of relying on the model to infer them from the source.

The user prompt is built separately in `userParts`. It records the language, file or module identity, optional display title, paths, symbol count, and every canonical key. If keys exist, it includes a concrete section-marker example derived only from the first one or two entries in `closedKeyList`. If the list is empty, it replaces that example with a zero-key contract requiring useful unanchored documentation and forbidding invented anchors.

Before the source is added, `buildStage4Prompt` passes `truncatedSource` through `neutralizeUntrustedControlMarkers` and then encloses it with `wrapInSafeFence`. It also appends the symbol table and the output of `renderRationaleEvidenceBlock`, so the model receives structural facts and optional evidence while being told which material is untrusted. Finally, it joins both prompt arrays with newlines and returns `{ system, user: userParts.join("\n") }`.

Optional diagrams need their own precise contract because a valid Mermaid block must remain useful without overwhelming the generated page. `export function buildModuleDiagramPromptRules(budget: FlowDiagramBudget): readonly string[] {`

This function takes a diagram size budget and returns an immutable list of prompt-rule strings.

`buildModuleDiagramPromptRules` requires exactly one `Diagram` section between the opening “How it fits” material and the first implementation section. That section must contain only one Mermaid fence, with real Mermaid source rather than an orchestrator placeholder. The diagram represents module-level structure—such as files, classes, or components—and uses actual dependency or call direction instead of expanding every individual symbol into a node.

The helper interpolates `budget.maxNodes` and `budget.maxEdges` into the rules, directing the generator to merge or omit detail until both limits are satisfied. It also keeps the diagram outside the section-anchor mechanism: the diagram carries neither an anchor marker nor anchor citations, while canonical keys remain in frontmatter and the implementation sections that document them.

## Assembling end-to-end flow documentation
<!-- lw:anchors packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#buildFlowGroupBlock packages/core/src/prompts.ts#buildFlowSectionAssignmentBlock packages/core/src/prompts.ts#buildStage5Prompt -->

`export const FLOW_PAGE_PROMPT_RULES = [`

`FLOW_PAGE_PROMPT_RULES` is a fixed collection of instructions used to shape the generated flow page.

The rules establish the page contract before candidate-specific evidence is added. They require a plain-language opening followed by `Purpose`, `Ordered flow`, `Invariants`, `Failure and recovery`, and `Related pages` in that order. They also define the role of each section, require the numbered flow to stand on its own, constrain related-page links and frontmatter metadata, and restrict `lw:anchors` placement to the three sections that document behavioral evidence. Distinct cited keys must cover those required sections and, when semantic key groups are supplied, represent every listed entry, boundary, and sink group.

`function buildFlowGroupBlock(`

It takes the closed key list and optional semantic flow groups, and returns prompt lines describing the valid groups that the generated page must cite.

`buildFlowGroupBlock` first returns no lines when group information is absent. Otherwise, it converts the closed list into a set and visits the entry, boundary, and sink tiers in that order. For each tier, it removes keys that are not present in the authoritative closed list and emits a group line only when valid keys remain. If every group becomes empty, it again returns no lines; otherwise, it prefixes the retained groups with an instruction requiring at least one citation from each listed tier.

`function buildFlowSectionAssignmentBlock(sectionMap: FlowKeySectionMap | undefined): string[] {`

It takes an optional mapping from symbol keys to required flow sections, and returns prompt lines that fix where those keys’ markers must appear.

`buildFlowSectionAssignmentBlock` omits the block when the map is missing or empty. For a populated map, it buckets keys under `Purpose`, `Ordered flow`, or `Failure and recovery`, preserving the map’s iteration order within each bucket. It then emits only non-empty buckets in the required section order and introduces them with an authoritative placement rule. This separates marker ownership from prose: a symbol may be discussed elsewhere, but its key can appear only in the assigned section’s marker.

`export function buildStage5Prompt(`

It takes a flow candidate, canonical keys, module and source context, language and compatibility settings, plus optional grouping and section-assignment evidence, and returns the system and user prompts used to request a complete flow page.

`buildStage5Prompt` assembles those prompts in stages. It first selects up to two closed-list keys for a concrete marker example, then calls `buildFlowGroupBlock` and `buildFlowSectionAssignmentBlock` so semantic coverage and marker placement are derived from the same inputs as the rest of the request.

The function next constructs the system prompt. It combines `FLOW_PAGE_PROMPT_RULES` with shared rules for literal signatures, exception branches, inventory authority, branch precision, and reader-oriented explanation. Additional constraints make the closed list the sole source of valid keys, require frontmatter citations and section-marker citations to match exactly, prevent duplicate or misplaced keys, and enforce complete Markdown. When a section map exists, its assignments are declared fixed; otherwise, the prompt applies a primary-section rule so each cited key still belongs to exactly one marker.

The user prompt then supplies the candidate’s slug, title seed, ordered modules, detection signals, current date, and canonical key list. It appends the filtered semantic groups and fixed section assignments, followed by the marker example when keys are available. Before adding module-page excerpts and source code, `buildStage5Prompt` neutralizes untrusted control markers and wraps the resulting text safely. Finally, it adds the symbol table, reiterates that human-owned manual content must not be emitted, specifies the destination flow-page path, and returns both assembled strings as `{ system, user }`.

## Turning grouped evidence into topic pages
<!-- lw:anchors packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES packages/core/src/prompts.ts#formatTopicGroups packages/core/src/prompts.ts#buildTopicSectionAssignmentBlock packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRefinePrompt -->

`export const TOPIC_PAGE_PROMPT_RULES = [`

`TOPIC_PAGE_PROMPT_RULES` provides the shared, immutable set of instructions used to shape a topic page. It establishes the required page structure, evidence coverage, anchor accounting, source-symbol references, word limits, related-page links, and cautious language. These rules turn a closed evidence bundle into a consistent reader-oriented contract: cited keys must be drawn from the supplied list, represented once in frontmatter and once in the appropriate section marker, and weighted toward product symbols rather than test symbols. The three list-valued frontmatter fields — modules, flows, and anchors — must use YAML block-list syntax with one entry per line; a comma-joined scalar is explicitly forbidden because it parses as one string rather than the accepted list.

`function formatTopicGroups(groups: TopicKeyGroups): string[] {`

`formatTopicGroups` takes the topic’s categorized key groups and returns an array of prompt lines. It renders the contract, state, output, and failure groups under an explicit requirement to cite at least one distinct key from each. This preserves the semantic roles assigned during topic planning and prevents the generated page from overlooking an important kind of evidence.

`function buildTopicSectionAssignmentBlock(sectionMap: TopicKeySectionMap | undefined): string[] {`

`buildTopicSectionAssignmentBlock` takes an optional mapping from evidence keys to required sections and returns prompt lines describing the fixed assignments. It first returns no lines when the map is absent or empty. Otherwise, it collects keys under Purpose, When to use this page, Behavioral contract, Failure and recovery, and Change map; walks those sections in the required page order; and emits entries only for sections that received keys. The resulting authoritative block fixes where each key’s marker belongs while still allowing prose to discuss the corresponding symbol elsewhere.

`export function buildTopicPrompt(`

`buildTopicPrompt` takes an accepted topic candidate, its digests and evidence, the symbol table, language and optional section assignments, rationale, and prose evidence, and returns the system and user prompts needed to generate the page. It first derives the assignment block, then builds a system prompt from the general documentation role, `TOPIC_PAGE_PROMPT_RULES`, conditional assignment enforcement, and the shared rules for exception branches, inventory authority, branch precision, and untrusted rationale. It also forbids invented anchors and generated `lw:manual` blocks.

The user prompt then supplies the accepted title, order, intent, modules, flows, current date, and closed anchors. `formatTopicGroups` adds the mandatory evidence categories, while the assignment block constrains marker placement when a map was provided. Before the evidence, the prompt includes a fenced frontmatter example built from the candidate's real accepted values, pinning `modules`, `flows`, and `anchors` to block-list syntax; it also includes a concrete section-marker example based on at most two accepted seed keys when available. Finally, the function appends the module and flow digest, symbol table, optional rationale and prose evidence, source evidence, and destination path. Untrusted digest and source content is neutralized before being wrapped in safe fences, so embedded control-like text cannot take over the generated page’s structure.

`export function buildTopicRefinePrompt(`

`buildTopicRefinePrompt` takes deterministic topic proposals, a maximum topic count, and a language, and returns a pair of prompts for refining the plan. Its system prompt deliberately narrows the editor’s authority: titles and intents may be clarified, overlapping topics may be merged without losing modules, flows, groups, or anchors, and redundant topics may be dropped. It prohibits adding new evidence, inventing topics, or moving anchors between evidence groups, while requiring the same JSON schema, bounded text lengths, distinct descriptions, and no more than `maxTopics` results. The user prompt adds the language and serialized accepted proposals, then requests JSON alone. This refinement stage can improve information architecture without weakening the closed evidence that `buildTopicPrompt` later turns into a page.

## Building focused understanding, folder, and file narratives
<!-- lw:anchors packages/core/src/prompts.ts#UNDERSTANDING_PAGE_PROMPT_RULES packages/core/src/prompts.ts#buildUnderstandingPrompt packages/core/src/prompts.ts#FOLDER_PURPOSE_PROMPT_RULES packages/core/src/prompts.ts#buildFolderPurposePrompt packages/core/src/prompts.ts#buildFileOpeningPrompt packages/core/src/prompts.ts#buildFilePlanPrompt packages/core/src/prompts.ts#buildFileSectionPrompt -->

This stage exists to turn verified repository evidence into several focused narratives, each sized for a different level of the wiki. `UNDERSTANDING_PAGE_PROMPT_RULES` constrains the repository overview to a product-named H1, one concise purpose paragraph, and an optional short code-orientation list. It requires claims to come from the closed evidence inventory, gives verified wiki evidence precedence over README language, enforces strict length limits, and excludes symbol-oriented formatting so the result remains accessible to a general reader. It also forbids emitting the manual-block control marker anywhere; that ownership syntax belongs exclusively to the orchestrator, while prose that must discuss the mechanism may use its bare name without copying the HTML comment.

`export function buildUnderstandingPrompt(`

This function takes an evidence block and an optional language, and returns the system and user prompts needed to generate the repository-understanding page.

`buildUnderstandingPrompt` assembles the system instructions from the overview’s purpose, verification guarantees, `UNDERSTANDING_PAGE_PROMPT_RULES`, and the raw-Markdown output requirement. It then builds the user prompt with the requested language, the current ISO date, and the closed evidence inventory. Before embedding that inventory in a safe fence, it passes the content through `neutralizeUntrustedControlMarkers`, preventing untrusted evidence from becoming orchestration syntax. The resulting `PromptPair` also fixes the intended output path as `livewiki/understanding.md`. The repair builder calls this same initial builder and reapplies the identical rule set, so repair attempts retain the same ownership and control-marker constraints instead of repairing against a weaker contract.

Folder narration narrows the same evidence-first approach to a directory’s role. `FOLDER_PURPOSE_PROMPT_RULES` asks for one synthesized paragraph, or at most two, rather than a file-by-file inventory. It sets a 40–800 character boundary, permits important filenames as inline code, requires every claim to trace to deterministic inventory data or accepted file-page openings, and favors concrete wording over padded qualifier lists.

`export function buildFolderPurposePrompt(`

This function takes a directory context block and an optional language, and returns the system and user prompts for generating the folder-purpose prose.

`buildFolderPurposePrompt` combines the folder-page objective with `FOLDER_PURPOSE_PROMPT_RULES` and an explicit instruction to return only the paragraph. Its user prompt labels the language and directory evidence, neutralizes control-like content, wraps the evidence safely, and restates the required plain-prose length range. This keeps the generated text focused on how the directory’s main pieces work together.

File documentation is split into separate passes so a large source file can still produce one coherent page. The opening pass establishes the page’s role before implementation details are written.

`export function buildFileOpeningPrompt(`

This function takes a file path, symbol table, truncated source text, and optional language, and returns the prompts for generating the file page’s opening block.

`buildFileOpeningPrompt` combines the shared page-opening and file-narrative rules, then limits the response to the H1, responsibility sentence, usage guidance, and architectural context. The user prompt supplies the file identity, symbols, and safely fenced source excerpt; because that excerpt may be truncated, this pass uses it for orientation rather than claiming to document the entire implementation.

The planning pass then turns the available symbols into a readable implementation arc.

`export function buildFilePlanPrompt(`

This function takes a file path, an authoritative list of symbol keys, a symbol table, truncated source text, and an optional language, and returns the prompts for planning the file page’s sections.

`buildFilePlanPrompt` instructs the model to produce only a fenced JSON object containing three to eight ordered sections. Each section must represent a responsibility or pipeline stage, while all keys together must form an exact partition of `closedKeyList`: every canonical key appears once, and no outside key is admitted. The user prompt expands that list verbatim, adds the symbol table and neutralized source excerpt, and requests headings in the selected language. This planning boundary prevents the later prose from degenerating into disconnected symbol summaries.

Finally, the section-writing pass fills one planned stage using the source dedicated to its assigned symbols.

`export function buildFileSectionPrompt(`

This function takes the file path, section heading, assigned symbol keys, symbol table, source slice, truncation status, and optional language, and returns the prompts for writing that section’s prose.

`buildFileSectionPrompt` injects the shared narrative rules, identifies the exact heading and canonical keys, and applies the literal-signature requirement so behavioral claims remain tied to the supplied symbol table. It also changes the evidence instruction according to `sourceTruncated`: a truncated slice permits only visible behavior, while a complete slice is declared complete for those symbols. The user prompt then provides the language, file, heading, symbol rows, and a neutralized, safely fenced source slice. The output is restricted to explanatory prose because page structure, anchors, and other orchestration-owned material are added later.

## Safely embedding untrusted source and evidence
<!-- lw:anchors packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.ts#renderRationaleEvidenceBlock packages/core/src/prompts.ts#renderProseEvidenceBlock -->

Untrusted source may contain Markdown delimiters or LiveWiki control syntax that could escape its evidence block or alter generated documentation. This pipeline first chooses a fence that the content cannot close, then neutralizes control markers before presenting useful evidence to the model.

```ts
function longestRunOf(text: string, char: "`" | "~"): number {
```

`longestRunOf` takes text and either the backtick or tilde character, and returns the length of that character’s longest consecutive run. `selectSafeFence` uses this measurement to determine how long a surrounding Markdown fence must be.

```ts
function boundEncodeLongRuns(text: string, char: "`" | "~", cap: number): string {
```

`boundEncodeLongRuns` takes text, a fence character, and a maximum run length, and returns text in which runs reaching that limit have been split. It divides each oversized run into chunks of at most `cap - 1` characters separated by spaces, ensuring that the transformed content cannot contain a run long enough to close a fence of length `cap`.

```ts
function selectSafeFence(enclosed: string): { fence: string; content: string } {
```

`selectSafeFence` takes the content to enclose and returns both a safe Markdown fence and the content that should appear inside it. It first measures backtick runs with `longestRunOf` and, when possible, selects a backtick fence at least three characters long and one character longer than the longest enclosed run. If that would exceed `SAFE_FENCE_MAX_LEN`, it repeats the process with tildes. When both character classes contain pathologically long runs, it applies `boundEncodeLongRuns` to both backticks and tildes, then uses a tilde fence capped at `SAFE_FENCE_MAX_LEN`; the surviving runs are shorter than that fence and therefore cannot close it.

```ts
function wrapInSafeFence(enclosed: string): string {
```

`wrapInSafeFence` takes untrusted content and returns it surrounded by a safe Markdown fence. It delegates fence selection and any necessary content transformation to `selectSafeFence`, then emits the opening fence, content, and matching closing fence on separate lines.

Fence safety prevents Markdown breakout, while marker neutralization prevents embedded source text from being interpreted as LiveWiki orchestration syntax.

```ts
export function neutralizeUntrustedControlMarkers(text: string): string {
```

`neutralizeUntrustedControlMarkers` takes untrusted text and returns a version with every recognized LiveWiki control marker replaced by spaces. Each replacement preserves the original match length, removing its control meaning without collapsing surrounding layout.

```ts
export function neutralizeUntrustedControlMarkersExceptValidAnchors(
```

`neutralizeUntrustedControlMarkersExceptValidAnchors` takes text and a closed list of permitted keys, and returns text in which only strictly valid anchor markers are retained. It builds a set from the closed key list, examines each control marker matched by `LW_CONTROL_MARKER_RE`, and preserves an anchors marker only when its syntax matches the strict pattern, it contains at least one key, and every key belongs to that set. All other matched markers are replaced with same-length spaces.

Finally, the evidence renderers apply both protections while keeping different evidence categories clearly labeled.

```ts
function renderRationaleEvidenceBlock(rationaleEvidence: string | undefined): string[] {
```

`renderRationaleEvidenceBlock` takes optional rationale evidence and returns the lines of a prompt block. Missing or whitespace-only evidence produces no lines. Otherwise, the function adds a warning that code comments are untrusted hints for explaining why the code exists, neutralizes their control markers with `neutralizeUntrustedControlMarkers`, encloses the result through `wrapInSafeFence`, and appends a blank separator line.

```ts
function renderProseEvidenceBlock(proseEvidence: string | undefined): string[] {
```

`renderProseEvidenceBlock` takes optional prose evidence and returns the lines of a prompt block. It likewise omits empty input, neutralizes control markers, and safely fences the remaining text. Its label additionally establishes that files without canonical keys may be described only from visible behavior and must not be treated as sources of anchors or invented closed-list keys.

## Repairing rejected pages while preserving validated structure
<!-- lw:anchors packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage5RepairPrompt packages/core/src/prompts.ts#buildTopicRepairPrompt packages/core/src/prompts.ts#buildSurgicalRepairPrompt packages/core/src/prompts.ts#buildUnderstandingRepairPrompt packages/core/src/prompts.ts#buildFolderPurposeRepairPrompt -->

The repair builders exist to turn a validator-rejected documentation candidate into a constrained retry without losing the structure that was already valid. Each builder reconstructs the governing rules, neutralizes untrusted material, translates validation failures into explicit actions, and supplies the previous candidate as repair context.

`export function buildRepairPrompt(`

This function takes module metadata, canonical keys, source and symbol evidence, the rejected candidate, validation errors, repair limits, and optional formatting context; it returns a pair of system and user prompts.

`buildRepairPrompt` first classifies the module unless a role override is supplied. Non-product modules receive a compact reference-oriented contract, while single-file product modules receive file-narrative rules and product modules receive the literal-signature rule. It then derives whether the current attempt is final from the attempt number and total, preventing callers from supplying contradictory final-attempt state.

The system prompt restores the initial page constraints before describing any individual repair. These constraints cover the required opening, role-specific structure, canonical-key authority, independent completeness of frontmatter and section markers, Markdown closure, explanatory prose for nonempty sections, and preservation of human-owned `lw:manual` content by omission. Optional diagram and deep-hierarchy rules are included only when the corresponding format options request them. A final attempt receives a stronger directive to audit and materially correct the rejected candidate rather than return it unchanged.

The function next separates `missing_closed_key` failures from other validation errors when they identify either frontmatter or section placement. It deduplicates those missing keys per location and renders them as grouped action blocks, so a key is added only where the validator reported it missing. Other failures are rendered individually. Before an error message, offending value, or generated action enters the prompt, `neutralizeUntrustedControlMarkers` removes copyable control syntax; the completed error line is neutralized again as defense in depth. `renderActionDirective` supplies the page-kind-specific corrective instruction.

Finally, `buildRepairPrompt` neutralizes the truncated source and bounds the prior candidate with `maxCandidateChars`. `neutralizeUntrustedControlMarkersExceptValidAnchors` preserves only section markers whose keys match the closed list, allowing valid structure to survive while preventing rejected or model-invented controls from being copied. The user prompt then assembles the language, attempt status, module identity, authoritative keys, symbol table, optional rationale evidence, safely fenced source, structured repairs, safely fenced prior candidate, and requested output path.

`export function buildStage5RepairPrompt(`

This function takes a flow candidate, canonical keys, module-page context, source and symbol evidence, the rejected flow page, validation errors, repair limits, and optional flow mappings; it returns system and user prompts for a corrected flow page.

`buildStage5RepairPrompt` applies the same bounded-attempt model to cross-module flow documentation. It rebuilds the semantic key-group block with `buildFlowGroupBlock` and the fixed key-to-section assignment with `buildFlowSectionAssignmentBlock`, keeping tier coverage and marker placement visible during repair. Its system prompt requires prose only because the companion diagram is inserted separately, and it restates the required flow opening, accuracy rules, signature requirements, canonical-key restrictions, and Markdown validity.

Unlike the module-page contract, the flow closed list is an upper bound rather than a completeness requirement. A key is required only when the repaired page cites it, but every cited key must appear once in frontmatter and once in exactly one section marker. When a section map is available, the prompt makes that assignment authoritative while still permitting prose to mention a symbol elsewhere.

The function groups location-specific missing keys in the same way as `buildRepairPrompt`, but its action permits either adding the key to the reported side or removing the unnecessary citation from the opposite side. Individual errors are neutralized and passed to `renderActionDirective` with the `"flow"` page kind. Module openings, source evidence, and the bounded prior candidate are also neutralized before being placed in safe fences. The resulting user prompt includes the exact participating-module list, a current date for frontmatter, key groups, fixed section assignments, repair reports, and an output instruction that again excludes the diagram section.

`export function buildTopicRepairPrompt(`

This function takes a topic candidate, module and source evidence, the rejected topic page, validation errors, repair limits, and optional assignment and evidence data; it returns a topic-repair prompt pair.

`buildTopicRepairPrompt` begins from `buildTopicPrompt`, ensuring the repair is grounded in the initial topic contract rather than only in the rejected artifact. It separately rebuilds the topic section-assignment block and maps each permitted section identifier to its presentation label. That mapping lets the local `assignedSectionLabel` helper resolve the deterministic destination for a duplicated key.

For every validation error, the function neutralizes both the message and offending value, formats the safe diagnostic, and asks `renderActionDirective` for the topic-specific correction. It supplies `assignedSectionLabel` so duplicate-anchor actions can name the assigned section precisely, then neutralizes the completed line once more. The visible portion of the returned system prompt identifies the bounded attempt, reapplies `TOPIC_PAGE_PROMPT_RULES`, makes any supplied section assignment fixed, and restores the shared exception-branch, inventory-authority, and branch-precision guarantees. The remainder of this function is outside the supplied source slice, so its later prompt assembly is not established here.

`export function buildSurgicalRepairPrompt(`

This function takes parameters not shown in the supplied slice and returns a value whose type and contents are likewise not visible. The available source does not expose its repair steps, so no behavior beyond its presence as an exported repair builder can be established.

`export function buildUnderstandingRepairPrompt(`

`buildUnderstandingRepairPrompt` takes the closed evidence, the prior candidate, structured validation errors, a maximum candidate length, language, and bounded attempt context. It starts from `buildUnderstandingPrompt`, reapplies `UNDERSTANDING_PAGE_PROMPT_RULES`, and translates each error into a scoped action. Length failures receive deletion-focused instructions that preserve the rest of the page, while other violations require a complete corrected artifact. The prior candidate is truncated to the supplied cap, neutralized, and safely fenced as data; on the final attempt the system prompt explicitly rejects returning the same candidate unchanged.

`export function buildFolderPurposeRepairPrompt(`

This function takes parameters not shown in the supplied slice and returns a value whose type and contents are likewise not visible. The truncated source provides no implementation body from which to determine how it repairs folder-purpose documentation.

## Tests

Covered by `packages/core/src/prompts.test.ts` (same-name test file on disk).
