/**
 * community — deterministic community detection over the file-level import
 * graph, used as a diagnostic cross-check of the stage-2 module partition
 * (roadmap item 9, phase 1).
 *
 * Prior art: Graphify and similar tools use the Leiden algorithm for
 * community detection. Leiden is fast and high-quality, but it relies on
 * randomized moves and a native/wasm dependency — both unacceptable here:
 * livewiki's deterministic layer must be byte-reproducible and
 * dependency-free. Synchronous label propagation with a fixed visit order
 * and sorted tie-breaking is the deterministic equivalent: same "densely
 * connected files share a label" intuition, zero randomness, zero
 * dependencies, ~80 lines.
 *
 * IMPORTANT: communities are NOT a valid partition. Label propagation
 * routinely produces singletons and giant components, and every file is
 * forced into exactly one community even when it sits on a boundary. The
 * heuristic stage-2 partition ALWAYS wins; this module exists only to
 * cross-check it (`comparePartitions`) and surface divergence for human
 * review. Never feed communities back as modules.
 *
 * Determinism contract:
 *   - Initial label of each file = its own path (unique by construction).
 *   - At most MAX_PASSES passes; each pass visits nodes in `localeCompare`
 *     order and updates labels in place (synchronous propagation).
 *   - A node adopts the neighbor label with the highest count among its
 *     undirected neighbors; ties break by the smallest label
 *     (`localeCompare`); neighborless nodes keep their own path forever.
 *   - Early stop when a pass changes nothing.
 *   - Input order of `filePaths`/`edges` never affects the output.
 */

import type { ResolvedImportEdge } from "./import-resolution.js";
import type { Module } from "./modules.js";

const MAX_PASSES = 10;

/**
 * Detects communities over the undirected file import graph.
 * Returns path → communityId (the winning label, which is some file path).
 * Map entries are inserted in `localeCompare` path order so the result is
 * byte-identical regardless of input ordering.
 */
export function detectFileCommunities(
  filePaths: string[],
  edges: ResolvedImportEdge[],
): Map<string, string> {
  const nodes = [...new Set(filePaths)].sort((a, b) => a.localeCompare(b));
  const nodeSet = new Set(nodes);

  // Undirected adjacency; edges referencing unknown files are ignored.
  const adjacency = new Map<string, Set<string>>();
  for (const n of nodes) adjacency.set(n, new Set());
  for (const e of edges) {
    if (e.fromFile === e.toFile) continue;
    if (!nodeSet.has(e.fromFile) || !nodeSet.has(e.toFile)) continue;
    adjacency.get(e.fromFile)!.add(e.toFile);
    adjacency.get(e.toFile)!.add(e.fromFile);
  }

  const label = new Map<string, string>();
  for (const n of nodes) label.set(n, n);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (const n of nodes) {
      const counts = new Map<string, number>();
      for (const neighbor of adjacency.get(n)!) {
        const l = label.get(neighbor)!;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      if (counts.size === 0) continue; // no neighbors: keeps its own path
      let best = label.get(n)!;
      let bestCount = -1;
      for (const [l, c] of counts) {
        if (c > bestCount || (c === bestCount && l.localeCompare(best) < 0)) {
          best = l;
          bestCount = c;
        }
      }
      if (best !== label.get(n)) {
        label.set(n, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return label;
}

/** Per-module row of the cross-check report. */
export interface ModuleCrossCheck {
  moduleId: string;
  /** Community containing the plurality of the module's files (null when the module has no files). */
  dominantCommunity: string | null;
  /** Share of the module's files in the dominant community (0..1). */
  dominantShare: number;
}

/** Result of cross-checking the stage-2 partition against detected communities. */
export interface CommunityCrossCheckReport {
  perModule: ModuleCrossCheck[];
  /** Files whose community's plurality module differs from their own module. */
  disagreementCount: number;
  /** "divergent" when disagreementCount > 0 (threshold tuning is a later lot). */
  verdict: "agree" | "divergent";
}

/**
 * Cross-checks the stage-2 module partition against detected communities.
 * Diagnostic only — the heuristic partition always wins. All output is
 * sorted deterministically (moduleId / communityId `localeCompare`).
 */
export function comparePartitions(
  modules: Array<Pick<Module, "id" | "paths">>,
  communities: Map<string, string>,
): CommunityCrossCheckReport {
  const sortedModules = [...modules].sort((a, b) => a.id.localeCompare(b.id));

  // file → owning module (first module in sorted order wins on overlap).
  const fileToModule = new Map<string, string>();
  for (const m of sortedModules) {
    for (const p of m.paths) {
      if (!fileToModule.has(p)) fileToModule.set(p, m.id);
    }
  }

  // community → (moduleId → file count), for plurality-module computation.
  const communityModuleCounts = new Map<string, Map<string, number>>();
  for (const [file, communityId] of communities) {
    const moduleId = fileToModule.get(file);
    if (moduleId === undefined) continue;
    let counts = communityModuleCounts.get(communityId);
    if (!counts) {
      counts = new Map();
      communityModuleCounts.set(communityId, counts);
    }
    counts.set(moduleId, (counts.get(moduleId) ?? 0) + 1);
  }

  const pluralityModule = (communityId: string): string | null => {
    const counts = communityModuleCounts.get(communityId);
    if (!counts) return null;
    let best: string | null = null;
    let bestCount = -1;
    for (const [moduleId, c] of counts) {
      if (
        c > bestCount ||
        (c === bestCount && best !== null && moduleId.localeCompare(best) < 0)
      ) {
        best = moduleId;
        bestCount = c;
      }
    }
    return best;
  };

  let disagreementCount = 0;
  for (const [file, communityId] of communities) {
    const ownModule = fileToModule.get(file);
    if (ownModule === undefined) continue;
    const plurality = pluralityModule(communityId);
    if (plurality !== null && plurality !== ownModule) disagreementCount++;
  }

  const perModule: ModuleCrossCheck[] = sortedModules.map((m) => {
    const counts = new Map<string, number>();
    for (const p of m.paths) {
      const communityId = communities.get(p);
      if (communityId === undefined) continue;
      counts.set(communityId, (counts.get(communityId) ?? 0) + 1);
    }
    let dominantCommunity: string | null = null;
    let bestCount = -1;
    for (const [communityId, c] of counts) {
      if (
        c > bestCount ||
        (c === bestCount &&
          dominantCommunity !== null &&
          communityId.localeCompare(dominantCommunity) < 0)
      ) {
        dominantCommunity = communityId;
        bestCount = c;
      }
    }
    return {
      moduleId: m.id,
      dominantCommunity,
      dominantShare: m.paths.length === 0 ? 0 : bestCount / m.paths.length,
    };
  });

  return {
    perModule,
    disagreementCount,
    verdict: disagreementCount > 0 ? "divergent" : "agree",
  };
}
