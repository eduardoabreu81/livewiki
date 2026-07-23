/**
 * flows — deterministic flow-candidate detector (stage 5).
 *
 * SPEC §"Semantic product-flow layer"; design contract in
 * `docs/tasks/2026-07-18-semantic-product-flow/DESIGN.md` §4.
 *
 * Stage 5 documents a small, capped set of cross-module semantic product
 * flows. This module decides WHICH flows exist, purely from index facts:
 * the module list, the module import graph, active symbol keys per file,
 * and external import specifiers per file. It is a pure function — no disk
 * I/O, no db access, no LLM — and it is deterministic under input
 * reordering: shuffling the modules/edges arrays or the map insertion
 * orders must produce byte-identical output. All iteration happens over
 * sorted structures; input maps are only ever looked up, never iterated
 * (each is copied once into a normalized lookup).
 *
 * Signals (computed per module):
 *   - entry: in-degree 0 in the module graph, OR any of its files matches
 *     the entry patterns (gitignore-style, same matcher as
 *     `classifyPathRole`; defaults in DEFAULT_FLOW_SIGNAL_PATTERNS).
 *   - persistence: any file matches the persistence patterns, OR any file
 *     has an external import specifier matching persistenceImportPatterns
 *     (gitignore-style over specifier strings; default empty — no built-in
 *     package-name guessing).
 *   - external boundary: any file has third-party import specifiers
 *     (non-relative, non-`node:`) per `externalImportsByFile`; an absent
 *     map means no external signal. Per-occurrence accounting (R10.1 J):
 *     an occurrence (file, specifier) with a resolved internal edge in
 *     `resolvedEdges` is NOT external — the same specifier may be internal
 *     in one file and external in another.
 *   - sink: out-degree 0 in the module graph.
 *   - product role: `classifyModuleRole === "product"` (ranking only).
 *
 * A candidate is a simple path (no repeated module) starting at a walk
 * root — a module with the `entry` signal whose files are NOT entirely
 * test code per `isTestPath` (2026-07-23: a zero-indegree test-only module
 * used to qualify as a root on the `entry` signal alone — nothing product
 * imports a test file either, so indegree 0 is as true of a test module as
 * a real entry point — producing flows whose entry tier was made of
 * unittest test methods rather than product code) — stopped at a sink or
 * at length 8, that crosses at least one boundary module (persistence or
 * external) and has length >= 2.
 * Enumeration is a deterministic DFS (sorted module ids, sorted edges)
 * with a PER-ROOT budget (FLOW_PER_ROOT_PATH_BUDGET enumerated simple
 * paths per entry root, R10.1 H1) — a root with more paths than the
 * budget is truncated WITHOUT starving the other roots. The qualified
 * walks of all roots are then unioned and deduped. Proper prefixes of a
 * longer qualified path are dropped, and each entry+sink pair keeps only
 * its longest path.
 *
 * Ranking (R10.1 H3): product-role module count desc, then centrality
 * desc — the number of qualified walks of the union sharing at least one
 * MODULE with the candidate (R10.1 H2) — then slug asc. `maxFlows`
 * (default 4; 0 disables) applies only after ranking. A repo with no
 * qualifying walk produces zero candidates — a valid outcome, not a
 * failure.
 *
 * Seed keys (R10.1 K): every key of the walk is classified by path role
 * (product vs auxiliary — `classifyPathRole` combined with the
 * deterministic `isTestPath`) and by semantic role (T1 entry / T2
 * crossing / T3 boundary-sink; a key may hold several). The candidate
 * carries explicit groups — entryKeys (T1), boundaryKeys (T2), sinkKeys
 * (T3), otherProductKeys (T4: product keys with no semantic role),
 * auxiliaryKeys (T5: auxiliary keys not admitted to a semantic group).
 * Each group is capped to the closed list (a key truncated from
 * `seedKeys` is dropped from every group, order preserved), so the union
 * of the five groups EQUALS `seedKeys`, always. Within T1/T2/T3 an
 * auxiliary key
 * enters the group ONLY when no product key holds that role (a
 * legitimately test-shaped entry keeps its keys; a product flow never
 * presents test helpers as primary evidence).
 *
 * The closed list (`seedKeys`) is filled in two passes: pass 1 reserves
 * one key per non-empty T1/T2/T3 group (a reserved key covers every
 * group it belongs to; the group's first key in round-robin order —
 * modules in walk order, keys sorted within a module); pass 2 fills in
 * tier priority T1→T5 (round-robin across the walk's modules, one key
 * per module per round) until `flowMaxAnchors`. Two skips are decided
 * deterministically BEFORE any LLM call, recorded on the candidate
 * (`skip`) and never turned into tasks: (K-a) the cap cannot fit the
 * mandatory group reservation (`insufficient_anchor_capacity`); (K-b)
 * after pass 1 plus a top-up to three distinct keys from the remaining
 * pool in the same T1→T5 priority order as pass 2 (the three required
 * flow sections each need their own anchor), the list still holds fewer
 * than 3 distinct keys (`insufficient_section_anchor_coverage`).
 */

import ignore from "ignore";
import {
  classifyModuleRole,
  classifyPathRole,
  DEFAULT_FLOW_SIGNAL_PATTERNS,
  matchesAnyPathPattern,
  normalizeRepoPath,
} from "./modules.js";
import type {
  FlowSignalConfig,
  Module,
  ModuleGraphEdge,
  PathRoleConfig,
} from "./modules.js";
import { moduleSlug } from "./diagrams.js";
import { CONFIG_DEFAULTS } from "./config.js";
import type { ResolvedImportEdge } from "./import-resolution.js";

/**
 * Per-entry-root budget of enumerated simple paths (R10.1 H1): a root's
 * DFS stops beyond it WITHOUT consuming other roots' budgets — a root
 * with more paths never prevents another root's participation.
 */
export const FLOW_PER_ROOT_PATH_BUDGET = 64;

/** Maximum modules per walk (the entry module counts as 1). */
export const FLOW_MAX_PATH_LENGTH = 8;

/** Evidence for the signals observed along one candidate's walk. */
export interface FlowCandidateSignals {
  /** Entry evidence: entry module ids and matched entry patterns. */
  entry: string[];
  /** Persistence evidence: module ids and matched patterns (path + import channels). */
  persistence: string[];
  /** External package specifiers observed on the walk (sorted, unique). */
  external: string[];
}

/**
 * Deterministic pre-LLM skip codes (R10.1 K). A skipped candidate never
 * becomes a stage-5 task; the skip is recorded on the run result instead.
 */
export type FlowSkipCode =
  /** K-a: `flowMaxAnchors` cannot fit the mandatory T1/T2/T3 group reservation. */
  | "insufficient_anchor_capacity"
  /** K-b: fewer than 3 distinct seed keys available (the three required flow sections each need their own anchor). */
  | "insufficient_section_anchor_coverage";

export interface FlowCandidateSkip {
  code: FlowSkipCode;
  message: string;
}

export interface FlowCandidate {
  /**
   * `moduleSlug("<entryModuleId>-to-<sinkModuleId>")`, disambiguated
   * deterministically with `-2`, `-3`, ... on collision.
   */
  slug: string;
  /** Human-ish deterministic seed, e.g. "<entry display> to <sink display>". */
  titleSeed: string;
  /** Module ids ordered along the walk, entry first. */
  moduleIds: string[];
  /**
   * Closed list: two-pass tier fill (R10.1 K, see the module docblock),
   * capped at `flowMaxAnchors`. Union of the five key groups below.
   */
  seedKeys: string[];
  /** T1 (entry) keys — product keys; auxiliary only when no product key holds the role. */
  entryKeys: string[];
  /** T2 (crossing) keys — same product/auxiliary rule. */
  boundaryKeys: string[];
  /** T3 (boundary/sink) keys — same product/auxiliary rule. */
  sinkKeys: string[];
  /** T4: product keys of the walk holding no semantic role. */
  otherProductKeys: string[];
  /** T5: auxiliary keys not admitted to entryKeys/boundaryKeys/sinkKeys. */
  auxiliaryKeys: string[];
  /** Deterministic pre-LLM skip (K-a/K-b); absent when the candidate is runnable. */
  skip?: FlowCandidateSkip;
  signals: FlowCandidateSignals;
}

/** The three required flow-page sections a closed-list key can be assigned to. */
export type FlowRequiredSection = "purpose" | "ordered-flow" | "failure-and-recovery";

/** Total map from every `FlowCandidate.seedKeys` entry to its one authoritative section. */
export type FlowKeySectionMap = ReadonlyMap<string, FlowRequiredSection>;

export interface FlowDetectionOptions {
  modules: Module[];
  edges: ModuleGraphEdge[];
  /** File path -> active symbol keys. */
  symbolsByFile: Map<string, string[]>;
  /** File path -> external (non-relative, non-`node:`) package specifiers. */
  externalImportsByFile?: Map<string, string[]>;
  /**
   * Resolved internal import edges (R10.1 J — the SAME edges the module
   * graph consumed). An occurrence (file, specifier) present here is
   * excluded from external evidence; without it, every bare specifier is
   * external (the historical behavior).
   */
  resolvedEdges?: ResolvedImportEdge[];
  pathRoleConfig?: PathRoleConfig;
  /** Per-category replacement of DEFAULT_FLOW_SIGNAL_PATTERNS. */
  flowSignals?: FlowSignalConfig;
  /** Default 4; 0 => zero candidates. */
  maxFlows?: number;
  /** Default 25. */
  flowMaxAnchors?: number;
  /**
   * Priority-0 Phase 3 (symbol call graph): symbol keys PROVEN to be
   * called from a different module by a resolved edge in the indexed
   * call graph (see call-resolution.ts). Purely additive and optional —
   * absent (or empty) reproduces the exact pre-existing behavior. When
   * present, it only RE-ORDERS the T2 (crossing) group so a key with a
   * real, resolved cross-module call is preferred over a merely path/
   * import-heuristic-matched one whenever both are otherwise eligible;
   * it never changes which keys are IN a group, never adds a flow
   * candidate, and never changes seedKeys' final size. This module stays
   * a pure function — the caller (batch.ts) computes this set from its
   * own DB access, since flows.ts itself never touches the database.
   */
  resolvedCrossModuleCallees?: ReadonlySet<string>;
}

/** Per-module signal bundle, computed once per detection run. */
interface ModuleSignals {
  entry: boolean;
  entryPatterns: string[];
  persistence: boolean;
  persistencePatterns: string[];
  external: boolean;
  externalPackages: string[];
  product: boolean;
}

const compareStrings = (a: string, b: string): number => a.localeCompare(b);

/**
 * Detects the bounded set of flow candidates for stage 5. Pure and
 * deterministic; see the module docblock for the contract.
 */
export function detectFlowCandidates(opts: FlowDetectionOptions): FlowCandidate[] {
  const maxFlows = opts.maxFlows ?? CONFIG_DEFAULTS.maxFlows;
  if (maxFlows <= 0 || opts.modules.length === 0) return [];
  const maxAnchors = Math.max(0, opts.flowMaxAnchors ?? CONFIG_DEFAULTS.flowMaxAnchors);

  const entryPatterns =
    opts.flowSignals?.entryPatterns ?? DEFAULT_FLOW_SIGNAL_PATTERNS.entryPatterns;
  const persistencePatterns =
    opts.flowSignals?.persistencePatterns ?? DEFAULT_FLOW_SIGNAL_PATTERNS.persistencePatterns;
  const persistenceImportPatterns =
    opts.flowSignals?.persistenceImportPatterns ??
    DEFAULT_FLOW_SIGNAL_PATTERNS.persistenceImportPatterns;

  // Sorted module list; first module wins on duplicate ids (sorted by id
  // then first path, so even that degenerate case is deterministic).
  const modules = [...opts.modules].sort((a, b) => {
    const c = a.id.localeCompare(b.id);
    if (c !== 0) return c;
    return (a.paths[0] ?? "").localeCompare(b.paths[0] ?? "");
  });
  const moduleById = new Map<string, Module>();
  for (const m of modules) {
    if (!moduleById.has(m.id)) moduleById.set(m.id, m);
  }

  // Normalized lookups (input maps are copied once, then only looked up —
  // never iterated — so their insertion order cannot leak into the output).
  const symbolsLookup = normalizeFileMap(opts.symbolsByFile);
  const externalLookup = opts.externalImportsByFile
    ? normalizeFileMap(opts.externalImportsByFile)
    : undefined;
  // Per-occurrence internal-edge lookup ("<file>\0<specifier>"): an
  // occurrence found here resolved internally and is never external
  // evidence. Lookup-only — iteration order cannot leak into the output.
  const resolvedLookup = opts.resolvedEdges
    ? new Set(
        opts.resolvedEdges.map((e) => `${normalizeRepoPath(e.fromFile)}\0${e.source}`),
      )
    : undefined;

  // Deduped, sorted edge list restricted to known modules.
  const edgeSeen = new Set<string>();
  const edges: ModuleGraphEdge[] = [];
  for (const e of opts.edges) {
    if (e.from === e.to) continue;
    if (!moduleById.has(e.from) || !moduleById.has(e.to)) continue;
    const key = `${e.from}\0${e.to}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    edges.push({ from: e.from, to: e.to });
  }
  edges.sort((a, b) =>
    a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from),
  );

  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const m of modules) {
    adjacency.set(m.id, []);
    indegree.set(m.id, 0);
  }
  for (const e of edges) {
    adjacency.get(e.from)!.push(e.to);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }
  for (const list of adjacency.values()) list.sort(compareStrings);

  const filesByModule = new Map<string, string[]>();
  const signalsById = new Map<string, ModuleSignals>();
  for (const m of modules) {
    const files = m.paths.map(normalizeRepoPath).sort(compareStrings);
    filesByModule.set(m.id, files);
    signalsById.set(
      m.id,
      computeModuleSignals(m, files, {
        indegree: indegree.get(m.id) ?? 0,
        entryPatterns,
        persistencePatterns,
        persistenceImportPatterns,
        externalLookup,
        resolvedLookup,
        pathRoleConfig: opts.pathRoleConfig,
      }),
    );
  }

  // A walk root must be `entry` (zero indegree, or an entry-pattern match)
  // AND not entirely test code — indegree alone is a weak signal: nothing
  // else in the repo importing a module is exactly as true of a genuine
  // product entry point as it is of a test-only module (nothing product
  // imports a test file either). Without this guard, EVERY zero-indegree
  // test module becomes a valid flow root, producing a "flow" whose entry
  // tier is made of unittest test methods rather than product code — a
  // real, confirmed failure mode (2026-07-23, MoneyPrinterTurbo-Plus's
  // `test-services-02-to-app-utils`: 24 of 25 seed keys were test methods,
  // leaving the `otherProductKeys`/`auxiliaryKeys` groups EMPTY, which
  // starved "Ordered flow" of any key not already claimed by another
  // section and drove repeated duplicate_anchor failures). `classifyPathRole`
  // deliberately still counts test SOURCE as "product" (test code is
  // legitimate documentation content); `isTestPath` is the narrower,
  // flow-specific signal that a module is test code, not the entry point
  // of a real product flow — a module already excluded from tooling/docs
  // ranking via its `product` role can still be a root, only an
  // ALL-test-files module cannot.
  const entryIds = modules
    .map((m) => m.id)
    .filter((id) => {
      if (!signalsById.get(id)!.entry) return false;
      const files = filesByModule.get(id) ?? [];
      return !(files.length > 0 && files.every((f) => isTestPath(f)));
    });

  // Deterministic DFS per entry root (sorted roots, sorted edges), each
  // root with its OWN enumeration budget (R10.1 H1): a root with more
  // than FLOW_PER_ROOT_PATH_BUDGET simple paths is truncated without
  // starving the other roots. Qualified walks are unioned and deduped.
  const qualified: string[][] = [];
  const qualifiedSeen = new Set<string>();
  for (const entryId of entryIds) {
    let enumerated = 0;
    const visit = (path: string[]): void => {
      enumerated++;
      if (path.length >= 2 && crossesBoundary(path, signalsById)) {
        const key = path.join("\0");
        if (!qualifiedSeen.has(key)) {
          qualifiedSeen.add(key);
          qualified.push([...path]);
        }
      }
      if (path.length >= FLOW_MAX_PATH_LENGTH) return;
      const last = path[path.length - 1]!;
      for (const next of adjacency.get(last) ?? []) {
        if (enumerated >= FLOW_PER_ROOT_PATH_BUDGET) return;
        if (path.includes(next)) continue;
        path.push(next);
        visit(path);
        path.pop();
      }
    };
    visit([entryId]);
  }

  // Drop proper prefixes of a longer qualified path, then keep only the
  // longest path per entry+sink pair (ties: lexicographically smallest).
  const survivors = qualified.filter(
    (p) => !qualified.some((q) => q !== p && isProperPrefix(p, q)),
  );
  const bestByPair = new Map<string, string[]>();
  for (const p of survivors) {
    const key = `${p[0]!}\0${p[p.length - 1]!}`;
    const current = bestByPair.get(key);
    if (current === undefined || compareLongestFirst(p, current) < 0) {
      bestByPair.set(key, p);
    }
  }

  // Slugs: base = moduleSlug("<entry>-to-<sink>"); collisions resolved in a
  // canonical order (base slug asc, then path asc) with -2, -3, ... so the
  // assignment does not depend on enumeration or ranking order.
  const pending = [...bestByPair.values()]
    .map((path) => ({
      path,
      baseSlug: moduleSlug(`${path[0]!}-to-${path[path.length - 1]!}`) || "flow",
    }))
    .sort((a, b) => {
      const c = a.baseSlug.localeCompare(b.baseSlug);
      if (c !== 0) return c;
      return comparePathLex(a.path, b.path);
    });
  // R10.1 H2: centrality = number of qualified walks of the union that
  // share at least one MODULE with the candidate (the candidate's own
  // walk belongs to the union, so centrality is at least 1).
  const qualifiedModuleSets = qualified.map((q) => new Set(q));
  const centralityOf = (path: string[]): number => {
    let n = 0;
    for (const q of qualifiedModuleSets) {
      if (path.some((id) => q.has(id))) n++;
    }
    return n;
  };

  const takenSlugs = new Set<string>();
  const ranked = pending.map(({ path, baseSlug }) => {
    let slug = baseSlug;
    let n = 2;
    while (takenSlugs.has(slug)) {
      slug = `${baseSlug}-${n}`;
      n++;
    }
    takenSlugs.add(slug);
    const candidate = buildCandidate(path, slug, {
      moduleById,
      filesByModule,
      signalsById,
      symbolsLookup,
      maxAnchors,
      entryPatterns,
      persistencePatterns,
      persistenceImportPatterns,
      externalLookup,
      resolvedLookup,
      resolvedEdges: opts.resolvedEdges,
      pathRoleConfig: opts.pathRoleConfig,
      resolvedCrossModuleCallees: opts.resolvedCrossModuleCallees,
    });
    const productCount = path.filter((id) => signalsById.get(id)!.product).length;
    return { candidate, productCount, centrality: centralityOf(path) };
  });

  // R10.1 H3: product-role count desc, centrality desc, slug asc;
  // `maxFlows` applies only after this ranking.
  ranked.sort((a, b) => {
    if (a.productCount !== b.productCount) return b.productCount - a.productCount;
    if (a.centrality !== b.centrality) return b.centrality - a.centrality;
    return a.candidate.slug.localeCompare(b.candidate.slug);
  });

  return ranked.slice(0, maxFlows).map((r) => r.candidate);
}

function computeModuleSignals(
  module: Module,
  files: string[],
  ctx: {
    indegree: number;
    entryPatterns: string[];
    persistencePatterns: string[];
    persistenceImportPatterns: string[];
    externalLookup?: Map<string, string[]> | undefined;
    resolvedLookup?: ReadonlySet<string> | undefined;
    pathRoleConfig?: PathRoleConfig | undefined;
  },
): ModuleSignals {
  // Booleans use the COMBINED matcher per file (same as classifyPathRole),
  // so gitignore negations apply across the whole list; per-pattern
  // matching below is evidence-only.
  const entryMatch = files.some((file) => matchesAnyPathPattern(file, ctx.entryPatterns));
  const persistencePathMatch = files.some((file) =>
    matchesAnyPathPattern(file, ctx.persistencePatterns),
  );
  const matchedEntry = matchedPatterns(files, ctx.entryPatterns);
  const matchedPersistence = matchedPatterns(files, ctx.persistencePatterns);
  const externalPackages = new Set<string>();
  if (ctx.externalLookup) {
    for (const file of files) {
      for (const spec of ctx.externalLookup.get(file) ?? []) {
        if (!isExternalSpecifier(spec)) continue;
        // R10.1 J: per-occurrence — a resolved internal edge for THIS
        // (file, specifier) keeps the occurrence out of external evidence
        // (and therefore out of the G2 persistence-import channel, which
        // consumes the already-filtered specifiers below).
        if (ctx.resolvedLookup?.has(`${file}\0${spec}`)) continue;
        externalPackages.add(spec);
      }
    }
  }
  const specifiers = [...externalPackages].sort(compareStrings);
  // G2 channel: specifier strings are path-like, so the same combined
  // gitignore matcher (negations included) applies to them unchanged.
  const persistenceImportMatch = specifiers.some((spec) =>
    matchesAnyPathPattern(spec, ctx.persistenceImportPatterns),
  );
  const matchedPersistenceImports = matchedPatterns(specifiers, ctx.persistenceImportPatterns);
  return {
    entry: ctx.indegree === 0 || entryMatch,
    entryPatterns: matchedEntry,
    persistence: persistencePathMatch || persistenceImportMatch,
    persistencePatterns: [
      ...new Set([...matchedPersistence, ...matchedPersistenceImports]),
    ].sort(compareStrings),
    external: externalPackages.size > 0,
    externalPackages: specifiers,
    product: classifyModuleRole(module, ctx.pathRoleConfig) === "product",
  };
}

/**
 * Evidence patterns matched by at least one input string (a repo file
 * path, or a path-like import specifier for the G2 channel): a pattern
 * only counts for inputs the COMBINED matcher (`matchesAnyPathPattern`,
 * same as `classifyPathRole`) accepts, so a negated-out input contributes
 * neither the boolean signal nor an evidence entry. (A negation-only
 * entry never matches on its own.)
 */
function matchedPatterns(inputs: string[], patterns: string[]): string[] {
  if (patterns.length === 0) return [];
  const perPattern = patterns.map((pattern) => ({ pattern, matcher: ignore().add([pattern]) }));
  const matched = new Set<string>();
  for (const input of inputs) {
    if (!matchesAnyPathPattern(input, patterns)) continue;
    for (const { pattern, matcher } of perPattern) {
      if (matcher.ignores(input)) matched.add(pattern);
    }
  }
  return [...matched].sort(compareStrings);
}

/** Third-party package specifier: not relative, not absolute, not `node:`. */
function isExternalSpecifier(spec: string): boolean {
  if (spec.length === 0) return false;
  if (spec.startsWith("node:")) return false;
  if (spec.startsWith(".") || spec.startsWith("/")) return false;
  return true;
}

function crossesBoundary(path: string[], signalsById: Map<string, ModuleSignals>): boolean {
  return path.some((id) => {
    const s = signalsById.get(id);
    return s !== undefined && (s.persistence || s.external);
  });
}

function isProperPrefix(p: string[], q: string[]): boolean {
  if (p.length >= q.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== q[i]) return false;
  }
  return true;
}

/** Longest first; ties broken lexicographically (deterministic). */
function compareLongestFirst(a: string[], b: string[]): number {
  if (a.length !== b.length) return b.length - a.length;
  return comparePathLex(a, b);
}

function comparePathLex(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = a[i]!.localeCompare(b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

function buildCandidate(
  path: string[],
  slug: string,
  ctx: {
    moduleById: Map<string, Module>;
    filesByModule: Map<string, string[]>;
    signalsById: Map<string, ModuleSignals>;
    symbolsLookup: Map<string, string[]>;
    maxAnchors: number;
    entryPatterns: string[];
    persistencePatterns: string[];
    persistenceImportPatterns: string[];
    externalLookup?: Map<string, string[]> | undefined;
    resolvedLookup?: ReadonlySet<string> | undefined;
    resolvedEdges?: ResolvedImportEdge[] | undefined;
    pathRoleConfig?: PathRoleConfig | undefined;
    resolvedCrossModuleCallees?: ReadonlySet<string> | undefined;
  },
): FlowCandidate {
  const entryModule = ctx.moduleById.get(path[0]!)!;
  const sinkModule = ctx.moduleById.get(path[path.length - 1]!)!;

  const entryEvidence = new Set<string>();
  const persistenceEvidence = new Set<string>();
  const externalEvidence = new Set<string>();
  for (const id of path) {
    const s = ctx.signalsById.get(id)!;
    if (s.entry) {
      entryEvidence.add(id);
      for (const p of s.entryPatterns) entryEvidence.add(p);
    }
    if (s.persistence) {
      persistenceEvidence.add(id);
      for (const p of s.persistencePatterns) persistenceEvidence.add(p);
    }
    for (const p of s.externalPackages) externalEvidence.add(p);
  }

  const keyGroups = buildSeedKeyGroups(path, ctx);
  const base = {
    slug,
    titleSeed: `${displayName(entryModule)} to ${displayName(sinkModule)}`,
    moduleIds: [...path],
    signals: {
      entry: [...entryEvidence].sort(compareStrings),
      persistence: [...persistenceEvidence].sort(compareStrings),
      external: [...externalEvidence].sort(compareStrings),
    },
  };
  return { ...base, ...keyGroups };
}

function displayName(module: Module): string {
  return module.displayTitle ?? module.id;
}

/**
 * Deterministic test-path detection (R10.1 K — no config): the filename
 * carries a `.test.`/`.spec.` infix, or the path has a `__tests__`
 * segment. Combined with `classifyPathRole` for the seed-tier path role.
 */
export function isTestPath(path: string): boolean {
  const p = normalizeRepoPath(path);
  const base = p.split("/").pop() ?? p;
  if (base.includes(".test.") || base.includes(".spec.")) return true;
  if (p.split("/").includes("__tests__")) return true;
  // Python (pytest/unittest: test_foo.py / foo_test.py) and Go (foo_test.go)
  // naming conventions — the original check only covered JS/TS `.test.`/
  // `.spec.` infixes and the `__tests__` directory, missing every
  // non-JS/TS codebase's own test-file convention entirely (confirmed via
  // a real E2E run, 2026-07-23: MoneyPrinterTurbo-Plus's
  // `test/services/test_llm.py` was classified as ordinary code). A bare
  // `test`/`tests` DIRECTORY segment is deliberately NOT matched here —
  // too many real product paths (and this file's own test fixtures) use
  // that name for non-test content; the filename convention alone is
  // precise enough for the confirmed failure mode.
  return /^test_.+\.py$/.test(base) || /_test\.(py|go)$/.test(base);
}

/** Semantic roles a seed key can hold (a key may hold several). */
type SeedRole = "T1" | "T2" | "T3";

/** The five key groups plus the two-pass closed list (R10.1 K). */
interface SeedKeyGroups {
  seedKeys: string[];
  entryKeys: string[];
  boundaryKeys: string[];
  sinkKeys: string[];
  otherProductKeys: string[];
  auxiliaryKeys: string[];
  skip?: FlowCandidateSkip;
}

/**
 * R10.1 K: classify the walk's keys by path role and semantic role,
 * build the five explicit groups, and fill the closed list in two
 * passes (reservation, then priority fill). See the module docblock for
 * the full contract. Pure and deterministic.
 */
function buildSeedKeyGroups(
  path: string[],
  ctx: {
    filesByModule: Map<string, string[]>;
    symbolsLookup: Map<string, string[]>;
    signalsById: Map<string, ModuleSignals>;
    maxAnchors: number;
    entryPatterns: string[];
    persistencePatterns: string[];
    persistenceImportPatterns: string[];
    externalLookup?: Map<string, string[]> | undefined;
    resolvedLookup?: ReadonlySet<string> | undefined;
    resolvedEdges?: ResolvedImportEdge[] | undefined;
    pathRoleConfig?: PathRoleConfig | undefined;
    resolvedCrossModuleCallees?: ReadonlySet<string> | undefined;
  },
): SeedKeyGroups {
  const isAuxFile = (file: string): boolean =>
    classifyPathRole(file, ctx.pathRoleConfig) !== "product" || isTestPath(file);

  // --- Semantic-role file sets -------------------------------------------

  // T1 (entry): files of the walk matching the combined entry matcher.
  const t1Files = new Set<string>();
  for (const id of path) {
    for (const file of ctx.filesByModule.get(id) ?? []) {
      if (matchesAnyPathPattern(file, ctx.entryPatterns)) t1Files.add(file);
    }
  }
  // Indegree-only root (entry signal with NO pattern evidence): the
  // root's non-auxiliary file originating the walk's first
  // ResolvedImportEdge; deterministic fallback = the root's
  // non-auxiliary files (path order).
  const rootSignals = ctx.signalsById.get(path[0]!)!;
  if (rootSignals.entry && rootSignals.entryPatterns.length === 0) {
    const rootFiles = new Set(ctx.filesByModule.get(path[0]!) ?? []);
    const nextFiles = new Set(ctx.filesByModule.get(path[1]!) ?? []);
    const firstEdge = (ctx.resolvedEdges ?? [])
      .filter(
        (e) =>
          rootFiles.has(normalizeRepoPath(e.fromFile)) &&
          nextFiles.has(normalizeRepoPath(e.toFile)),
      )
      .sort((a, b) => {
        const fa = normalizeRepoPath(a.fromFile);
        const fb = normalizeRepoPath(b.fromFile);
        if (fa !== fb) return fa.localeCompare(fb);
        const ta = normalizeRepoPath(a.toFile);
        const tb = normalizeRepoPath(b.toFile);
        if (ta !== tb) return ta.localeCompare(tb);
        return a.source.localeCompare(b.source);
      })[0];
    if (firstEdge !== undefined && !isAuxFile(normalizeRepoPath(firstEdge.fromFile))) {
      t1Files.add(normalizeRepoPath(firstEdge.fromFile));
    } else {
      for (const file of ctx.filesByModule.get(path[0]!) ?? []) {
        if (!isAuxFile(file)) t1Files.add(file);
      }
    }
  }

  // T2 (crossing): files that are source/target of a crossing resolved
  // edge on the walk — a ResolvedImportEdge whose endpoints belong to two
  // DIFFERENT modules of the walk (provenance from the SAME file edges
  // the module graph consumed; absent => T2 empty).
  const t2Files = new Set<string>();
  if (ctx.resolvedEdges !== undefined) {
    const moduleOfFile = new Map<string, string>();
    for (const id of path) {
      for (const file of ctx.filesByModule.get(id) ?? []) moduleOfFile.set(file, id);
    }
    for (const e of ctx.resolvedEdges) {
      const from = moduleOfFile.get(normalizeRepoPath(e.fromFile));
      const to = moduleOfFile.get(normalizeRepoPath(e.toFile));
      if (from === undefined || to === undefined || from === to) continue;
      t2Files.add(normalizeRepoPath(e.fromFile));
      t2Files.add(normalizeRepoPath(e.toFile));
    }
  }

  // T3 (boundary/sink): files of the walk with the persistence signal
  // (path channel, or import channel per file with the same
  // per-occurrence filter as the module signal), plus every file of the
  // sink module.
  const t3Files = new Set<string>();
  for (const id of path) {
    for (const file of ctx.filesByModule.get(id) ?? []) {
      if (matchesAnyPathPattern(file, ctx.persistencePatterns)) {
        t3Files.add(file);
        continue;
      }
      if (ctx.externalLookup === undefined) continue;
      const specs = (ctx.externalLookup.get(file) ?? []).filter(
        (spec) => isExternalSpecifier(spec) && !ctx.resolvedLookup?.has(`${file}\0${spec}`),
      );
      if (specs.some((spec) => matchesAnyPathPattern(spec, ctx.persistenceImportPatterns))) {
        t3Files.add(file);
      }
    }
  }
  for (const file of ctx.filesByModule.get(path[path.length - 1]!) ?? []) {
    t3Files.add(file);
  }

  // --- Per-key classification (canonical order: module walk position,
  //     then key asc within the module — the Map preserves it) ---------
  const keyInfo = new Map<
    string,
    { file: string; moduleIndex: number; roles: Set<SeedRole>; auxiliary: boolean }
  >();
  for (const [moduleIndex, id] of path.entries()) {
    const fileOf = new Map<string, string>();
    for (const file of ctx.filesByModule.get(id) ?? []) {
      for (const key of ctx.symbolsLookup.get(file) ?? []) {
        if (!fileOf.has(key)) fileOf.set(key, file);
      }
    }
    for (const key of [...fileOf.keys()].sort(compareStrings)) {
      if (keyInfo.has(key)) continue; // first walk position wins
      const file = fileOf.get(key)!;
      const roles = new Set<SeedRole>();
      if (t1Files.has(file)) roles.add("T1");
      if (t2Files.has(file)) roles.add("T2");
      if (t3Files.has(file)) roles.add("T3");
      keyInfo.set(key, { file, moduleIndex, roles, auxiliary: isAuxFile(file) });
    }
  }
  const allKeys = [...keyInfo.keys()];

  // --- Groups ------------------------------------------------------------
  const byRole = (role: SeedRole, auxiliary: boolean): string[] =>
    allKeys.filter((k) => {
      const info = keyInfo.get(k)!;
      return info.auxiliary === auxiliary && info.roles.has(role);
    });
  // Product-role keys form each semantic group; auxiliary fills the
  // group ONLY when no product key holds that role (mechanical
  // test-flow fallback).
  const pickGroup = (role: SeedRole): string[] => {
    const product = byRole(role, false);
    const chosen = product.length > 0 ? product : byRole(role, true);
    // Priority-0 Phase 3: among T2 (crossing) candidates that are
    // otherwise tied (same role, same product/auxiliary bucket), a key
    // PROVEN to be called from a different module by a resolved call
    // edge is a stronger crossing signal than the path/import heuristic
    // alone — prefer it. Stable sort (0 for ties) only re-orders; it
    // never changes which keys belong to the group.
    if (role !== "T2" || !ctx.resolvedCrossModuleCallees) return chosen;
    const callees = ctx.resolvedCrossModuleCallees;
    return [...chosen].sort((a, b) => Number(!callees.has(a)) - Number(!callees.has(b)));
  };
  const entryKeys = pickGroup("T1");
  const boundaryKeys = pickGroup("T2");
  const sinkKeys = pickGroup("T3");
  const otherProductKeys = allKeys.filter((k) => {
    const info = keyInfo.get(k)!;
    return !info.auxiliary && info.roles.size === 0;
  });
  const inSemanticGroup = new Set([...entryKeys, ...boundaryKeys, ...sinkKeys]);
  const auxiliaryKeys = allKeys.filter(
    (k) => keyInfo.get(k)!.auxiliary && !inSemanticGroup.has(k),
  );

  const groups = {
    entryKeys,
    boundaryKeys,
    sinkKeys,
    otherProductKeys,
    auxiliaryKeys,
  };

  // --- Pass 1: reserve one key per non-empty T1/T2/T3 group. A reserved
  //     key covers EVERY group it belongs to (multi-role keys count once);
  //     groups are in canonical order, so the group's first key is the
  //     first in round-robin order (modules in walk order, keys sorted).
  const seedKeys: string[] = [];
  const taken = new Set<string>();
  for (const group of [entryKeys, boundaryKeys, sinkKeys]) {
    if (group.length === 0 || group.some((k) => taken.has(k))) continue;
    seedKeys.push(group[0]!);
    taken.add(group[0]!);
  }

  // K-a: the cap cannot fit the mandatory group reservation.
  if (ctx.maxAnchors < seedKeys.length) {
    return {
      ...capGroupsToSeedKeys(groups, seedKeys),
      seedKeys: [...seedKeys],
      skip: {
        code: "insufficient_anchor_capacity",
        message:
          `flowMaxAnchors (${ctx.maxAnchors}) cannot fit the mandatory semantic-group ` +
          `reservation (${seedKeys.length} distinct keys for the non-empty entry/boundary/sink ` +
          `groups) — raise flowMaxAnchors`,
      },
    };
  }

  // Round-robin fill across the walk's modules in tier priority T1→T5
  // (one key per module per round, keys sorted within a module), until
  // `target` (never beyond the cap) or the pools run out.
  const tierPools = [entryKeys, boundaryKeys, sinkKeys, otherProductKeys, auxiliaryKeys];
  const fillTo = (target: number): void => {
    const limit = Math.min(target, ctx.maxAnchors);
    for (const pool of tierPools) {
      const queues = new Map<number, string[]>();
      for (const key of pool) {
        if (taken.has(key)) continue;
        const idx = keyInfo.get(key)!.moduleIndex;
        const q = queues.get(idx);
        if (q !== undefined) q.push(key);
        else queues.set(idx, [key]);
      }
      for (;;) {
        let progressed = false;
        for (const idx of path.keys()) {
          if (seedKeys.length >= limit) return;
          const q = queues.get(idx);
          if (q === undefined) continue;
          let key: string | undefined;
          while (q.length > 0) {
            const head = q.shift()!;
            if (!taken.has(head)) {
              key = head;
              break;
            }
          }
          if (key === undefined) continue;
          taken.add(key);
          seedKeys.push(key);
          progressed = true;
        }
        // Pool exhausted — move on to the next tier.
        if (!progressed) break;
      }
    }
  };

  // K-b: the three required flow sections each need their OWN anchor (a
  // key may not repeat across markers) — top the reservation up to three
  // distinct keys from the remaining pool in the same T1→T5 priority
  // order as pass 2 (contract revision 4 — NOT strictly T4/T5: a real
  // 3-key flow whose third key sits in an already-reserved group must
  // not be skipped); still short => skip.
  if (seedKeys.length < 3) fillTo(3);
  if (seedKeys.length < 3) {
    return {
      ...capGroupsToSeedKeys(groups, seedKeys),
      seedKeys: [...seedKeys],
      skip: {
        code: "insufficient_section_anchor_coverage",
        message:
          `fewer than 3 distinct seed keys available (${seedKeys.length}) — each required ` +
          `flow section (Purpose, Ordered flow, Failure and recovery) needs its own anchor ` +
          `and a key may not repeat across markers`,
      },
    };
  }

  // --- Pass 2: fill to the cap in tier priority T1→T5 -------------------
  fillTo(ctx.maxAnchors);
  return { ...capGroupsToSeedKeys(groups, seedKeys), seedKeys };
}

/** The five key groups of a SeedKeyGroups (everything but list + skip). */
type KeyGroups = Omit<SeedKeyGroups, "seedKeys" | "skip">;

/**
 * Caps the five groups to the closed list (R10.1 K, contract revision 4):
 * each group keeps only keys present in `seedKeys`, preserving its
 * product-first/auxiliary-fallback order. The union of the capped groups
 * IS the closed list, always — a key truncated from `seedKeys` can never
 * leak into a prompt or validator group. A non-empty group's pass-1
 * reservation key is inside `seedKeys` by construction (pass 2 only
 * appends, never removes), so capping can never empty a mandatory group.
 */
function capGroupsToSeedKeys(groups: KeyGroups, seedKeys: readonly string[]): KeyGroups {
  const keep = new Set(seedKeys);
  return {
    entryKeys: groups.entryKeys.filter((k) => keep.has(k)),
    boundaryKeys: groups.boundaryKeys.filter((k) => keep.has(k)),
    sinkKeys: groups.sinkKeys.filter((k) => keep.has(k)),
    otherProductKeys: groups.otherProductKeys.filter((k) => keep.has(k)),
    auxiliaryKeys: groups.auxiliaryKeys.filter((k) => keep.has(k)),
  };
}

/**
 * Deterministic replacement for the "PRIMARY-SECTION RULE" the LLM used to
 * decide on its own: maps every key in `candidate.seedKeys` (all five
 * tiers) to exactly one of the three required flow sections, so neither
 * the prompt nor the mechanical repair has to invent a placement rule.
 *
 * Default policy: entryKeys (T1) -> "purpose"; sinkKeys (T3) ->
 * "failure-and-recovery"; boundaryKeys (T2), otherProductKeys (T4), and
 * auxiliaryKeys (T5) -> "ordered-flow" (the flow's main narrative body). A
 * key present in more than one tier resolves by the same tier-priority
 * order `pickGroup` already uses for T2 (T1 > T3 > T2/T4/T5) — never
 * ambiguous, never re-decided per call. Total over `candidate.seedKeys`.
 */
export function assignFlowKeySections(candidate: FlowCandidate): FlowKeySectionMap {
  const entry = new Set(candidate.entryKeys);
  const sink = new Set(candidate.sinkKeys);
  const map = new Map<string, FlowRequiredSection>();
  for (const key of candidate.seedKeys) {
    if (entry.has(key)) map.set(key, "purpose");
    else if (sink.has(key)) map.set(key, "failure-and-recovery");
    else map.set(key, "ordered-flow");
  }
  return map;
}

/** Copy a file->list map into a normalized-path lookup (merging collisions). */
function normalizeFileMap(map: Map<string, string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [file, values] of map) {
    const key = normalizeRepoPath(file);
    out.set(key, [...(out.get(key) ?? []), ...values]);
  }
  return out;
}
