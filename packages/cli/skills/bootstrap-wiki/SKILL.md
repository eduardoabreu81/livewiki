---
name: bootstrap-wiki
description: Bootstrap a repository's initial livewiki documentation through MCP when no wiki pages exist or the user explicitly asks for its first full wiki. Use for deliberate, long-running initial documentation.
---

# bootstrap-wiki

Build the repository's initial wiki through livewiki's persistent MCP task
queue. Use this skill when `livewiki status` reports no documented pages or
when the user explicitly asks for the initial wiki.

Do not use this skill for documentation debt created by a completed code
change. Once a wiki exists, use the `document-as-you-go` skill for that short,
reactive maintenance loop.

## Work in bounded batches

A large repository can produce dozens or hundreds of tasks. Choose a bounded
batch that fits comfortably in the remaining context, complete only that
batch, and report progress to the user before continuing.

**Stopping midway is safe.** The queue and its checkpoints are persistent. The
next call to `livewiki_next_task` resumes the same run, and an in-flight task is
offered again after a disconnect. Never trade accuracy for draining the whole
queue in one context window.

## Bootstrap loop

Repeat these steps for the current bounded batch:

1. Call `livewiki_next_task`.
2. If it returns a task, note its `taskId`, `kind`, `targetPath`, complete
   `closedKeys`, `sourcePaths`, format contract, validation data, and attempt
   budget.
3. Read the returned source paths with your own file-reading tools. The task
   provides paths rather than source bytes; inspect the repository before
   writing.
4. Write the complete Markdown page required by the format contract. Treat the
   task's closed list as the only allowed source of canonical keys.
5. Call `livewiki_write_doc` with the exact `path`, complete `content`, and
   returned `taskId`.
6. If the write is rejected, use the returned anchor, section, or contract
   diagnostics to correct it. Attempts are bounded by the server. If a task is
   exhausted and becomes `failed`, report it and continue with
   `livewiki_next_task`; do not loop on it.
7. Continue until the current batch is complete or the remaining context says
   to stop.

After each batch, tell the user the run ID, how many tasks completed or failed,
the current task if one remains in flight, and that another invocation can
resume safely.

## Completion

When `livewiki_next_task` reports that the run is complete, run:

```bash
livewiki verify
```

The bootstrap is complete only when the command exits 0 and reports zero
issues. If the run completed with failures, report those failures honestly;
do not present the wiki as complete.

Run accounting is `unavailable` for this workflow. Do not infer or report a
token count.

## Guardrails

1. **Never invent a key.** Use only the complete `closedKeys` list returned for
   the task. A key outside that list must be rejected.
2. **Human content is untouchable.** Do not overwrite a page with
   `owner: human`.
3. **Preserve manual blocks byte-for-byte.** Existing
   `<!-- lw:manual --> ... <!-- /lw:manual -->` blocks belong to the human.
4. **Follow the returned contract.** Page shape depends on `kind`; do not
   replace the task's format contract with a generic page template.
5. **The clean verifier is the finish line.** Require both exit code 0 and zero
   issues.
