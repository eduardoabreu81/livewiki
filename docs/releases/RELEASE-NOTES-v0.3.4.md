## What's fixed since 0.3.2

A patch release that closes four integrity gaps in direct MCP document writes.

> **Packaging note:** 0.3.4 supersedes an unpublished 0.3.3. The first publish
> used `npm publish`, which does not rewrite pnpm `workspace:*` dependency
> protocols, so `@livewiki/cli@0.3.3` and `@livewiki/mcp@0.3.3` could not be
> installed. Those versions were unpublished/deprecated and this set is
> published via `pnpm publish -r`, which rewrites the protocols correctly.

- **Rejected updates preserve the previous page.** `livewiki_write_doc` now
  snapshots the existing page and restores it byte-for-byte when verification
  rejects the candidate or throws. A new page is removed only when that same
  operation created it. Compare-and-swap guards keep rollback from overwriting
  a concurrent edit.
- **Human content is protected on every direct-write path.** Pages declaring
  `owner: human` cannot be replaced, including when `skipVerify` is requested.
  Mixed pages must retain their ownership and every existing `lw:manual` block
  byte-for-byte, including CRLF content.
- **Agent-facing document tools are limited to `livewiki/`.** The MCP read and
  write tools no longer inherit core safe I/O's broader internal allowance for
  `.livewiki/`. The boundary is checked after canonical resolution, so path
  traversal aliases and directory links into the internal cache are rejected.
- **Equivalent paths use one verification identity.** Forward-slash,
  backslash, and leading `./` spellings normalize to the same canonical wiki
  path before writing, matching verifier issues, indexing search, recording
  activity, and reporting success. `skipVerify` responses now say
  `verification skipped` instead of claiming the page was verified.

The shared operation lives in `@livewiki/core/wiki-document`; the MCP server
owns only protocol validation and response formatting.

## Validation

- TypeScript build and type-check passed for all packages.
- Focused MCP validation passed 52 tests.
- The complete deterministic suite passed 2,433 tests with 19 expected skips.
- A second isolated behavioral smoke passed 9/9 scenarios, including Windows
  junction escape rejection, verifier-crash restoration, CRLF manual-block
  preservation, and canonical disk/FTS identity.

## Compatibility

- **No schema change and no migration.** The index schema remains v10.
- Upgrade `@livewiki/core`, `@livewiki/mcp`, and `@livewiki/cli` together; they
  are released as one version-locked set.
- Restart long-lived MCP servers after upgrading so they use the corrected
  write boundary.
