# Phase 6 — Export to repository wikis

**Status:** Lot 6A implemented; Lot 6B deferred pending a SPEC amendment.
**Date:** 2026-07-15 (revised)
**SPEC anchor:** SPEC §"Phase 6 — Export to repository wikis" and the
inviolable rules (rules #1, #3, #4, #6, #7, #8).

This document records the maintainer decisions that gate Lot 6B
and the preflight contract for Lot 6A. The implementation lives
in `packages/core/src/export.ts`, the CLI surface in
`packages/cli/src/commands/export.ts`, and the focused tests in
`packages/core/src/export.test.ts` and
`packages/cli/src/cli-export-e2e.test.ts`.

---

## 1. Two implementation lots

The Phase 6 SPEC paragraph crams two distinct things into one
command: (1) a local deterministic transformation of the
`livewiki/` snapshot, and (2) optional Git publication of that
snapshot. The second is qualitatively different: it shells out to
`git`, it mutates files outside `livewiki/`, and it performs
opt-in network activity. Per rule #1 (writes via allowlist) and
rule #4 (no network except LLM calls), Git publication requires
an explicit SPEC exception that the first lot must NOT assume.

### Lot 6A — local deterministic export (this assessment's scope)

- Source: on-disk `livewiki/`.
- Destination: `.livewiki/export/<target>/` (inside the existing
  `.livewiki/` allowlist — no safe-io exception).
- Targets: `generic`, `github-wiki`, `gitlab-wiki`.
- No arbitrary external `--out`. No network, no clone, no
  commit, no push, no git subprocess.
- Exit codes: 0 success, 1 any failure. `--json` preserves the
  same semantics. No partial-success / no batch-style 0/1/2
  mapping.

### Lot 6B — optional Git publication (deferred)

Clone or init the wiki working tree, apply the snapshot, commit,
push. Requires a SPEC amendment (a `git` subprocess writes files
and runs commands; `git push` is opt-in network). The amendment
must identify the clone/worktree strategy, branch policy, commit
message template, remote configuration, credential flow, and
failure semantics. Lot 6A does not commit to any of these. Push
failure must be nonzero in both human and JSON modes.

---

## 2. Corrections to earlier claims about the current code

The previous draft named a few existing primitives as "already
available" for the export. Three claims were not supported:

1. **`walker.ts` does not enumerate the wiki.** It walks the
   user's source tree, not `livewiki/`, and filters by
   `EXTENSION_LANG` (TS/JS/Python only) — `.md` and `.mmd` are
   rejected. Lot 6A needs its own deterministic recursive
   enumeration of `.md` and `.mmd` under `livewiki/`.
2. **`verify` has no `--export-target` mode.** The existing
   `verify.run` reads `livewiki/` against the SQLite index and
   is not a generic Markdown validator. Lot 6A adds a small
   export-specific internal-link validation step without
   modifying `verify`.
3. **Markdown masking is reused.** Lot 6A imports and uses
   `maskCodeSpansPreservingLength` from `packages/core/src/markdown-mask.ts`
   to skip inline code and fenced code blocks when scanning for
   Markdown links. The function preserves source length and line
   terminators, which is required for CRLF sources.

No other primitives are assumed. The export builds its own
enumeration, link rewriting, and validation. It uses `safe-io`
(writes go to `.livewiki/`, the existing allowlist),
`frontmatter` (strip `anchors:` and parse the body), and
`anchors` (locate `lw:manual` byte ranges when needed).
Everything else is new code in `packages/core/src/export.ts`.

---

## 3. Honest contract: preflight, not transactional

The export is a **preflight-then-write** pipeline, not a transactional
atomic snapshot. The honest contract is:

1. **Scan** every source file (`.md` and `.mmd`) under `livewiki/`
   into memory via `safeIo.readText`. No file is written yet.
2. **Transform** every page: strip only the top-level `anchors:`
   field (every other frontmatter field is preserved byte-for-byte),
   strip `<!-- lw:anchors ... -->` markers, rewrite internal links
   to the destination tree, replace Mermaid placeholders, insert
   the generated marker.
3. **Preflight** before any write:
   - Flattened-name collisions — **fatal**.
   - Broken source links — **fatal**.
   - Referenced Mermaid diagrams that are missing — **fatal**,
     not a warning.
   - Empty source (no `.md` / `.mmd` under `livewiki/`) — **fatal**.
     An empty source must NOT delete previously exported pages.
   - Destination overwrite conflicts (a destination file exists
     and lacks the generated marker) — fatal unless `--force`
     is set.
   - Unsafe destination entries (symlink escapes, unreadable
     files, directories where files are expected) — **fatal**;
     `--force` does NOT bypass these.
4. **Write** the complete snapshot to
   `.livewiki/export/<target>/` only if preflight is clean.
   A preflight failure leaves the destination unchanged.
5. **Stale** destination files that carry the generated marker
   are removed only when they are not in the new snapshot
   (a source file was deleted). Stale files without the
   generated marker are NEVER removed.
6. **Honest failure semantics**: an unforeseen filesystem
   failure during write or removal may leave the derived
   export partially updated. The command returns exit 1 in
   that case and an idempotent rerun repairs it. The
   implementation does NOT use a staging directory or
   Git-like transaction system; such a system is out of
   scope for Lot 6A.

All production writes, directory creation, removals, and
individual file reads go through `safeIo` (SPEC rule #1).
The destination root `.livewiki/export/<target>/` is inside
the existing `.livewiki/` allowlist — no safe-io exception
is needed. The CLI wraps `exportWiki` in a try/catch and
converts any thrown `ExportError` (e.g. invalid target) into
a structured `ExportResult` so the JSON contract is always
honored and the global fatal handler never sees it.

The generated marker is the single source of truth for
"is this file mine to overwrite or remove?" — no destination
manifest is required in Lot 6A.

---

## 4. Destination ownership — what "untouchable" means for export

Rule #6 protects SOURCE `owner: human` and `lw:manual` content
from automated mutation in `livewiki/`. The export is a
read-only transformation:

- The source `livewiki/` is never written. Rule #6 is trivially
  respected.
- The destination is a transformed copy. Its files are new and
  carry the generated marker.
- All destination pages (regardless of source `owner:`) receive
  the same mechanical treatment: link rewriting, Mermaid
  inlining, marker insertion. This is necessary because the
  destination is a published wiki where every internal link must
  resolve.
- Prose is never reworded by an LLM. The export is deterministic.
  "Byte-for-byte" is not the right claim: links and metadata
  change. The right claim is "source files are byte-preserved in
  `livewiki/`, destination is a deterministic transformation."

---

## 5. Links and platform behavior

The earlier draft added host-specific anchor prefixes
(`user-content-` for GitHub) and a `slugify` change. Both are
forbidden.

- **Filename case is preserved**, except for the SPEC home-page
  mapping:
  - `github-wiki`: `livewiki/quickstart.md` → `Home.md`.
  - `gitlab-wiki`: `livewiki/quickstart.md` → the SPEC-defined
    equivalent (the lot looks up the exact string in the SPEC).
- **Flattening**: `architecture/overview.md` →
  `architecture-overview.md`. Walk the path components, join
  with `-`, keep the file extension. Deterministic under input
  reordering (sort input by path first).
- **Fragments**: the export preserves the slug verbatim, with
  no `user-content-` prefix. The destination fragment is the
  `slugify` output of the source heading (`anchors.ts:slugify`).
- **No host-specific behavior** is assumed beyond the home-page
  mapping.
- **Collisions**: a flattening collision is a **fatal preflight
  error** in Lot 6A. The user renames one of the source paths.

---

## 6. Mermaid handling for Lot 6A

Mermaid diagrams in `livewiki/` live in two forms:

- **Standalone files**: `livewiki/diagrams/<module>.classes.mmd`,
  `livewiki/architecture/structure.mmd`,
  `livewiki/architecture/modules.mmd`. Referenced by pages.
- **Placeholder fences** inside markdown: pages like
  `livewiki/architecture/overview.md` include a fenced
  ```` ```mermaid ```` block whose first non-blank line is
  `%% livewiki/<path>`.

Lot 6A treats both forms the same way:

1. Enumerate every `.mmd` file under `livewiki/`.
2. Convert each `.mmd` to a flattened `.md` page in the
   destination. The body is a fenced ```mermaid block with the
   diagram source verbatim, preceded by the generated marker.
3. Rewrite every internal link of the form `<...>.mmd` to point
   at the generated `.md` page.
4. Replace the exact `%% livewiki/<path>` placeholder line inside
   any markdown page with a normal link to the generated `.md`
   page (the fenced ```mermaid block in that markdown page is
   removed because the destination now has the separate diagram
   page).
5. **Missing referenced diagrams** are a **fatal preflight
   error**. There is no warning-only path.

The destination never carries a `.mmd` file. The wiki hosts in
the SPEC's MVP render fenced `mermaid` blocks; that is the only
form we emit.

---

## 7. Generated marker — exact form and detection

Every destination file receives one exact marker, placed
immediately after the retained frontmatter closing fence (if any):

```html
<!-- livewiki:generated source="livewiki/<source-rel-path>" -->
```

Examples:

- `<!-- livewiki:generated source="livewiki/quickstart.md" -->`
- `<!-- livewiki:generated source="livewiki/architecture/overview.md" -->`
- `<!-- livewiki:generated source="livewiki/diagrams/auth.classes.mmd" -->`

**Detection** for overwrite/stale decisions searches the file's
**header region** (frontmatter + first 32 body lines), not just
the first line. A destination file may have a frontmatter block
before the marker without breaking the overwrite decision.

A destination file is "previously generated by livewiki" iff its
header region contains a `<!-- livewiki:generated source="..." -->`
marker whose `source=` value matches the source file currently
being exported. A file with a `livewiki:generated` marker for a
DIFFERENT source path is an orphan and is never overwritten
without `--force`.

---

## 8. Out of scope for Lot 6A

Lot 6A explicitly does not introduce any of the following. They
are deferred to a future lot if a SPEC amendment or a real user
need justifies them:

- Destination manifest (the generated marker is sufficient).
- Home filename overrides.
- `--map <json>` for stable rewrite maps.
- `--keep-mermaid-files`.
- Arbitrary `--out <dir>` (Lot 6A always writes under
  `.livewiki/export/<target>/`).
- `--dry-run` (out of scope for Lot 6A).
- Host-specific anchor prefixes.
- Partial-success exit codes (the only signal is 0 or 1).
- Anything requiring shell execution or network I/O (`--push`,
  `--clone`, etc.).

---

## 9. Source link notice — one maintainer decision

When the destination file is later published (Lot 6B), a reader
will want to navigate back to the source repository. The export
cannot infer a canonical host URL today (the source repo's host
is not in `.livewiki/config.json`). This is recorded as a single
maintainer decision:

> **Decision 1 (source-link base URL strategy).** The export
> either:
> (a) requires a `repository.url` field in
> `.livewiki/config.json` (a small additive config change) and
> emits absolute links to that URL, or
> (b) emits the repository-relative source path
> (`livewiki/<path>`) and lets Lot 6B fill in the canonical URL.
>
> Lot 6A does NOT implement either. Until the maintainer decides,
> the `source=` attribute holds the repository-relative path.

---

## 10. Lot 6A — exact file scope and focused tests

### 10.1 Files to add or change

- `packages/core/src/export.ts` — new orchestrator. Public:
  `exportWiki(opts: ExportOptions): Promise<ExportResult>`. Pure
  deterministic transformation; no network, no git.
- `packages/core/src/index.ts` — re-export the new module.
- `packages/core/package.json` — add the `./export` subpath
  export.
- `packages/cli/src/commands/export.ts` — replace the Phase 0
  stub. Positional target: `<generic|github-wiki|gitlab-wiki>`,
  options: `--force`, plus global `--json` and `--repo`. The
  `--push <remote>` option is visible in help but rejected with
  a structured `invalid_push` error before any filesystem I/O
  (deferred to Lot 6B). No `--out`, `--dry-run`, `--map`, or
  `--keep-mermaid-files`.
- `packages/core/src/export.test.ts` — focused unit tests. The
  test suite builds temporary repositories with `node:os.tmpdir()`
  and `node:fs.mkdtemp`; no on-disk fixture directory is required.
- `packages/cli/src/cli-export-e2e.test.ts` — focused E2E tests.

### 10.2 Focused tests for Lot 6A

`export.test.ts`:

- Deterministic enumeration of `.md` and `.mmd` under `livewiki/`.
- Filename flattening (`architecture/overview.md` →
  `architecture-overview.md`).
- Home-page rename per target.
- Fragment preservation (no `user-content-`).
- Frontmatter `anchors:` key stripped from destination.
- `<!-- lw:anchors ... -->` markers removed from destination.
- Internal link rewriting (`[text](page.md)`,
  `[text](page.md#section)`).
- `.mmd` files converted to a fenced-mermaid `.md` page.
- `%% livewiki/<path>` placeholders replaced by a link to the
  generated diagram page.
- Missing referenced diagram is a fatal preflight error.
- Flattening collision is a fatal preflight error.
- Broken source link is a fatal preflight error.
- Generated marker appears in the destination header region.
- Preflight failure leaves the destination tree empty (any
  preflight error aborts before any write).
- Generated-marker detection handles a frontmatter-first file.

`cli-export-e2e.test.ts`:

- `livewiki export generic` produces a flat tree at
  `.livewiki/export/generic/`.
- `livewiki export github-wiki` renames `quickstart.md` to `Home.md`.
- `livewiki export gitlab-wiki` renames `quickstart.md` to the SPEC
  home-page equivalent.
- Re-running produces a byte-identical destination tree
  (idempotence).
- A pre-placed destination file without the generated marker is
  refused (exit 1) unless `--force` is set, in which case it is
  overwritten.
- A pre-placed destination file whose marker is for a DIFFERENT
  source path is treated as an orphan and refused without
  `--force`.
- Exit code is 0 on success, 1 on any preflight or write failure,
  including under `--json`.

### 10.3 Acceptance gates

- `pnpm -r build` and `pnpm -r test` are green on every supported
  host (Windows, Linux, macOS — Node ≥ 20). The remote matrix
  workflow is `.github/workflows/cross-platform-ci.yml`; the lot
  is NOT closed until that workflow has been observed green on
  all three OS hosts.
- All existing test files pass without modification
  (`safe-io.test.ts`, `frontmatter.test.ts`, `anchors.test.ts`,
  `manifest.test.ts`, `verify.test.ts`, `navigation.test.ts`,
  `key-leak.test.ts`).
- The cross-platform product contract in `SPEC.md` is honored:
  no shell-specific syntax in the CLI; durable keys, markers,
  manifest paths, and Markdown links use forward slashes; LF and
  CRLF inputs are both supported; paths with spaces and Unicode
  work on every host; the CLI JSON shape and exit codes are
  identical across operating systems.
- Symlink coverage (export security regression tests) runs on
  every Unix host. A Unix host that skips the symlink tests is a
  CI contract violation; the guard in `export.test.ts` makes it
  enforceable.
- No file is written outside `.livewiki/`. The destination
  always lives under `.livewiki/export/<target>/`.
- The export is reproducible: same source → same destination
  bytes (re-run + diff) on every host.
- `key-leak.test.ts` is green on every host.

---

## 11. Lot 6B — deferred requirements

Lot 6B is a separate SPEC amendment. It must specify, at minimum:

- Clone or worktree strategy.
- Branch policy.
- Commit message template (auto-generated, deterministic, no
  LLM).
- Remote configuration.
- Credential flow (SSH agent, `GIT_ASKPASS`, or `~/.gitconfig`;
  never an embedded token).
- Failure semantics (push failure = exit 1 in both human and
  JSON modes; partial progress on the wiki side is preserved so
  the user can re-run safely).
- Interaction with the source `livewiki/` (a Lot 6B re-publish
  must NOT touch the source).
- Interaction with the destination (a stale destination file
  with the generated marker, source gone, is removed by Lot 6A's
  re-export; Lot 6B commits that result).

Lot 6A does not commit to any of these. The maintainer must
approve the SPEC amendment before Lot 6B starts.

---

## 12. Two maintainer decisions

1. **Source-link base URL strategy (§9).** The export either
   requires a `repository.url` field in `.livewiki/config.json`
   and emits absolute links, or emits the repository-relative
   source path and lets Lot 6B fill in the canonical URL. Lot
   6A does not need this decision to ship; Lot 6B does.
2. **Approval of the future SPEC exceptions for opt-in Git
   subprocess / network (§1, §11).** Lot 6A does not require
   this; Lot 6B does. The amendment must be explicit about
   clone/worktree, branch, commit, remote, credential, and
   failure semantics before Lot 6B starts.

No other decisions are blocking. Filename, anchor, link-rewrite,
and Mermaid-inlining rules are determined by the corrective
prompt and the SPEC paragraph.
