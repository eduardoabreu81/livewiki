import { describe, expect, it } from "vitest";
import type { ResolvedImportEdge } from "./import-resolution.js";
import {
  comparePartitions,
  detectFileCommunities,
} from "./community.js";

/** Builds a resolved edge; `source` is irrelevant for community detection. */
function edge(fromFile: string, toFile: string): ResolvedImportEdge {
  return { fromFile, toFile, source: "./dep" };
}

describe("detectFileCommunities", () => {
  it("detects two cliques joined by a bridge file as separate communities", () => {
    // a-clique -- bridge -- b-clique; the bridge has exactly two neighbors.
    const files = ["a1.ts", "a2.ts", "a3.ts", "bridge.ts", "b1.ts", "b2.ts", "b3.ts"];
    const edges = [
      edge("a1.ts", "a2.ts"),
      edge("a1.ts", "a3.ts"),
      edge("a2.ts", "a3.ts"),
      edge("b1.ts", "b2.ts"),
      edge("b1.ts", "b3.ts"),
      edge("b2.ts", "b3.ts"),
      edge("a3.ts", "bridge.ts"),
      edge("bridge.ts", "b1.ts"),
    ];
    const communities = detectFileCommunities(files, edges);

    const communityA = communities.get("a1.ts")!;
    const communityB = communities.get("b1.ts")!;
    expect(communityA).not.toBe(communityB);
    expect(communities.get("a2.ts")).toBe(communityA);
    expect(communities.get("a3.ts")).toBe(communityA);
    expect(communities.get("b2.ts")).toBe(communityB);
    expect(communities.get("b3.ts")).toBe(communityB);
    // The bridge lands deterministically: its two neighbor labels tie, and
    // the smallest label (localeCompare) wins — that is community A here.
    expect(communities.get("bridge.ts")).toBe(communityA);
    // Community ids are file paths (the winning labels).
    expect(communityA).toBe("a2.ts");
    expect(communityB).toBe("b2.ts");
  });

  it("keeps a neighborless file as its own community", () => {
    const files = ["solo.ts", "x1.ts", "x2.ts"];
    const edges = [edge("x1.ts", "x2.ts")];
    const communities = detectFileCommunities(files, edges);

    expect(communities.get("solo.ts")).toBe("solo.ts");
    expect(communities.get("x1.ts")).toBe(communities.get("x2.ts"));
  });

  it("breaks label ties by the smallest label (localeCompare)", () => {
    // Symmetric pull on x.ts: one neighbor in the p-community, one in the
    // (triangle-cohesive) q-community. p2.ts < q2.ts, so x.ts must join
    // the p-community while the q-community stays intact.
    const files = ["p.ts", "p2.ts", "q.ts", "q2.ts", "q3.ts", "x.ts"];
    const edges = [
      edge("p.ts", "p2.ts"),
      edge("q.ts", "q2.ts"),
      edge("q.ts", "q3.ts"),
      edge("q2.ts", "q3.ts"),
      edge("x.ts", "p.ts"),
      edge("x.ts", "q.ts"),
    ];
    const communities = detectFileCommunities(files, edges);

    expect(communities.get("p.ts")).toBe("p2.ts");
    expect(communities.get("q.ts")).toBe("q2.ts");
    expect(communities.get("q2.ts")).toBe("q2.ts");
    expect(communities.get("q3.ts")).toBe("q2.ts");
    expect(communities.get("x.ts")).toBe("p2.ts");
  });

  it("is deterministic under shuffled input order", () => {
    const files = ["a1.ts", "a2.ts", "a3.ts", "bridge.ts", "b1.ts", "b2.ts", "b3.ts", "solo.ts"];
    const edges = [
      edge("a1.ts", "a2.ts"),
      edge("a1.ts", "a3.ts"),
      edge("a2.ts", "a3.ts"),
      edge("b1.ts", "b2.ts"),
      edge("b1.ts", "b3.ts"),
      edge("b2.ts", "b3.ts"),
      edge("a3.ts", "bridge.ts"),
      edge("bridge.ts", "b1.ts"),
    ];
    const forward = detectFileCommunities(files, edges);
    const reverse = detectFileCommunities(
      [...files].reverse(),
      [...edges].reverse().map((e) => edge(e.toFile, e.fromFile)),
    );
    expect([...reverse.entries()]).toEqual([...forward.entries()]);

    const modules = [
      { id: "mod-b", paths: ["b1.ts", "b2.ts", "b3.ts"] },
      { id: "mod-a", paths: ["a1.ts", "a2.ts", "a3.ts", "bridge.ts"] },
    ];
    const reportForward = comparePartitions(modules, forward);
    const reportReverse = comparePartitions([...modules].reverse(), reverse);
    expect(reportReverse).toEqual(reportForward);
  });

  it("ignores self-edges and edges to unknown files", () => {
    const files = ["a.ts", "b.ts"];
    const edges = [
      edge("a.ts", "a.ts"),
      edge("a.ts", "ghost.ts"),
      edge("a.ts", "b.ts"),
    ];
    const communities = detectFileCommunities(files, edges);
    expect(communities.size).toBe(2);
    expect(communities.get("a.ts")).toBe(communities.get("b.ts"));
  });

  it("returns an empty map for empty input", () => {
    const communities = detectFileCommunities([], []);
    expect(communities.size).toBe(0);
  });
});

describe("comparePartitions", () => {
  it("reports agree when modules align with communities", () => {
    const communities = new Map([
      ["a1.ts", "a1.ts"],
      ["a2.ts", "a1.ts"],
      ["b1.ts", "b1.ts"],
      ["b2.ts", "b1.ts"],
    ]);
    const modules = [
      { id: "mod-a", paths: ["a1.ts", "a2.ts"] },
      { id: "mod-b", paths: ["b1.ts", "b2.ts"] },
    ];
    const report = comparePartitions(modules, communities);

    expect(report.verdict).toBe("agree");
    expect(report.disagreementCount).toBe(0);
    expect(report.perModule).toEqual([
      { moduleId: "mod-a", dominantCommunity: "a1.ts", dominantShare: 1 },
      { moduleId: "mod-b", dominantCommunity: "b1.ts", dominantShare: 1 },
    ]);
  });

  it("reports divergent with the file that sits in another community's module", () => {
    // mx.ts belongs to mod-b but lives in the community dominated by mod-a.
    const communities = new Map([
      ["a1.ts", "ca"],
      ["a2.ts", "ca"],
      ["mx.ts", "ca"],
      ["b1.ts", "cb"],
      ["b2.ts", "cb"],
    ]);
    const modules = [
      { id: "mod-a", paths: ["a1.ts", "a2.ts"] },
      { id: "mod-b", paths: ["b1.ts", "b2.ts", "mx.ts"] },
    ];
    const report = comparePartitions(modules, communities);

    expect(report.verdict).toBe("divergent");
    expect(report.disagreementCount).toBe(1);
    expect(report.perModule).toEqual([
      { moduleId: "mod-a", dominantCommunity: "ca", dominantShare: 1 },
      { moduleId: "mod-b", dominantCommunity: "cb", dominantShare: 2 / 3 },
    ]);
  });

  it("breaks dominant-community ties by community id (localeCompare)", () => {
    const communities = new Map([
      ["a1.ts", "ca"],
      ["a2.ts", "ca"],
      ["b1.ts", "cb"],
      ["b2.ts", "cb"],
    ]);
    const modules = [{ id: "mod-x", paths: ["a1.ts", "a2.ts", "b1.ts", "b2.ts"] }];
    const report = comparePartitions(modules, communities);

    expect(report.perModule).toEqual([
      { moduleId: "mod-x", dominantCommunity: "ca", dominantShare: 0.5 },
    ]);
    // One module only: every community's plurality module is mod-x, so no
    // disagreement is possible.
    expect(report.disagreementCount).toBe(0);
    expect(report.verdict).toBe("agree");
  });

  it("handles empty input without throwing", () => {
    const report = comparePartitions([], new Map());
    expect(report).toEqual({
      perModule: [],
      disagreementCount: 0,
      verdict: "agree",
    });
  });

  it("handles an empty module and files not covered by any module", () => {
    const communities = new Map([["a1.ts", "ca"], ["free.ts", "cf"]]);
    const modules = [
      { id: "mod-a", paths: ["a1.ts"] },
      { id: "mod-empty", paths: [] },
    ];
    const report = comparePartitions(modules, communities);

    expect(report.verdict).toBe("agree");
    expect(report.perModule).toEqual([
      { moduleId: "mod-a", dominantCommunity: "ca", dominantShare: 1 },
      { moduleId: "mod-empty", dominantCommunity: null, dominantShare: 0 },
    ]);
  });
});
