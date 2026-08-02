---
title: document-as-you-go (livewiki skill)
owner: generated
anchors: []
---

# document-as-you-go (livewiki skill)

This skill instructs an agent to pay livewiki documentation debt immediately after closing a commit, task, or branch, before ending the session.

## When to use this page

- **Run** `livewiki status --json` after closing a commit, task, subtask, or merge to check whether the wiki has unpaid debt before stopping the session.
- **Issue** a work package with `livewiki update --json` and inspect `debt`, `snippets`, `validAnchors`, and `tokensEstimated` to plan how to pay each item.
- **Pay** debt either through the MCP tool `livewiki_write_doc` (preferred) or by editing `livewiki/<wiki_path>.md` directly and running `livewiki verify`, then record the write with `livewiki update --record-write <tokens_estimados>`.
- **Defer** items flagged `assignee=human`, items with no matching canonical anchor (undocumented), and trivial typo/formatting changes rather than rewriting them.

## How it fits

This skill lives in `packages/cli/skills/document-as-you-go/SKILL.md` as part of the `livewiki` CLI's skills surface, alongside the `livewiki` commands it orchestrates (`status`, `update`, `verify`). It targets any agent runtime (Claude Code, OpenCode, Codex CLI, or any agent that has the livewiki MCP skill) and operates after a code change has already been detected by the surrounding hook pipeline; the agent's role is the "agente paga a dívida via MCP" step in the Fase 5 acceptance flow, while hook detection and manifest updates run elsewhere.

## Skill contract

The skill frontmatter declares:

```
---
name: document-as-you-go
description: Quando você termina uma tarefa/commit, pague a dívida de documentação da wiki antes de fechar. Use este skill no Claude Code, OpenCode, Codex CLI ou qualquer agente que tenha a skill MCP do livewiki.
---
```

The body is written in Portuguese and frames the agent's responsibility as: "Quem fez a mudança documenta melhor" — whoever made the change documents it, because the fresh context is still in memory and costs no extra API tokens.

## When to invoke

The skill lists four triggering actions, all required to happen BEFORE the session ends:

- Closed a commit.
- Finished a task or subtask.
- Merged a branch.
- Left work in a "complete for now" state.

It explicitly forbids invocation during an active edit; the work must be closed first.

## Work package shape (`livewiki update --json`)

The JSON emitted by `livewiki update` carries four named fields:

- `debt` — a list of items with kind `changed`/`moved`/`deleted`, each carrying `symbol_key`, `wiki_path`, and `assignee`. Only `assignee=agent` items are payable; `assignee=human` items are business pages that require human review and must not be touched.
- `snippets` — current source windows around each anchor, supplied as context so the agent does not have to re-read the file.
- `validAnchors` — the canonical keys the agent is allowed to anchor; keys outside this list will be rejected by `verify`.
- `tokensEstimated` — a `chars/4` heuristic of the package size. The skill states the product thesis that this number is smaller than re-reading the whole repo, and that the agent must keep it that way.

If `debt.items` is empty, the skill instructs the agent to stop — there is nothing to pay.

## Two payment paths

**Path A — MCP `livewiki_write_doc` (preferred).** For each debt item the agent reads the corresponding wiki page with `livewiki_read`, updates the content (placing the anchor in the right section, adjusting the description to match the new snippet), then calls `livewiki_write_doc` with the full wiki page path and the updated content. `livewiki_write_doc` runs `verify` before accepting; if an anchor breaks, the write is rejected and the agent must correct and retry.

**Path B — manual edit + `livewiki verify`.** If the agent does not have MCP configured, it edits `livewiki/<wiki_path>.md` directly on disk and then runs:

```bash
livewiki verify
```

The exit code must be 0 **and** there must be zero issues (both errors and warnings — not only errors). Otherwise the agent must correct until the result is clean.

## Accounting write

Every paid item is recorded via:

```bash
livewiki update --record-write <tokens_estimados>
```

`<tokens_estimados>` is a `bytes / 4` heuristic of what the agent actually wrote. This number feeds `efficiencyRatio = write/package` in `status --json`. The stated thesis: a large package that produces a small write is good economy.

## Confirmation loop

After paying and recording, the agent runs `livewiki status --json` again. `debt.items` must be empty (or contain only `assignee=human` items), and `metrics` aggregates the agent's packages and writes so it can see its own contribution to the product's economy.

## Inviolable guardrails

1. **Human content is untouchable.** If `assignee=human`, do not write into the markdown — flag it to the human in the final report.
2. **No invented keys.** Use only `validAnchors` from the package. Documentation with a key outside the index is rejected by `verify`.
3. **Manual blocks preserved byte-for-byte.** Manual blocks (the skill notes these are human-owned property) must not be rewritten; a `manual_block_altered` complaint from verification means the agent overwrote something it shouldn't, and must be reverted.
4. **Clean verify is the criterion.** Exit 0 alone is not enough — zero issues is required. `livewiki update` in batch mode (Phase 3) and the product's E2E test enforce the same rule, and the skill instructs the agent to follow the same standard.

## When NOT to pay

- `assignee=human` debt — human review is needed; signal, do not write.
- No corresponding anchor (undocumented) — the agent lacks fresh-enough context; better left to `livewiki init --batch` to resolve with an LLM.
- Trivial change (typo, formatting) — evaluate whether it is worth paying; trivial debt can wait for the next round.

## Acceptance criterion (SPEC §Fase 5)

The skill quotes the end-to-end flow: "agente altera código, hook detecta, agente paga a dívida via MCP, verify passa, manifest atualizado." The agent's own role is the "agente paga a dívida via MCP" step; the other steps (Step 3 hook detection, manifest update after `verify` passes) are automatic.

## Essential commands (TL;DR)

```bash
livewiki status --json    # see debt + metrics
livewiki update --json    # emit work package
livewiki_write_doc        # MCP — pay one page (runs verify before accepting)
livewiki verify           # CLI fallback — exit 0 + zero issues
livewiki update --record-write <N>   # account for written documentation
```

## Privacy

The skill explicitly does not touch any API key and does not call an LLM directly. If MCP is configured, the MCP server reads the key from the environment variable. Without MCP, the agent edits manually. The skill instructs the agent to never ask the human to paste a key.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
