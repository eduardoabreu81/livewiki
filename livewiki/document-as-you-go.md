---
title: document-as-you-go skill
owner: generated
anchors: []
---

# document-as-you-go skill

This skill teaches a coding agent how to pay livewiki documentation debt immediately after closing a task, commit, merge, or batch of changes, while keeping the write smaller than the work package it pays down.

## When to use this page

- **Run** `livewiki status --json` after closing a commit, task, or merge to discover what documentation debt exists before stopping the session.
- **Issue** `livewiki update --json` to receive a work package containing `debt`, `snippets`, `validAnchors`, and `tokensEstimated`, then pay only the items whose `assignee` is `agent`.
- **Write** each pay-down through the `livewiki_write_doc` MCP tool when available, falling back to direct file edits plus `livewiki verify` when MCP is not configured.
- **Record** every doc write with `livewiki update --record-write <tokens>` so the product's `efficiencyRatio = write/package` metric reflects your contribution.

## How it fits

The `document-as-you-go` skill lives at `packages/cli/skills/document-as-you-go/SKILL.md` inside the livewiki repository's CLI package, alongside other agent-facing guidance. It targets any agent runtime that has the livewiki MCP skill loaded (Claude Code, OpenCode, Codex CLI, or compatible), and complements the product's hook pipeline by supplying the human-authored side of the loop: while the hook detects code changes and updates the manifest, the agent (acting on this skill) reads the resulting debt list and writes the matching wiki page.

The skill's stated acceptance criterion references SPEC §Fase 5 — an end-to-end flow where the agent edits code, the hook detects it, the agent pays the debt via MCP, `verify` passes, and the manifest refreshes. From the skill's vantage point, only the "agent pays the debt via MCP" step is in scope; the rest of the loop is described as automatic. The skill also enforces guardrails shared with the rest of livewiki, including never inventing anchor keys outside `validAnchors`, leaving `assignee=human` items alone, and treating manual blocks as byte-for-byte sacred.

## Diagram

```mermaid
%% livewiki/diagrams/document-as-you-go.mmd
```

## Debt discovery and the work package

The skill begins by telling the agent to run `livewiki status --json` and inspect `debt.items`. If the array is empty, the skill instructs the agent to stop immediately — there is nothing to pay. This early exit is part of the design: the skill is meant to keep the agent's cost near zero on clean checkouts.

When debt exists, `livewiki update --json` emits a package that the skill describes with four fields:

- `debt`: items with `symbol_key`, `wiki_path`, and `assignee`. The agent only pays items where `assignee=agent`; items where `assignee=human` are business pages that need human review and must be surfaced in the final report instead of edited.
- `snippets`: source windows around each anchor that act as fresh context so the agent does not have to re-read the file.
- `validAnchors`: the canonical keys currently active in the index. The skill is explicit that no key outside this list may appear in the produced documentation, because `verify` rejects documents that reference keys not in the index.
- `tokensEstimated`: the package's estimated token count, using a `chars/4` heuristic. The skill frames this as the product thesis — the package must remain smaller than re-reading the repository.

## Pay-down paths

The skill defines two parallel pay-down paths and prefers the first.

The preferred path is the `livewiki_write_doc` MCP tool. For each debt item the agent reads the existing wiki page with `livewiki_read`, updates the content by placing each anchor under the correct section and matching prose to the new snippet, and calls `livewiki_write_doc` with the full wiki path and updated content. The tool runs `verify` itself before accepting; if an anchor would break, the write is rejected and the agent must correct and retry.

The fallback path is manual editing. When the agent has no MCP configured, it edits `livewiki/<wiki_path>.md` directly and then runs `livewiki verify`. The skill is strict that exit code `0` is necessary but not sufficient: the verify output must show zero issues, counting both errors and warnings. Anything else must be fixed before the agent stops.

## Accounting and confirmation

After a write succeeds, the agent records the doc it produced with `livewiki update --record-write <tokens_estimados>`, where `<tokens_estimados>` follows the same `bytes / 4` heuristic. This feeds the `efficiencyRatio = write/package` metric that `livewiki status --json` exposes, and the skill frames the product thesis as "large package, small write" being a good economy.

The skill closes the loop by re-running `livewiki status --json` and confirming that `debt.items` is empty or contains only `assignee=human` entries, and that `metrics` aggregates the agent's packages and writes so the agent can see its own contribution to the product economy.

## Guardrails

The skill lists four inviolable rules. Human-authored content is untouchable: if `assignee=human`, the agent must not write the markdown and must flag it in the final report instead. No invented keys are allowed; the only valid anchors come from `validAnchors` in the package, and the skill explicitly states that documentation referencing keys outside the index is rejected by `verify`. Manual blocks are preserved byte-for-byte; the skill warns that a `manual_block_altered` complaint means the agent rewrote something it should not have, and the fix is to revert. Finally, "verify clean" means exit code zero *and* zero issues — both errors and warnings — which the skill notes is the same standard that batch-mode `livewiki update` (Fase 3) and the product's E2E tests apply.

## When not to pay

The skill is explicit about three cases where the agent should refuse to pay debt. Items with `assignee=human` must be signaled to a human, not written. Items the skill calls "undocumented" — where no matching anchor exists in `validAnchors` — lack enough fresh context for the agent; the skill defers those to `livewiki init --batch` with an LLM. Trivial changes such as typos or formatting tweaks may not be worth paying immediately; trivial debt can wait for the next round.

## Acceptance criterion

The skill closes by quoting the SPEC §Fase 5 acceptance criterion verbatim: an end-to-end flow where the agent edits code, the hook detects it, the agent pays the debt via MCP, `verify` passes, and the manifest is updated. The skill positions itself as the "agent pays the debt via MCP" step in that flow, while the remaining steps — hook detection (Step 3) and manifest refresh on a passing `verify` — are described as automatic.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
