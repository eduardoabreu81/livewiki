# Backlog #1 — identifier-aware FTS5 search

Date: 2026-07-28
Base: `main` @ `fd55c89` (pushed; tree clean)
Backlog ref: ROADMAP.md item 1 — "`packages/mcp/src/search.ts` uses the
porter tokenizer, so camelCase / snake_case identifiers are single opaque
tokens: searching "resolve debt" does not match `resolveDebt`. Add
identifier splitting (camelCase, snake_case, kebab-case) at index and
query time. `search.db` is rebuilt on MCP startup, so no schema/migration
cost. Acceptance: a search for a sub-word of any anchored symbol name
returns the page that anchors it."

## Diagnosis (verified in packages/mcp/src/search.ts)

One FTS5 table `wiki_search(wiki_path UNINDEXED, content)` with the porter
tokenizer. Porter stems English (`validation` stems to `valid`?) but treats
`resolveDebt` / `ValidationError` / `resolve_debt` as ONE opaque token —
no query except the whole identifier can match them. FTS5 has no custom
tokenizer available through better-sqlite3, and `trigram` does not solve
the "resolve debt" (two words) → `resolveDebt` (one compound) case.

## Design: split at index AND query, keep snippets original

- New pure helper `splitIdentifiers(text): string` in search.ts:
  - camelCase/PascalCase: split at lower→upper boundaries and acronym
    runs (`resolveDebt` → `resolve Debt`; `HTTPServerError` →
    `HTTP Server Error`);
  - snake_case: split on `_` (`resolve_debt` → `resolve debt`);
  - kebab-case: no-op (FTS5 already splits on `-`);
  - applied to identifier runs `[A-Za-z][A-Za-z0-9_]*` only — plain prose
    passes through unchanged; the ORIGINAL token is kept alongside its
    parts (compound queries still match).
- Second FTS5 table `wiki_search_tokens(wiki_path UNINDEXED, content)`
  created alongside `wiki_search` in `openAndIndex` (IF NOT EXISTS — old
  search.db files upgrade in place; full reindex on startup repopulates,
  so no migration). `reindexAll` and `indexPage` insert the ORIGINAL
  content into `wiki_search` and `splitIdentifiers(content)` into
  `wiki_search_tokens`.
- `search()` runs the (sanitized, split-expanded) query on BOTH tables:
  hits from `wiki_search` first, then unique extras from
  `wiki_search_tokens`, ordered by rank per table, deduped by wiki_path,
  limited as today. Snippets are ALWAYS computed against `wiki_search`
  (original text) — the split content is match-only, never displayed.
- Query side: pass the raw query to `wiki_search` (porter semantics
  unchanged) and the `splitIdentifiers(query)` form to
  `wiki_search_tokens` — "resolve debt" hits the split parts,
  "resolveDebt" hits the preserved original token. Existing FTS5 syntax
  (`"exact phrase"`, `term*`, AND/OR) keeps working; the try/catch that
  returns [] on syntax errors now covers both queries.

## Files to touch

1. `packages/mcp/src/search.ts` — `splitIdentifiers` (exported for
   tests), second table, dual insert, dual query + merge. Doc comment
   updated (tokenizer section explains the two-table design).
2. Tests (new `packages/mcp/src/search.test.ts` or extend
   `server.test.ts` — pick the lighter): split rules per case
   (camelCase, PascalCase+acronym, snake_case, kebab no-op, prose
   untouched, original token preserved); end-to-end acceptance from the
   backlog — a page containing `resolveDebt` is returned for
   `resolve debt`, a page containing `ValidationError` is returned for
   `validation`; porter behavior unchanged (existing search scenarios in
   `server.test.ts` stay green); snippet shows the original text, not the
   split form.
3. Docs: AGENTS.md backlog note (item 1 done) + search.ts doc comment.
   SPEC §"MCP tools" one-liner if it names the tokenizer.

## Non-goals

No trigram/custom tokenizer, no ranking redesign, no schema migration
(search.db is disposable), no viewer/search-UI changes.

## Validation gate

`pnpm -r build && pnpm -r test` green (mcp suite incl. new tests); then a
live smoke on the MPTP MCP index (free, local): search a real sub-word
("validation", "resolve debt") and show the hit — no paid calls.
