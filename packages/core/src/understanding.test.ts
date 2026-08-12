/**
 * understanding.test.ts — roadmap item 23 (repository understanding layer).
 *
 * Unit contracts covered here:
 *
 *   - validateUnderstandingArtifact: a valid page passes; every contract
 *     violation is rejected with its own code (no anchors, no code spans,
 *     no links, single purpose paragraph, bounded surfaces section);
 *   - parseUnderstandingPage / loadUnderstandingSynthesis: tolerant reader
 *     for the quickstart/README-export consumers, null on garbage;
 *   - computeUnderstandingEvidenceHash: stable identity, sensitive to
 *     every evidence field;
 *   - renderUnderstandingEvidence: closed inventory sections + truncation;
 *   - hasUnderstandingBasis: the deterministic no-op guard;
 *   - prompt builders: the evidence block and the README-not-authority
 *     rule reach the model; the repair prompt embeds errors + prior page.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  buildUnderstandingEvidence,
  computeUnderstandingEvidenceHash,
  hasUnderstandingBasis,
  loadUnderstandingSynthesis,
  parseUnderstandingPage,
  renderUnderstandingEvidence,
  salvageUnderstandingCandidate,
  validateUnderstandingArtifact,
  UNDERSTANDING_EVIDENCE_MAX_CHARS,
  UNDERSTANDING_MAX_SURFACES,
  UNDERSTANDING_PURPOSE_MAX_CHARS,
  UNDERSTANDING_REL_PATH,
  UNDERSTANDING_SURFACE_MAX_CHARS,
  type UnderstandingEvidence,
} from "./understanding.js";
import { buildUnderstandingPrompt, buildUnderstandingRepairPrompt } from "./prompts.js";
import { run as runIndexer } from "./indexer.js";

function makeValidPage(): string {
  return [
    "---",
    "title: Flow Repo",
    "owner: generated",
    "kind: understanding",
    "updated: 2026-08-03",
    "---",
    "",
    "# Flow Repo",
    "",
    "Flow Repo is a small command line application that drives a persistence core for its users.",
    "",
    "## Where to look in the code",
    "",
    "- Command line interface entry point",
    "- Persistence layer in the core module",
    "",
  ].join("\n");
}

function makeEvidence(): UnderstandingEvidence {
  return {
    modules: [
      { id: "cli", title: "Command line interface", responsibility: "Parses the invocation and drives the core." },
      { id: "core", title: "Persistence core", responsibility: "Stores the produced records." },
    ],
    flows: [{ slug: "cli-to-core", title: "CLI to core", modules: ["cli", "core"] }],
    topics: [{ slug: "deployment", title: "Deployment", intent: "How the product is shipped." }],
    surfaces: ["Node.js CLI entry point declared in `package.json` (`bin`)"],
    readmePurpose: "Flow Repo is a tool that does things.",
    readmePath: "README.md",
    readmeTitle: "Flow Repo",
  };
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-understanding-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

// === Validation ===

describe("validateUnderstandingArtifact", () => {
  it("accepts a valid page (with and without the Where to look in the code section)", () => {
    expect(validateUnderstandingArtifact(makeValidPage())).toEqual([]);
    const noSurfaces = [
      "---",
      "title: Flow Repo",
      "owner: generated",
      "---",
      "",
      "# Flow Repo",
      "",
      "Flow Repo is a small command line application that drives a persistence core for its users.",
      "",
    ].join("\n");
    expect(validateUnderstandingArtifact(noSurfaces)).toEqual([]);
  });

  it("rejects contract violations with their own codes", () => {
    const valid = makeValidPage();
    const cases: Array<{ name: string; mutate: (page: string) => string; code: string }> = [
      {
        name: "no frontmatter",
        mutate: (page) => page.slice(page.indexOf("# Flow Repo")),
        code: "no_frontmatter",
      },
      {
        name: "wrong owner",
        mutate: (page) => page.replace("owner: generated", "owner: human"),
        code: "wrong_owner",
      },
      {
        name: "missing owner",
        mutate: (page) => page.replace("owner: generated\n", ""),
        code: "missing_owner",
      },
      {
        name: "anchors frontmatter key",
        mutate: (page) => page.replace("kind: understanding", "kind: understanding\nanchors:\n  - cli/index.ts#main"),
        code: "anchors_forbidden",
      },
      {
        name: "lw:anchors marker",
        mutate: (page) => page.replace("## Where to look in the code", "<!-- lw:anchors cli/index.ts#main -->\n\n## Where to look in the code"),
        code: "anchors_forbidden",
      },
      {
        name: "lw:manual block",
        mutate: (page) => page + "\n<!-- lw:manual -->\nhuman note\n<!-- /lw:manual -->\n",
        code: "model_invented_manual",
      },
      {
        name: "missing H1",
        mutate: (page) => page.replace("# Flow Repo\n\n", ""),
        code: "missing_h1",
      },
      {
        name: "multiple H1",
        mutate: (page) => page.replace("## Where to look in the code", "# Another title\n\n## Where to look in the code"),
        code: "multiple_h1",
      },
      {
        name: "missing purpose",
        mutate: (page) =>
          page.replace(
            "Flow Repo is a small command line application that drives a persistence core for its users.\n\n",
            "",
          ),
        code: "missing_purpose",
      },
      {
        name: "purpose too short",
        mutate: (page) =>
          page.replace(
            "Flow Repo is a small command line application that drives a persistence core for its users.",
            "Too short.",
          ),
        code: "purpose_too_short",
      },
      {
        name: "purpose too long",
        mutate: (page) =>
          page.replace(
            "Flow Repo is a small command line application that drives a persistence core for its users.",
            "x".repeat(UNDERSTANDING_PURPOSE_MAX_CHARS + 1),
          ),
        code: "purpose_too_long",
      },
      {
        name: "second purpose paragraph",
        mutate: (page) => page.replace("## Where to look in the code", "A second paragraph the contract forbids.\n\n## Where to look in the code"),
        code: "purpose_not_single_paragraph",
      },
      {
        name: "unexpected section",
        mutate: (page) => page.replace("## Where to look in the code", "## Architecture"),
        code: "unexpected_section",
      },
      {
        name: "empty surfaces section",
        mutate: (page) =>
          page
            .replace("- Command line interface entry point\n", "")
            .replace("- Persistence layer in the core module\n", ""),
        code: "empty_surfaces_section",
      },
      {
        name: "surfaces not a list",
        mutate: (page) => page.replace("- Command line interface entry point", "Just prose here."),
        code: "surfaces_not_a_list",
      },
      {
        name: "too many surfaces",
        mutate: (page) =>
          page.replace(
            "- Persistence layer in the core module",
            Array.from({ length: UNDERSTANDING_MAX_SURFACES }, (_, i) => `- Surface number ${i}`).join("\n"),
          ),
        code: "too_many_surfaces",
      },
      {
        name: "surface too long",
        mutate: (page) =>
          page.replace(
            "- Command line interface entry point",
            `- ${"y".repeat(UNDERSTANDING_SURFACE_MAX_CHARS + 1)}`,
          ),
        code: "surface_too_long",
      },
      {
        name: "inline code span (symbol claim)",
        mutate: (page) => page.replace("persistence core", "persistence core in `core/db.ts`"),
        code: "code_span_forbidden",
      },
      {
        name: "fenced code block",
        mutate: (page) => page + "\n```sh\nflow-repo run\n```\n",
        code: "code_span_forbidden",
      },
      {
        name: "markdown link",
        mutate: (page) => page.replace("## Where to look in the code", "## Where to look in the code\n\nSee [the flow](flows/cli-to-core.md)."),
        code: "link_forbidden",
      },
      {
        name: "legacy Key surfaces heading (pre-#30 pages keep it, but new generations must use the plain-language heading)",
        mutate: (page) => page.replace("## Where to look in the code", "## Key surfaces"),
        code: "unexpected_section",
      },
      {
        name: "TODO placeholder",
        mutate: (page) => page.replace("for its users.", "for its users. TODO: refine this later."),
        code: "todo_marker_present",
      },
    ];
    for (const { name, mutate, code } of cases) {
      const errors = validateUnderstandingArtifact(mutate(valid));
      expect(errors.map((error) => error.code), name).toContain(code);
    }
    // Sanity: the unmutated page stays valid.
    expect(validateUnderstandingArtifact(valid)).toEqual([]);
  });
});

// === Tolerant reader ===

describe("parseUnderstandingPage / loadUnderstandingSynthesis", () => {
  it("parses title, purpose, and surfaces from a valid page", () => {
    const parsed = parseUnderstandingPage(makeValidPage());
    expect(parsed).toEqual({
      title: "Flow Repo",
      purpose: "Flow Repo is a small command line application that drives a persistence core for its users.",
      surfaces: ["Command line interface entry point", "Persistence layer in the core module"],
    });
  });

  it("parses a human-edited page without frontmatter (any owner is legitimate evidence)", () => {
    const parsed = parseUnderstandingPage(
      "# Custom title\n\nA human rewrote the understanding of this repository in plain prose.\n",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("Custom title");
    expect(parsed!.surfaces).toEqual([]);
  });

  it("returns null when there is no H1 or no purpose paragraph", () => {
    expect(parseUnderstandingPage("no heading at all")).toBeNull();
    expect(parseUnderstandingPage("# Title only\n\n## Key surfaces\n\n- a\n")).toBeNull();
  });

  it("still reads the pre-#30 'Key surfaces' heading (pages are sticky — old pages keep it forever)", () => {
    const legacy = makeValidPage().replace("## Where to look in the code", "## Key surfaces");
    const parsed = parseUnderstandingPage(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.surfaces).toEqual([
      "Command line interface entry point",
      "Persistence layer in the core module",
    ]);
  });

  it("loads the page from disk and degrades to null when absent", async () => {
    expect(await loadUnderstandingSynthesis(repoRoot)).toBeNull();
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
    await nodeFs.writeFile(nodePath.join(repoRoot, UNDERSTANDING_REL_PATH), makeValidPage(), "utf8");
    const loaded = await loadUnderstandingSynthesis(repoRoot);
    expect(loaded?.purpose).toContain("Flow Repo is a small command line application");
  });
});

// === Evidence identity and rendering ===

describe("evidence hash + rendering", () => {
  it("is stable for identical evidence and sensitive to every field", () => {
    const base = makeEvidence();
    const hash = computeUnderstandingEvidenceHash(base);
    expect(computeUnderstandingEvidenceHash(makeEvidence())).toBe(hash);
    const variants: UnderstandingEvidence[] = [
      { ...makeEvidence(), readmePurpose: "A different README." },
      { ...makeEvidence(), readmeTitle: "A Different Name" },
      { ...makeEvidence(), surfaces: [] },
      { ...makeEvidence(), modules: makeEvidence().modules.slice(0, 1) },
      { ...makeEvidence(), flows: [] },
      { ...makeEvidence(), topics: [] },
      {
        ...makeEvidence(),
        modules: [
          { id: "cli", title: "Command line interface", responsibility: "Changed responsibility." },
          ...makeEvidence().modules.slice(1),
        ],
      },
    ];
    for (const variant of variants) {
      expect(computeUnderstandingEvidenceHash(variant)).not.toBe(hash);
    }
  });

  it("renders the closed inventory sections and honors the character cap", () => {
    const rendered = renderUnderstandingEvidence(makeEvidence());
    expect(rendered).toContain("## Accepted module pages");
    expect(rendered).toContain("Command line interface [cli] — Parses the invocation and drives the core.");
    expect(rendered).toContain("## Accepted flow pages");
    expect(rendered).toContain("CLI to core [flows/cli-to-core.md] — modules: cli, core");
    expect(rendered).toContain("## Accepted topic pages");
    expect(rendered).toContain("Deployment — How the product is shipped.");
    expect(rendered).toContain("## Entry points and surfaces");
    expect(rendered).toContain("## README purpose excerpt");
    expect(rendered).toContain("Flow Repo is a tool that does things.");
    expect(rendered).toContain("## Product name (from the README's own title — authoritative for naming)");
    expect(rendered).toContain("Flow Repo");

    const truncated = renderUnderstandingEvidence(makeEvidence(), 120);
    expect(truncated.length).toBeLessThanOrEqual(120 + "\n(evidence truncated to the character budget)".length);
    expect(truncated).toContain("(evidence truncated");
    expect(UNDERSTANDING_EVIDENCE_MAX_CHARS).toBeGreaterThan(1000);
  });

  it("hasUnderstandingBasis gates the deterministic no-op", () => {
    expect(hasUnderstandingBasis(makeEvidence())).toBe(true);
    const empty: UnderstandingEvidence = {
      modules: [],
      flows: [],
      topics: [],
      surfaces: ["Go module definition: `go.mod`"],
      readmePurpose: null,
      readmePath: null,
      readmeTitle: null,
    };
    expect(hasUnderstandingBasis(empty)).toBe(false);
    expect(hasUnderstandingBasis({ ...empty, readmePurpose: "A README purpose." })).toBe(true);
    expect(hasUnderstandingBasis({ ...empty, topics: makeEvidence().topics })).toBe(true);
  });

  it("builds the evidence inventory from a real indexed repo + wiki pages", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/main.ts"),
      "export function main() { return 1; }\n",
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "README.md"),
      "# Flow Repo\n\nFlow Repo is a small command line application that drives a persistence core for its users.\n",
      "utf8",
    );
    await nodeFs.writeFile(nodePath.join(repoRoot, "package.json"), JSON.stringify({ bin: { "flow-repo": "dist/main.js" } }), "utf8");
    await runIndexer(repoRoot, { quiet: true });
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki/src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/src/index.md"),
      [
        "---",
        "title: Application source",
        "owner: generated",
        "---",
        "",
        "# Application source",
        "",
        "This module holds the product entry point.",
        "",
      ].join("\n"),
      "utf8",
    );
    const modules = [
      { id: "src", paths: ["src/main.ts"], symbolCount: 1 },
    ];
    const evidence = await buildUnderstandingEvidence({
      repoRoot,
      modules,
      ordered: modules,
    });
    expect(evidence.readmePurpose).toContain("Flow Repo is a small command line application");
    expect(evidence.surfaces.some((surface) => surface.includes("package.json"))).toBe(true);
    expect(evidence.modules).toEqual([
      { id: "src", title: "Application source", responsibility: "This module holds the product entry point." },
    ]);
  });
});

// === Prompt builders ===

describe("understanding prompt builders", () => {
  it("the initial prompt embeds the closed evidence and the README-not-authority rule", () => {
    const evidenceBlock = renderUnderstandingEvidence(makeEvidence());
    const prompt = buildUnderstandingPrompt(evidenceBlock, "en");
    expect(prompt.user).toContain("# Closed evidence inventory");
    expect(prompt.user).toContain("Command line interface [cli]");
    expect(prompt.user).toContain("Flow Repo is a tool that does things.");
    expect(prompt.user).toContain("# Output: livewiki/understanding.md");
    expect(prompt.user).toContain("# Language: en");
    expect(prompt.system).toContain("never the authority");
    expect(prompt.system).toContain("owner: generated");
    expect(prompt.system).toContain("NEVER use inline code");
  });

  it("the repair prompt embeds the errors and the rejected prior page", () => {
    const evidenceBlock = renderUnderstandingEvidence(makeEvidence());
    const prior = makeValidPage().replace("persistence core", "persistence core in `core/db.ts`");
    const prompt = buildUnderstandingRepairPrompt(
      evidenceBlock,
      prior,
      [{ code: "code_span_forbidden", message: "the page must not use inline code" }],
      8_000,
      "en",
      { attempt: 1, total: 2 },
    );
    expect(prompt.system).toContain("Repair attempt 1 of 2");
    expect(prompt.system).toContain("[code_span_forbidden]");
    expect(prompt.user).toContain("# Rejected prior page");
    expect(prompt.user).toContain("core/db.ts");
    expect(prompt.user).toContain("# Corrected complete Markdown understanding page");
  });

  it("length violations get a scoped numeric directive, not a rewrite request (2026-08-04 failure class)", () => {
    const evidenceBlock = renderUnderstandingEvidence(makeEvidence());
    const prompt = buildUnderstandingRepairPrompt(
      evidenceBlock,
      makeValidPage(),
      [{ code: "purpose_too_long", message: "the purpose paragraph is 731 characters (maximum 600)" }],
      8_000,
      "en",
      { attempt: 1, total: 2 },
    );
    expect(prompt.system).toContain("[purpose_too_long]");
    expect(prompt.system).toContain("shorten ONLY the purpose paragraph");
    expect(prompt.system).toContain("Change nothing else");
    expect(prompt.system).not.toContain("do not work around it by deleting");
    // The length rule carries the salience fix in both prompt kinds.
    expect(prompt.system).toContain("aim for 400–550");
  });
});

describe("salvageUnderstandingCandidate (2026-08-12 deterministic salvage fallback)", () => {
  const sentence = (n: number) =>
    `Clause ${n} states one fact about what the repository does for its users.`;

  function page(purpose: string, bullets: string[]): string {
    return [
      "---",
      "title: Flow Repo",
      "owner: generated",
      "kind: understanding",
      "---",
      "",
      "# Flow Repo",
      "",
      purpose,
      "",
      "## Where to look in the code",
      "",
      ...bullets.map((b) => `- ${b}`),
      "",
    ].join("\n");
  }

  it("clips an over-cap purpose at the last sentence boundary and revalidates clean", () => {
    const purpose = Array.from({ length: 12 }, (_, i) => sentence(i + 1)).join(" ");
    expect(purpose.length).toBeGreaterThan(UNDERSTANDING_PURPOSE_MAX_CHARS);
    const candidate = page(purpose, ["The cli package drives the pipeline."]);
    expect(
      validateUnderstandingArtifact(candidate).map((e) => e.code),
    ).toEqual(["purpose_too_long"]);

    const clipped = salvageUnderstandingCandidate(candidate);
    expect(clipped).not.toBeNull();
    expect(validateUnderstandingArtifact(clipped!)).toEqual([]);
    expect(clipped).toContain("title: Flow Repo");
    expect(clipped).toContain("# Flow Repo");
    expect(clipped).toContain("## Where to look in the code");
    const parsed = parseUnderstandingPage(clipped!);
    expect(parsed!.purpose.length).toBeLessThanOrEqual(UNDERSTANDING_PURPOSE_MAX_CHARS);
    expect(parsed!.purpose.endsWith(".")).toBe(true);
    expect(parsed!.surfaces).toEqual(["The cli package drives the pipeline."]);
  });

  it("clips an over-cap bullet at a clause boundary (em-dash / comma, no terminator needed)", () => {
    const bullet =
      "The app services package wraps every external AI provider behind one seam — " +
      "voice, video, subtitles, music, and material search — keeping vendor details out of the domain code";
    expect(bullet.length).toBeGreaterThan(UNDERSTANDING_SURFACE_MAX_CHARS);
    const candidate = page("This repository turns short topic briefs into rendered videos.", [bullet]);
    expect(
      validateUnderstandingArtifact(candidate).map((e) => e.code),
    ).toEqual(["surface_too_long"]);

    const clipped = salvageUnderstandingCandidate(candidate);
    expect(clipped).not.toBeNull();
    expect(validateUnderstandingArtifact(clipped!)).toEqual([]);
    const parsed = parseUnderstandingPage(clipped!);
    expect(parsed!.surfaces[0]!.length).toBeLessThanOrEqual(UNDERSTANDING_SURFACE_MAX_CHARS);
    expect(bullet.startsWith(parsed!.surfaces[0]!)).toBe(true);
  });

  it("returns null when no honest clip point exists", () => {
    const purpose = `x`.repeat(UNDERSTANDING_PURPOSE_MAX_CHARS + 50);
    expect(salvageUnderstandingCandidate(page(purpose, []))).toBeNull();
    const bullet = `y`.repeat(UNDERSTANDING_SURFACE_MAX_CHARS + 50);
    expect(
      salvageUnderstandingCandidate(
        page("This repository turns short topic briefs into rendered videos.", [bullet]),
      ),
    ).toBeNull();
  });

  it("unwraps inline code spans (text kept, backticks dropped) and revalidates clean", () => {
    const purpose = `This repository turns topic briefs into rendered videos via main.py and the web UI for its users.`;
    const candidate = page(purpose, ["The app package assembles the FastAPI application."])
      .replace("main.py", "`main.py`")
      .replace("FastAPI", "`FastAPI`");
    expect(validateUnderstandingArtifact(candidate).map((e) => e.code)).toEqual([
      "code_span_forbidden",
    ]);

    const salvaged = salvageUnderstandingCandidate(candidate);
    expect(salvaged).not.toBeNull();
    expect(salvaged).not.toContain("`");
    expect(salvaged).toContain("main.py");
    expect(validateUnderstandingArtifact(salvaged!)).toEqual([]);
  });

  it("returns null when a non-mechanical violation survives the salvage (re-validates the whole contract)", () => {
    const purpose = `This page sneaks a [link](https://example.com) into prose. ${Array.from({ length: 10 }, (_, i) => sentence(i + 1)).join(" ")}`;
    const candidate = page(purpose, []);
    expect(salvageUnderstandingCandidate(candidate)).toBeNull();
  });

  it("refuses a candidate with a fenced code block", () => {
    const candidate = page("This repository turns topic briefs into rendered videos for its users.", [])
      .replace("## Where to look in the code", "```sh\nmain.py\n```\n\n## Where to look in the code");
    expect(salvageUnderstandingCandidate(candidate)).toBeNull();
  });
});
