# R11-NAV — Intent-first deterministic navigation contract

Date: 2026-07-20

Status: **implemented and deterministically validated in the working tree on
2026-07-20.** Paid calls, benchmark evaluation, commit, and push remain
separately gated.

## Objective

Improve findability and reduce auxiliary noise before the beta release without
adding an LLM task, a page kind, a database table, a dependency, or a public
configuration key.

R11-NAV changes only deterministic presentation. Module identity, exact source
coverage, flow generation, artifact validation, ownership, repair, accounting,
and stale-document detection remain unchanged.

## Generated surfaces

### Quickstart

`livewiki/quickstart.md` uses `## Work by intent` as its first H2. Routes appear
in this order:

1. change product behavior → `tasks.md`;
2. follow end-to-end behavior → each existing flow page by accepted title,
   followed by the complete `flows/index.md` route;
3. inspect implementation relationships → `architecture/overview.md`;
4. maintain tests, fixtures, tooling, benchmarks, or repository documentation
   → `auxiliary/index.md`, only when auxiliary modules exist.

The page remains deterministic, below the existing size caps, and contains no
ranked module list or copied module/flow prose.

### Tasks

`livewiki/tasks.md` contains, in order:

1. `## End-to-end behavior` with title-and-link entries for existing flows;
2. `## Product work` with every product module exactly once, using its accepted
   display title and an existence-gated link;
3. `## Auxiliary work` with exactly one link to `auxiliary/index.md` when
   auxiliary modules exist.

No individual auxiliary module appears in Tasks. Module ids remain identity
only and are not printed as primary labels.

### Auxiliary hub

`livewiki/auxiliary/index.md` is a deterministic inventory of every non-product
module, grouped as fixtures, tooling/benchmarks, and repository documentation.
Existing module pages use title-and-link entries; missing pages use the human
display title plus an explicit unavailable note, never a broken link.

The hub declares `owner: generated`. An existing human, mixed, ownerless, or
unparseable non-empty hub is preserved byte-for-byte. A skipped rewrite is
reported with path and owner in the current init/batch human and JSON result;
the skip is not persisted. A generated hub is removed when no auxiliary module
remains; a protected hub is never removed.

### Architecture overview

`livewiki/architecture/overview.md` retains full cards for product modules.
Auxiliary modules are represented by their total count and exactly one link to
`../auxiliary/index.md`; individual auxiliary cards and links do not appear in
the overview.

All flow and auxiliary routes remain existence-gated.

## Acceptance

- generation is byte-stable under module and flow input reordering;
- Quickstart links directly to every existing flow page and exposes no flow
  link when no flow page exists;
- Tasks contains every product module exactly once and no auxiliary module;
- primary hubs contain exactly one auxiliary-hub route and no individual
  auxiliary-page links;
- the auxiliary hub contains every auxiliary module exactly once and emits no
  dead link for an unavailable page;
- human, mixed, and unparseable auxiliary hubs are never overwritten or
  removed, and their skip is visible in init/batch outputs;
- repository-wide verify remains clean in the deterministic CLI E2E;
- existing flow-hub ownership, manual-block, key-leak, accounting, and
  transactional-write contracts do not weaken.

## Non-goals

- no topic pages or semantic topic planner;
- no compact rewrite of auxiliary module-page bodies;
- no call graph, community detector, embeddings, viewer, daemon, risk score,
  GitHub integration, or new MCP tool;
- no paid provider run or blind benchmark;
- no commit or push without separate maintainer authorization.

## Implementation record

- `navigation.ts` generates intent-first Quickstart/Tasks routes and owns the
  generated auxiliary inventory with the same conservative protection used by
  the flows hub.
- `init.ts` and the post-batch navigation regeneration synchronize the
  auxiliary hub, suppress auxiliary cards in the primary overview, and expose
  protected-hub skips through core results.
- CLI human and JSON output surface `skippedAuxiliaryHub`; the value is not
  persisted.
- Deterministic coverage includes reordered inputs, existence-gated flow
  routes, unavailable auxiliary pages, protected hub ownership, init output,
  batch output, and the pre-existing five-way module-id collision E2E.
- Validation: `pnpm -r build` passed; `pnpm -r test` passed with core 966,
  CLI 86, and MCP 21 tests (12 expected Windows symlink skips in core).
- No provider call, benchmark run, commit, or push was performed.
