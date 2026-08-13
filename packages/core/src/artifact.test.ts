/**
 * artifact.test.ts — Phase-5 plan (V): normalization + validation of
 * stage-4 output. Reproduces the real MiniMax formats preserved in the
 * baseline (docs/benchmarks/2026-07-10-minimax-m3/raw/livewiki/src.md and
 * llm.md), plus synthetic cases to cover all structural failures.
 *
 * Baseline findings reproduced here:
 *   - Finding 2: response starts with `<think>...</think>` consuming all
 *     tokens; task marked as done.
 *   - Finding 1: response with `<!-- lw:anchors key1 key2 -->` copied from
 *     the prompt.
 *   - Finding 4: response without frontmatter or with wrong owner.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeStage4Artifact,
  validateStage4Artifact,
  markDegradedArtifact,
  buildDegradedNotice,
} from "./artifact.js";

describe("artifact.normalizeStage4Artifact — strip + unwrap", () => {
  it("raw output (no think, no fence) is returned as-is", () => {
    const r = normalizeStage4Artifact("---\ntitle: x\nowner: generated\n---\n\n# x\n");
    expect(r.ok).toBe(true);
    expect(r.content).toMatch(/^---\n/);
  });

  it("strips ONE complete <think>…</think> block at the START (MiniMax baseline format)", () => {
    // Reproduced from docs/benchmarks/.../livewiki/src.md
    const raw = `<think>
Let me analyze the input carefully:

1. Use ONLY keys
2. Distribute them

Let me write the page now.
</think>

\`\`\`markdown
---
title: src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
---
# src

Brief.
\`\`\`
`;
    const r = normalizeStage4Artifact(raw);
    expect(r.ok).toBe(true);
    expect(r.content).not.toMatch(/<think>/);
    expect(r.content).not.toMatch(/<\/think>/);
    expect(r.content).toMatch(/^---\n/);
    expect(r.content).toMatch(/title: src/);
  });

  it("strips without outer fence (LLM without ```markdown but with think)", () => {
    const raw = `<think>reasoning</think>
---
title: x
owner: generated
anchors:
  - src/x.ts#foo
---
# x
Body.`;
    const r = normalizeStage4Artifact(raw);
    expect(r.ok).toBe(true);
    expect(r.content).toMatch(/^---\n/);
  });

  it("unwraps ` ```md ` fence too (short info string)", () => {
    const raw = `\`\`\`md
---
title: x
owner: generated
anchors:
  - src/x.ts#foo
---
# x
Body.
\`\`\`
`;
    const r = normalizeStage4Artifact(raw);
    expect(r.ok).toBe(true);
    expect(r.content).toMatch(/^---\n/);
  });

  it("does NOT unwrap a fence with non-markdown info string (e.g. ```ts) — the artifact starts with a fence", () => {
    const raw = `\`\`\`ts
const x = 1;
\`\`\`
`;
    const r = normalizeStage4Artifact(raw);
    // Content starts with ```ts — no frontmatter, validator will
    // complain later. But the normalization itself is "ok" (it is not a
    // structural normalization anomaly).
    expect(r.ok).toBe(true);
    expect(r.content).toMatch(/^```ts/);
  });

  it("unclosed <think> without matching </think> is REJECTED", () => {
    // Baseline finding 2: 4000 tokens in thinking, truncated response.
    const raw = `<think>
The user wants me to generate a Markdown documentation page. Let me think about
the structure carefully. I'll start with the frontmatter...

Let me also consider how to distribute the keys across sections. The closed list
has 4 keys:
- packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
- packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
- packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
- packages/core/test/fixtures/fase2-repo/src/auth.ts#validate

I should organize sections by symbol type. The Auth class gets the first section,
then standalone functions get their own sections.

Hmm, but the frontmatter anchors list should be the same as the closed list. The
section markers distribute keys to specific sections.

Wait — I need to make sure the prose is tight. Reference style, not marketing.

Let me think about the format. The frontmatter should have:
- title
- owner: generated
- anchors: list of all 4 keys

Then sections: each with a heading, a lw:anchors marker, and brief prose.

OK I have a plan. Let me write it out now. I'll start with:

\`\`\`markdown
---
title: src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

# src

Brief overview.

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth -->

## Auth

\`Auth\` is an exported class.
`;
    const r = normalizeStage4Artifact(raw);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe("unclosed_reasoning");
  });

  it("reasoning-only (only <think>…</think> with no markdown after) is REJECTED", () => {
    const raw = `<think>
just thinking, no markdown output
</think>
`;
    const r = normalizeStage4Artifact(raw);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe("reasoning_only");
  });

  it("empty output is REJECTED with empty_after_normalize", () => {
    expect(normalizeStage4Artifact("").ok).toBe(false);
    expect(normalizeStage4Artifact("   \n  ").ok).toBe(false);
    expect(normalizeStage4Artifact("\uFEFF").ok).toBe(false);
  });

  it("BOM is stripped (defensive)", () => {
    const raw = "\uFEFF---\ntitle: x\nowner: generated\nanchors:\n  - src/x.ts#f\n---\n# x";
    const r = normalizeStage4Artifact(raw);
    expect(r.ok).toBe(true);
    expect(r.content.startsWith("---")).toBe(true);
  });

  it("malformed <think> (with </think> but not a complete block at start) is REJECTED", () => {
    // Ambiguous case: has `<think>` at the start, BUT the first `</think>` does
    // not close a complete block (intervening text). The baseline never
    // produced this but we treat it as "malformed reasoning".
    const raw = `<think>
partial reasoning
without proper close

</think>
more text
`;
    // The `<think>...</think>` block is matched and stripped. What remains is "more text".
    // This is OK (does not become reasoning-only) but the validator then points
    // out missing frontmatter.
    const r = normalizeStage4Artifact(raw);
    expect(r.ok).toBe(true);
    expect(r.content.trim().startsWith("more text")).toBe(true);
  });
});

describe("artifact.validateStage4Artifact — schema + closed-list check", () => {
  const closedKeys = [
    "src/auth.ts#login",
    "src/auth.ts#logout",
    "src/auth.ts#validate",
  ];

  it("valid artifact (frontmatter + owner + anchors in list, EVERY key in both FM and a section) passes", () => {
    // Frontmatter and section markers must each independently
    // cover the full closed list — every key needs a section with real
    // prose too, not just a frontmatter listing.
    const art = `---
title: auth
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# Authentication responsibilities

This page documents authentication behavior.

## When to use this page

- Review authentication behavior.
- Change authentication implementation.

## How it fits

This module provides authentication within the repository.

## Details

<!-- lw:anchors src/auth.ts#login -->

Prose about login.

<!-- lw:anchors src/auth.ts#logout -->

Prose about logout.

<!-- lw:anchors src/auth.ts#validate -->

Prose about validate.
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("no frontmatter → no_frontmatter", () => {
    const r = validateStage4Artifact("# auth\n\nJust a heading, no frontmatter.\n", closedKeys);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "no_frontmatter")).toBe(true);
  });

  it("malformed frontmatter → invalid_frontmatter", () => {
    const art = `---
title: x
  bad-indent: yes
---
# x
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "invalid_frontmatter")).toBe(true);
  });

  it("wrong owner → wrong_owner", () => {
    const art = `---
title: x
owner: human
anchors:
  - src/auth.ts#login
---
# x
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "wrong_owner")).toBe(true);
  });

  it("invented anchor in frontmatter → anchor_outside_closed_list", () => {
    // Baseline finding 1: LLM copied `key1 key2` from the prompt
    const art = `---
title: x
owner: generated
anchors:
  - key1
  - key2
  - src/auth.ts#login
---
# x
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    const off = r.errors.filter((e) => e.code === "anchor_outside_closed_list");
    expect(off.length).toBe(2);
    expect(off[0]?.offending).toBe("key1");
    expect(off[1]?.offending).toBe("key2");
  });

  it("invented anchor in a section marker → anchor_outside_closed_list", () => {
    const art = `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
---
# x

## Section

<!-- lw:anchors src/auth.ts#logout fake-symbol -->

Body.
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    const off = r.errors.filter((e) => e.code === "anchor_outside_closed_list");
    expect(off.some((e) => e.offending === "fake-symbol")).toBe(true);
    expect(off.some((e) => e.sectionSlug !== undefined)).toBe(true);
  });

  it("ellipsis placeholder '...' in a real section marker outside code is rejected", () => {
    const art = `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# x

## Section

<!-- lw:anchors ... -->

Body.
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    const off = r.errors.filter(
      (e) => e.code === "anchor_outside_closed_list" && e.offending === "...",
    );
    expect(off.length).toBeGreaterThanOrEqual(1);
    // Validator must not accept or filter "..." — still an error code.
    expect(r.errors.every((e) => e.code !== "missing_closed_key" || e.offending !== "...")).toBe(
      true,
    );
  });

  it("accepts the v17 tools shape: complete real coverage plus fenced marker examples", () => {
    const art = `---
title: tools
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# Tool marker scanning

This page documents marker scanning behavior.

## When to use this page

- Review marker recognition.
- Change marker scanning.

## How it fits

This tooling module validates generated documentation artifacts.

## Marker scanning
<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

The scanner recognizes real markers outside code and documents its syntax:

\`\`\`markdown
<!-- lw:anchors ... -->
<!-- lw:anchors … -->
<!-- lw:anchors src/auth.ts#login src/auth.ts#logout -->
\`\`\`
`;

    const result = validateStage4Artifact(art, closedKeys);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("does not let a fenced marker satisfy closed-list coverage", () => {
    const art = `---
title: auth
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# auth

## Real coverage
<!-- lw:anchors src/auth.ts#login src/auth.ts#logout -->

Real prose for the covered keys.

\`\`\`markdown
<!-- lw:anchors src/auth.ts#validate -->
\`\`\`
`;

    const result = validateStage4Artifact(art, closedKeys);
    const sectionMissing = result.errors.filter(
      (error) => error.code === "missing_closed_key" && error.location === "section",
    );

    expect(result.ok).toBe(false);
    expect(sectionMissing.map((error) => error.offending)).toEqual([
      "src/auth.ts#validate",
    ]);
    expect(result.errors.some((error) => error.code === "duplicate_anchor")).toBe(false);
  });

  it("ignores an inline-code marker example", () => {
    const art = `---
title: auth
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# Authentication coverage

This page documents authentication coverage.

## When to use this page

- Review authentication coverage.
- Change authentication behavior.

## How it fits

This module provides authentication within the repository.

## Coverage
<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

The syntax \`<!-- lw:anchors fake-key -->\` is shown inline.
`;

    const result = validateStage4Artifact(art, closedKeys);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("ignores a fenced heading when associating a later real marker", () => {
    const key = "src/auth.ts#login";
    const art = `---
title: auth
owner: generated
anchors:
  - ${key}
---
## Real heading

\`\`\`markdown
## Fake fenced heading
\`\`\`

<!-- lw:anchors outside-key -->

Real prose.
`;

    const result = validateStage4Artifact(art, [key]);
    const outside = result.errors.find(
      (error) =>
        error.code === "anchor_outside_closed_list" && error.offending === "outside-key",
    );

    expect(outside?.sectionSlug).toBe("real-heading");
  });

  it("empty body (frontmatter only, nothing after) → empty_body", () => {
    const art = `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
---
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "empty_body")).toBe(true);
  });

  it("frontmatter without `anchors:` → no_frontmatter (vague)", () => {
    const art = `---
title: x
owner: generated
---
# x
Body.`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "no_frontmatter")).toBe(true);
  });

  it("accepts owner `generated` exactly, and `mixed` is rejected (only LLM can write generated)", () => {
    const human = `---
title: x
owner: human
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# x`;
    const mixed = `---
title: x
owner: mixed
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# x`;
    expect(validateStage4Artifact(human, closedKeys).ok).toBe(false);
    expect(validateStage4Artifact(mixed, closedKeys).ok).toBe(false);
  });

  it("partial FRONTMATTER coverage → missing_closed_key tagged frontmatter, independent of sections", () => {
    // Sections here fully cover the closed list, but frontmatter
    // is short 2 keys — the frontmatter-side check fires on its own.
    const art = `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
---
# Authentication responsibilities

This page documents authentication behavior.

## When to use this page

- Review authentication behavior.
- Change authentication implementation.

## How it fits

This module provides authentication within the repository.

## Details

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Body prose here.
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    const fmMissing = r.errors.filter(
      (e) => e.code === "missing_closed_key" && e.location === "frontmatter",
    );
    expect(fmMissing.map((e) => e.offending).sort()).toEqual([
      "src/auth.ts#logout",
      "src/auth.ts#validate",
    ]);
    expect(
      r.errors.some((e) => e.code === "missing_closed_key" && e.location === "section"),
    ).toBe(false);
  });

  it("partial SECTION coverage → missing_closed_key tagged section, independent of frontmatter", () => {
    // Frontmatter here fully covers the closed list, but only one
    // key is declared in a section marker — the section-side check fires
    // on its own, even though frontmatter is complete.
    const art = `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# x

<!-- lw:anchors src/auth.ts#login -->

Body prose here.
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    const sectionMissing = r.errors.filter(
      (e) => e.code === "missing_closed_key" && e.location === "section",
    );
    expect(sectionMissing.map((e) => e.offending).sort()).toEqual([
      "src/auth.ts#logout",
      "src/auth.ts#validate",
    ]);
    expect(
      r.errors.some((e) => e.code === "missing_closed_key" && e.location === "frontmatter"),
    ).toBe(false);
  });

  it("union coverage is insufficient — each location must cover the closed list", () => {
    // This exact shape used to PASS (union completeness) — it is the shape
    // that previously allowed pages to ship with real
    // coverage missing from one side. Now it fails on BOTH sides at once.
    const art = `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
---
# x

<!-- lw:anchors src/auth.ts#logout src/auth.ts#validate -->

Body.
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    const fmMissing = r.errors.filter(
      (e) => e.code === "missing_closed_key" && e.location === "frontmatter",
    );
    expect(fmMissing.map((e) => e.offending).sort()).toEqual([
      "src/auth.ts#logout",
      "src/auth.ts#validate",
    ]);
    const sectionMissing = r.errors.filter(
      (e) => e.code === "missing_closed_key" && e.location === "section",
    );
    expect(sectionMissing.map((e) => e.offending)).toEqual(["src/auth.ts#login"]);
  });

  it("duplicate key in frontmatter list → duplicate_anchor", () => {
    const art = `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# x

Body.
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) => e.code === "duplicate_anchor" && e.offending === "src/auth.ts#login",
      ),
    ).toBe(true);
  });

  it("same key in two section markers → duplicate_anchor", () => {
    const art = `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# a

<!-- lw:anchors src/auth.ts#login -->

# b

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout -->

Body.
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) =>
          e.code === "duplicate_anchor" &&
          e.offending === "src/auth.ts#login" &&
          e.location === "section",
      ),
    ).toBe(true);
  });

  it("key may appear once in frontmatter and once in a single section marker", () => {
    const art = `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
# Authentication responsibilities

This page documents authentication behavior.

## When to use this page

- Review authentication behavior.
- Change authentication implementation.

## How it fits

This module provides authentication within the repository.

## Details

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Body.
`;
    const r = validateStage4Artifact(art, closedKeys);
    expect(r.ok).toBe(true);
  });
});

describe("artifact.validateStage4Artifact — structural completeness", () => {
  const closedKeys = [
    "src/auth.ts#login",
    "src/auth.ts#logout",
    "src/auth.ts#validate",
  ];
  const fullArt = (body: string) => `---
title: x
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
  - src/auth.ts#validate
---
${body}`;

  describe("empty_section — anchor present but no real prose", () => {
    it("marker followed immediately by the next heading (nothing in between) → empty_section", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login -->

## Next section

<!-- lw:anchors src/auth.ts#logout src/auth.ts#validate -->

Real prose for logout and validate.
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.ok).toBe(false);
      const error = r.errors.find((e) => e.code === "empty_section");
      expect(error?.offending).toBe("<!-- lw:anchors src/auth.ts#login -->");
    });

    it("marker followed only by a TODO/TBD line (no other prose) → empty_section", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

TODO: fill this in later
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.code === "empty_section")).toBe(true);
    });

    it("marker followed by real prose before the next heading → no empty_section", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Real explanatory prose about all three.
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "empty_section")).toBe(false);
    });
  });

  describe("unclosed_markdown — body cut mid fence or mid code-span", () => {
    it("unclosed fenced code block → unclosed_markdown", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Example:

\`\`\`ts
const x = 1;
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.ok).toBe(false);
      const errs = r.errors.filter((e) => e.code === "unclosed_markdown");
      expect(errs).toHaveLength(1);
      // Actionable diagnostic: kind, 1-based line of the OPENING
      // fence, exact delimiter length, and an `offending` excerpt
      // that points to the opening delimiter line. R3 evidence:
      // the LLM kept the same unclosed construct through every
      // repair attempt because the previous generic message had
      // no opening pointer and no length.
      expect(errs[0]!.message).toMatch(/fenced code block/);
      expect(errs[0]!.message).toMatch(/line\s+7/);
      expect(errs[0]!.message).toMatch(/delimiter length 3/);
      // Fence closing rule: same character, run of at least K.
      expect(errs[0]!.message).toMatch(/at least 3 characters/);
      expect(errs[0]!.message).not.toMatch(/exactly \d+ backticks/);
      expect(errs[0]!.offending).toBe("```ts");
    });

    it("unclosed inline code span (cut mid-token, the tools.md finding) → unclosed_markdown with the unmatched run on its own line", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Run with \`node acceptance-analysis.mjs <artifactRoot
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.ok).toBe(false);
      const errs = r.errors.filter((e) => e.code === "unclosed_markdown");
      expect(errs).toHaveLength(1);
      // Actionable diagnostic: kind, 1-based line of the unmatched
      // backtick run, exact delimiter length (1 backtick here),
      // and an `offending` excerpt. Body lines:
      //   1: "# x"
      //   2: (empty)
      //   3: "<!-- lw:anchors ... -->"
      //   4: (empty)
      //   5: "Run with `node acceptance-analysis.mjs <artifactRoot"
      expect(errs[0]!.message).toMatch(/inline-code span/);
      expect(errs[0]!.message).toMatch(/line\s+5/);
      expect(errs[0]!.message).toMatch(/delimiter length 1/);
      // Inline-code closing rule: EXACTLY K backticks, not "at least".
      // `maskInlineCode` requires an exact-length match; K+1 leaves
      // the span open.
      expect(errs[0]!.message).toMatch(/exactly 1 backticks/);
      expect(errs[0]!.message).not.toMatch(/at least \d+ characters/);
      expect(errs[0]!.offending).toBe(
        "Run with `node acceptance-analysis.mjs <artifactRoot",
      );
    });

    it("properly closed fences and inline code → no unclosed_markdown", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Uses \`node cli.js\` and:

\`\`\`ts
const x = 1;
\`\`\`
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "unclosed_markdown")).toBe(false);
    });

    it("unclosed inline-code span with 198 backticks and content on both sides → bounded excerpt with visible representative portion, message states exact length", () => {
      // R4 follow-up: the previous `boundedExcerpt` overwrote the
      // trailing 2 delimiter characters with the right truncation
      // marker when the run was longer than the cap. The fix carries
      // the exact length in the diagnostic message so the repair
      // model can emit a closing run of equal or greater length;
      // the bounded excerpt shows a visible portion of the run.
      const before = "A".repeat(500);
      const after = "Z".repeat(500);
      const run = "`".repeat(198);
      const body = `${before}${run}${after}`;
      const r = validateStage4Artifact(fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

${body}
`), closedKeys);
      const errs = r.errors.filter((e) => e.code === "unclosed_markdown");
      expect(errs).toHaveLength(1);
      // Exact delimiter length in the message (this is what the
      // bounded excerpt CANNOT encode when the run is longer than
      // the cap).
      expect(errs[0]!.message).toMatch(/delimiter length 198/);
      // Bounded excerpt: stays within the cap.
      expect(errs[0]!.offending!.length).toBeLessThanOrEqual(200);
      // Visible representative portion of the delimiter run.
      expect(errs[0]!.offending!.includes("`")).toBe(true);
    });

    it("unclosed inline-code span with >200 backticks and content on both sides → bounded excerpt with visible portion, message states exact length", () => {
      // Run is strictly longer than the diagnostic cap. The excerpt
      // can only show a visible portion; the message carries the
      // exact length so the repair model can close it correctly.
      const before = "A".repeat(100);
      const after = "Z".repeat(100);
      const run = "`".repeat(260);
      const body = `${before}${run}${after}`;
      const r = validateStage4Artifact(fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

${body}
`), closedKeys);
      const errs = r.errors.filter((e) => e.code === "unclosed_markdown");
      expect(errs).toHaveLength(1);
      expect(errs[0]!.message).toMatch(/delimiter length 260/);
      expect(errs[0]!.offending!.length).toBeLessThanOrEqual(200);
      expect(errs[0]!.offending!.includes("`")).toBe(true);
    });

    it("fence directive: at least K characters (NOT exactly K backticks) — closing a fence with K+1 characters is still valid CommonMark", () => {
      // The fence closing rule differs from inline-code: per
      // CommonMark, the closing fence may be longer than the opening
      // fence. The diagnostic must say "at least K characters" and
      // must NOT say "exactly K backticks".
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Example:

\`\`\`\`ts
const x = 1;
`);
      const r = validateStage4Artifact(art, closedKeys);
      const errs = r.errors.filter((e) => e.code === "unclosed_markdown");
      expect(errs).toHaveLength(1);
      expect(errs[0]!.message).toMatch(/fenced code block/);
      expect(errs[0]!.message).toMatch(/delimiter length 4/);
      expect(errs[0]!.message).toMatch(/at least 4 characters/);
      expect(errs[0]!.message).not.toMatch(/exactly 4 backticks/);
    });

    it("inline-code directive: exactly K backticks (NOT at least K characters) — closing an inline-code span with K+1 leaves it open per maskInlineCode", () => {
      // The inline-code closing rule differs from fence: per
      // CommonMark, the closing backtick run must be EXACTLY the
      // same length as the opening run. The diagnostic must say
      // "exactly K backticks" and must NOT say "at least K
      // characters". This case uses a 2-backtick run so the
      // difference is not collapsible to a 1-backtick edge case.
      const run = "``";
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Value is ${run}unclosed
`);
      const r = validateStage4Artifact(art, closedKeys);
      const errs = r.errors.filter((e) => e.code === "unclosed_markdown");
      expect(errs).toHaveLength(1);
      expect(errs[0]!.message).toMatch(/inline-code span/);
      expect(errs[0]!.message).toMatch(/delimiter length 2/);
      expect(errs[0]!.message).toMatch(/exactly 2 backticks/);
      expect(errs[0]!.message).not.toMatch(/at least 2 characters/);
    });
  });

  describe("todo_marker_present — TODO/TBD banned outside code and lw:manual", () => {
    it("TODO in plain prose → todo_marker_present", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

TODO: describe this properly.
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.code === "todo_marker_present")).toBe(true);
    });

    it("TBD in plain prose → todo_marker_present", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Behavior is TBD pending review.
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "todo_marker_present")).toBe(true);
    });

    it("TODO quoted inside an inline code span (real code comment) → NOT flagged", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

The source has a literal \`// TODO: refactor\` comment on line 12.
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "todo_marker_present")).toBe(false);
    });

    it("TODO quoted inside a fenced code block → NOT flagged", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Example:

\`\`\`ts
// TODO: refactor this later
const x = 1;
\`\`\`
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "todo_marker_present")).toBe(false);
    });

    it("TODO as legitimate prose about the source (Etapa 3 run #4) → NOT flagged", () => {
      // The rationale evidence (Etapa 2b) deliberately feeds TODO-tagged
      // source comments to the prompt; documenting them is content, not a
      // placeholder. Only the model's own placeholder forms are banned.
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

The module tracks remaining work in TODO comments, mainly the retry backoff and the session expiry review noted in app/config.py.
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "todo_marker_present")).toBe(false);
    });

    it("standalone TODO bullet (model's own placeholder) → flagged", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

- TODO
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "todo_marker_present")).toBe(true);
    });

    it("plain prose without TODO/TBD → not flagged", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Everything here is fully described, nothing pending.
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "todo_marker_present")).toBe(false);
    });

    it("TODO/TBD prose used as a validation-category label → not flagged", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Run the audit to find stray TODO/TBD prose in masked output.
The spaced TODO / TBD prose label describes the same validation category.
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "todo_marker_present")).toBe(false);

      const withRealPlaceholder = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Run the audit to find stray TODO/TBD prose in masked output.
TODO: document the remaining behavior.
`);
      const placeholderError = validateStage4Artifact(
        withRealPlaceholder,
        closedKeys,
      ).errors.find((e) => e.code === "todo_marker_present");
      expect(placeholderError?.offending).toBe(
        "TODO: document the remaining behavior.",
      );
    });

    it("quoted or slash-paired TODO/TBD mentions documenting the ban itself → NOT flagged (dogfood run #3, core-src/prompts)", () => {
      // Dogfood run #3 (2026-08-12): the documented file literally contains
      // the ban's tokens, so the model's page quoted them while DESCRIBING
      // the rule. All four phrasings below were observed in paid attempts
      // and all were flagged, even though none is a placeholder. Quoted
      // literals and slash-joined pairs are mentions and must pass.
      const mentions = [
        `The markdown is fully closed; "TODO"/"TBD" placeholders are forbidden.`,
        `It enforces the "TODO/TBD in prose is forbidden" rule alongside the marker rules.`,
        `It forbids placeholders such as "TODO" or "TBD" — thin evidence yields a shorter paragraph instead.`,
        `Unclosed fences must be closed, and TODO/TBD tokens must be replaced by concrete factual sentences.`,
      ];
      for (const [index, sentence] of mentions.entries()) {
        const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

${sentence}
`);
        const r = validateStage4Artifact(art, closedKeys);
        expect(
          r.errors.some((e) => e.code === "todo_marker_present"),
          `mention form ${index} must not be flagged: ${sentence}`,
        ).toBe(false);
      }
    });

    it("bare TBD dodge stays banned next to quoted mentions", () => {
      // The quoted mention is exempt, but a real bare-TBD dodge on the same
      // line must still fail — the exemption is per token, not per page.
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

The file bans "TODO" or "TBD" placeholders. Behavior is TBD pending review.
`);
      const errs = validateStage4Artifact(art, closedKeys).errors.filter(
        (e) => e.code === "todo_marker_present",
      );
      expect(errs).toHaveLength(1);
      expect(errs[0]!.offending).toContain("Behavior is TBD");
    });

    it("quote/pair exemptions require metalinguistic context — real dodges stay flagged (maintainer review 2026-08-12)", () => {
      // Maintainer review of the run-#3 fix: without the context
      // requirement, the quote/pair mention exemptions would also pass
      // these real placeholders. Directives are checked FIRST (a colon
      // after the token — optionally closing a quote — or after the
      // pair), and the exemptions only apply when the line explicitly
      // talks about the placeholder category.
      const dodges = [
        `The status is "TBD".`,
        `"TBD": document this later.`,
        `The migration is TODO/TBD.`,
        `TODO/TBD: complete this section.`,
      ];
      for (const [index, sentence] of dodges.entries()) {
        const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

${sentence}
`);
        const r = validateStage4Artifact(art, closedKeys);
        expect(
          r.errors.some((e) => e.code === "todo_marker_present"),
          `dodge ${index} must be flagged: ${sentence}`,
        ).toBe(true);
      }
    });

    it("C3 TODO in plain prose reports the offending line (short lines exact, long lines excerpted ≤200 with truncation markers) and its line number", () => {
      // Defect 3: the validation error used to carry no offending text
      // and no line number — the repair prompt had no way to point the
      // LLM at the specific line that needed replacement. Long lines
      // must also be bounded to the diagnostic cap so a runaway
      // multi-kilobyte line cannot inflate the repair prompt.
      //
      // Defect 1 (offset correctness): the offending excerpt and line
      // number must come from the ORIGINAL body — putting a fenced
      // code block before the TODO line and asserting the EXACT 1-based
      // line number verifies that the masked offset maps to the
      // original (a fence before the line shifts the original-body
      // line number, not the masked one). A CRLF variant in the same
      // minimal test verifies that the length-preserving code-span
      // mask keeps the offset stable on CRLF input (the R3 defect).
      const shortArt = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Login uses the credentials from the request.

TODO: describe the cache invalidation path.

The validate function checks the token signature.
`);
      const shortResult = validateStage4Artifact(shortArt, closedKeys);
      const shortErrs = shortResult.errors.filter(
        (e) => e.code === "todo_marker_present",
      );
      expect(shortErrs).toHaveLength(1);
      expect(shortErrs[0]!.offending).toBe(
        "TODO: describe the cache invalidation path.",
      );
      // Body-relative line number — the fenced anchor marker and the
      // heading precede the TODO. Body lines:
      //   1: "# x"
      //   2: (empty)
      //   3: "<!-- lw:anchors ... -->"
      //   4: (empty)
      //   5: "Login uses the credentials from the request."
      //   6: (empty)
      //   7: "TODO: describe the cache invalidation path."
      //   8: (empty)
      //   9: "The validate function checks the token signature."
      // We assert the exact 1-based line number derived from the
      // ORIGINAL body so a wrong offset would surface as a numeric
      // mismatch.
      const todoLineNumber = shortErrs[0]!.message.match(/line\s+(\d+)/i)?.[1];
      expect(todoLineNumber).toBe("7");

      // Fence-then-TODO case: a fenced code block before the
      // TODO must not shift the diagnostic onto the fence line.
      // The first TODO outside code is on line N; the excerpt
      // must equal that line, never the fence.
      const fenceBeforeArt = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

\`\`\`ts
const FENCE_TOKEN = 1;
\`\`\`

TODO: describe the cache invalidation path.

The validate function checks the token signature.
`);
      const fenceBeforeResult = validateStage4Artifact(fenceBeforeArt, closedKeys);
      const fenceBeforeErrs = fenceBeforeResult.errors.filter(
        (e) => e.code === "todo_marker_present",
      );
      expect(fenceBeforeErrs).toHaveLength(1);
      expect(fenceBeforeErrs[0]!.offending).toBe(
        "TODO: describe the cache invalidation path.",
      );
      expect(fenceBeforeErrs[0]!.offending).not.toContain("FENCE_TOKEN");
      // The body-relative line is shifted by the fence but the
      // validator must still report the TODO's line, not the
      // fence's line. Body lines (fence adds 3 lines: open, body,
      // close):
      //   1: "# x"
      //   2: (empty)
      //   3: "<!-- lw:anchors ... -->"
      //   4: (empty)
      //   5: "```ts"
      //   6: "const FENCE_TOKEN = 1;"
      //   7: "```"
      //   8: (empty)
      //   9: "TODO: describe the cache invalidation path."
      const fenceBeforeLine = fenceBeforeErrs[0]!.message.match(/line\s+(\d+)/i)?.[1];
      expect(fenceBeforeLine).toBe("9");

      // CRLF case: same logical structure with \r\n terminators.
      // The non-preserving `maskCodeSpans` would drop the
      // carriage returns and shift the offset; the
      // length-preserving variant must keep the line number exact.
      const crlfArt = fullArt(
        "# x\r\n\r\n<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->\r\n\r\nLogin uses the credentials from the request.\r\n\r\nTODO: describe the cache invalidation path.\r\n\r\nThe validate function checks the token signature.\r\n",
      );
      const crlfResult = validateStage4Artifact(crlfArt, closedKeys);
      const crlfErrs = crlfResult.errors.filter(
        (e) => e.code === "todo_marker_present",
      );
      expect(crlfErrs).toHaveLength(1);
      expect(crlfErrs[0]!.offending).toBe(
        "TODO: describe the cache invalidation path.",
      );
      const crlfLine = crlfErrs[0]!.message.match(/line\s+(\d+)/i)?.[1];
      expect(crlfLine).toBe("7");

      // Long-line case: ~40k-character logical line with TODO near the
      // middle. The excerpt must be ≤ 200 chars, retain TODO, indicate
      // truncation, and the message must still carry the correct
      // body-relative line number. Spaces around TODO create the word
      // boundaries the `\b(TODO|TBD)\b` regex requires.
      const longLine = "A".repeat(20_000) + " TODO: " + "B".repeat(20_000);
      expect(longLine.length).toBe(40_007);
      const longArt = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

${longLine}
`);
      const longResult = validateStage4Artifact(longArt, closedKeys);
      const longErrs = longResult.errors.filter(
        (e) => e.code === "todo_marker_present",
      );
      expect(longErrs).toHaveLength(1);
      expect(longErrs[0]!.offending).toBeDefined();
      expect(longErrs[0]!.offending!.length).toBeLessThanOrEqual(200);
      expect(longErrs[0]!.offending).toContain("TODO");
      expect(longErrs[0]!.offending).toMatch(/…/);
      expect(longErrs[0]!.message).toMatch(/line\s+\d+/i);
    });
  });
});

describe("artifact.validateStage4Artifact — Lot N opening and semantic title", () => {
  const key = "src/auth.ts#login";
  const page = (title = "Authentication responsibilities", opening?: string) => `---
title: ${title}
owner: generated
anchors:
  - ${key}
---

${opening ?? `# ${title}

This page documents authentication behavior.

## When to use this page

- Review authentication behavior.
- Change authentication implementation.

## How it fits

This module provides authentication within the repository.`}

## Details

<!-- lw:anchors ${key} -->

The indexed function handles the documented operation.
`;

  it("accepts the complete opening before the first anchored section", () => {
    expect(validateStage4Artifact(page(), [key]).errors).toEqual([]);
  });

  it.each([
    ["a bold-led bullet", "# Authentication responsibilities\n\nThis page documents authentication behavior.\n\n## When to use this page\n\n- **Review** authentication behavior.\n- Change behavior.\n\n## How it fits\n\nThis module provides authentication."],
    ["an inline-code-led bullet", "# Authentication responsibilities\n\nThis page documents authentication behavior.\n\n## When to use this page\n\n- `livewiki init` creates the layout.\n- Change behavior.\n\n## How it fits\n\nThis module provides authentication."],
    ["Title Case opening headings", "# Authentication responsibilities\n\nThis page documents authentication behavior.\n\n## When to Use This Page\n\n- Review behavior.\n- Change behavior.\n\n## How It Fits\n\nThis module provides authentication."],
    ["two How it fits paragraphs", "# Authentication responsibilities\n\nThis page documents authentication behavior.\n\n## When to use this page\n\n- Review behavior.\n- Change behavior.\n\n## How it fits\n\nThis module provides authentication.\n\nIt sits beside the repository's authorization support."],
  ])("accepts %s", (_name, opening) => {
    const errors = validateStage4Artifact(page(undefined, opening), [key]).errors;
    expect(errors.some((error) => error.code === "missing_page_opening")).toBe(false);
  });

  it.each([
    [
      "missing H1",
      "This page documents authentication behavior.\n\n## When to use this page\n\n- Review behavior.\n- Change behavior.\n\n## How it fits\n\nThis module provides authentication.",
      "required page opening H1 is missing",
      "(absent)",
    ],
    [
      "late H1",
      "Introductory text.\n\n# Authentication responsibilities\n\nThis page documents authentication behavior.\n\n## When to use this page\n\n- Review behavior.\n- Change behavior.\n\n## How it fits\n\nThis module provides authentication.",
      "required page opening H1 appears after other content",
      "# Authentication responsibilities",
    ],
    [
      "missing responsibility",
      "# Authentication responsibilities\n\n## When to use this page\n\n- Review behavior.\n- Change behavior.\n\n## How it fits\n\nThis module provides authentication.",
      "page opening responsibility paragraph is missing",
      "(absent)",
    ],
    [
      "malformed responsibility",
      "# Authentication responsibilities\n\nThis page documents authentication behavior.\n\nThis second paragraph is not allowed here.\n\n## When to use this page\n\n- Review behavior.\n- Change behavior.\n\n## How it fits\n\nThis module provides authentication.",
      "page opening responsibility block must be exactly one prose paragraph",
      "This second paragraph is not allowed here.",
    ],
    [
      "missing When to use this page",
      "# Authentication responsibilities\n\nThis page documents authentication behavior.\n\n## Usage\n\n- Review behavior.\n- Change behavior.\n\n## How it fits\n\nThis module provides authentication.",
      'required page opening H2 "When to use this page" is missing or malformed',
      "## Usage",
    ],
    [
      "too few bullets",
      "# Authentication responsibilities\n\nThis page documents authentication behavior.\n\n## When to use this page\n\n- Review behavior.\n\n## How it fits\n\nThis module provides authentication.",
      'page opening "When to use this page" task list must contain only 2 to 4 non-empty Markdown bullets',
      "- Review behavior.",
    ],
    [
      "missing How it fits",
      "# Authentication responsibilities\n\nThis page documents authentication behavior.\n\n## When to use this page\n\n- Review behavior.\n- Change behavior.",
      'required page opening H2 "How it fits" is missing or malformed',
      "(absent)",
    ],
    [
      "malformed How it fits",
      "# Authentication responsibilities\n\nThis page documents authentication behavior.\n\n## When to use this page\n\n- Review behavior.\n- Change behavior.\n\n## How it fits\n\n- This must be prose, not a bullet.",
      'page opening "How it fits" must contain one or more prose paragraphs without headings, bullets, or lw: markers',
      "- This must be prose, not a bullet.",
    ],
  ])("reports the first granular opening failure for %s", (_name, opening, message, offending) => {
    const errors = validateStage4Artifact(page(undefined, opening), [key]).errors;
    const openingErrors = errors.filter((error) => error.code === "missing_page_opening");
    expect(openingErrors).toHaveLength(1);
    expect(openingErrors[0]).toMatchObject({ message, offending, location: "body" });
  });

  it("rejects an exact product title/id match only when context is supplied", () => {
    const withoutContext = validateStage4Artifact(page("auth"), [key]);
    expect(withoutContext.errors.some((error) => error.code === "title_equals_module_id")).toBe(false);

    const withContext = validateStage4Artifact(page("auth"), [key], {
      moduleId: "auth",
      moduleRole: "product",
    });
    expect(withContext.errors).toContainEqual(expect.objectContaining({
      code: "title_equals_module_id",
      location: "frontmatter",
      offending: "auth",
    }));
  });

  it.each(["fixture", "tooling", "docs"] as const)("exempts the %s role", (moduleRole) => {
    const result = validateStage4Artifact(page("auth"), [key], { moduleId: "auth", moduleRole });
    expect(result.errors.some((error) => error.code === "title_equals_module_id")).toBe(false);
  });
});

describe("artifact.validateStage4Artifact — zero-key How-it-fits boundary", () => {
  // Paid-R2 reproduction: zero-symbol modules (cli, cli-scripts, core) all
  // exhausted their repair budget with `missing_page_opening` because the
  // opening check treated every later unanchored H2 as part of the How it
  // fits prose block. The zero-key prompt contract requires unanchored
  // implementation sections AFTER the opening, so the opening slice must
  // be bounded at the next H2 after the How it fits heading.
  const validZeroKeyOpening =
    "# CLI responsibilities\n\n" +
    "This page documents the CLI surface of the livewiki package.\n\n" +
    "## When to use this page\n\n" +
    "- Review CLI behavior.\n" +
    "- Change CLI behavior.\n\n" +
    "## How it fits\n\n" +
    "This module provides the CLI entrypoint beside the repository's other tooling.";
  const validZeroKeyOpeningBeforeH3 =
    validZeroKeyOpening +
    "\n\n### Test environment\n\n" +
    "The tests exercise the CLI through the package's compiled entrypoint.";
  const invalidZeroKeyOpening =
    "# CLI responsibilities\n\n" +
    "This page documents the CLI surface of the livewiki package.\n\n" +
    "## When to use this page\n\n" +
    "- Review CLI behavior.\n" +
    "- Change CLI behavior.\n\n" +
    "## How it fits\n\n" +
    "## Test environment and discovery";
  const zeroKeyPage = (opening: string) => `---
title: cli
owner: generated
anchors: []
---

${opening}

## Test environment and discovery

The package's commands are discoverable through the standard help output.
`;

  it("accepts a valid How-it-fits prose block followed by an unanchored H2 or H3; rejects a heading with no How-it-fits prose", () => {
    for (const opening of [validZeroKeyOpening, validZeroKeyOpeningBeforeH3]) {
      const validResult = validateStage4Artifact(zeroKeyPage(opening), []);
      const validOpeningErrs = validResult.errors.filter(
        (e) => e.code === "missing_page_opening",
      );
      expect(validOpeningErrs, "valid zero-key page must not trip missing_page_opening").toEqual([]);
    }

    const invalidResult = validateStage4Artifact(zeroKeyPage(invalidZeroKeyOpening), []);
    const invalidOpeningErrs = invalidResult.errors.filter(
      (e) => e.code === "missing_page_opening",
    );
    expect(invalidOpeningErrs).toHaveLength(1);
    expect(invalidOpeningErrs[0]!.message).toMatch(/How it fits/);
  });
});

describe("artifact — pipeline normalize+validate (round-trip)", () => {
  it("MiniMax baseline output (src.md) normalizes to a valid artifact", () => {
    // Reproduced literally from docs/benchmarks/2026-07-10-minimax-m3/raw/livewiki/src.md
    const raw = `<think>
The user wants me to generate a Markdown documentation page for the src module, specifically for the file packages/core/test/fixtures/fase2-repo/src/auth.ts. I need to:

1. Use ONLY the 4 keys from the closed list
2. Distribute them across sections using <!-- lw:anchors key1 key2 --> markers
3. Include frontmatter with title, owner, and anchors list
4. Keep prose tight, reference-style
5. Use "TODO: <reason>" for missing info
6. Output syntactically valid Markdown

Let me plan the structure:
</think>

\`\`\`markdown
---
title: src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

# src

Source file exposing an authentication helper class.

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

## Auth

\`Auth\` is an exported class.

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

## validate

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

## extra
\`\`\`
`;
    const norm = normalizeStage4Artifact(raw);
    // Normalization (think-strip + fence-unwrap) still succeeds — that part
    // of the pipeline is unchanged.
    expect(norm.ok).toBe(true);
    expect(norm.content).toMatch(/^---\n/);
    const closed = [
      "packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth",
      "packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash",
      "packages/core/test/fixtures/fase2-repo/src/auth.ts#extra",
      "packages/core/test/fixtures/fase2-repo/src/auth.ts#validate",
    ];
    const val = validateStage4Artifact(norm.content, closed);
    // This real historical MiniMax output has
    // two bare headings ("## validate", "## extra") with an anchor marker
    // but NO explanatory prose before the next marker/end of page — exactly
    // the "anchor present but section undocumented" gap the stricter
    // contract now catches. It no longer passes as-is.
    expect(val.ok).toBe(false);
    const emptySections = val.errors.filter((e) => e.code === "empty_section");
    expect(emptySections.length).toBeGreaterThanOrEqual(2);
  });

  it("output with anchor copied from prompt (key1) is REJECTED even after normalizing", () => {
    const raw = `<think>reasoning</think>
---
title: x
owner: generated
anchors:
  - key1
  - src/auth.ts#login
---
# x
Body.`;
    const norm = normalizeStage4Artifact(raw);
    expect(norm.ok).toBe(true);
    const val = validateStage4Artifact(norm.content, ["src/auth.ts#login"]);
    expect(val.ok).toBe(false);
    expect(val.errors.some((e) => e.code === "anchor_outside_closed_list" && e.offending === "key1")).toBe(true);
  });
});

describe("artifact.validateStage4Artifact — flow page kind (stage 5)", () => {
  const flowKeys = ["src/cli.ts#run", "src/core.ts#batch", "src/store.ts#persist"];
  const FLOW_FRONTMATTER = `---
title: Batch documentation run
owner: generated
anchors:
  - src/cli.ts#run
  - src/core.ts#batch
  - src/store.ts#persist
modules:
  - cli
  - core
---
`;
  const flowContext = {
    moduleId: "batch-documentation-run",
    moduleRole: "product",
    pageKind: "flow",
    expectedFlowDiagram: "livewiki/diagrams/flow-batch-documentation-run.mmd",
    // Deliberately reversed: the modules set comparison is order-insensitive.
    expectedFlowModules: ["core", "cli"],
  } as const;

  const OPENING = `# Batch documentation run

This page explains how a batch run documents the repository end to end.`;
  const PURPOSE = `## Purpose

<!-- lw:anchors src/cli.ts#run -->

A batch run starts from the CLI and produces accepted module pages.`;
  const ORDERED = `## Ordered flow

<!-- lw:anchors src/core.ts#batch -->

1. The CLI parses the invocation.
2. The orchestrator documents each module.`;
  const DIAGRAM = `## Diagram

\`\`\`mermaid
%% livewiki/diagrams/flow-batch-documentation-run.mmd
\`\`\``;
  const INVARIANTS = `## Invariants

- Every page passes the validator before write.`;
  const FAILURE = `## Failure and recovery

<!-- lw:anchors src/store.ts#persist -->

A failed task is marked and the run continues to the next task.`;
  const RELATED = `## Related pages

- [CLI module](cli.md)
- [Core module](core.md)`;

  const fullBody = () =>
    [OPENING, PURPOSE, ORDERED, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n");
  const flowPage = (body: string, frontmatter = FLOW_FRONTMATTER) =>
    `${frontmatter}\n${body}\n`;

  it("accepts a minimal valid flow page (expected modules are order-insensitive)", () => {
    const r = validateStage4Artifact(flowPage(fullBody()), flowKeys, flowContext);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("accepts a valid flow page without the optional expectations", () => {
    const r = validateStage4Artifact(flowPage(fullBody()), flowKeys, {
      moduleId: "batch-documentation-run",
      moduleRole: "product",
      pageKind: "flow",
    });
    expect(r.errors).toEqual([]);
  });

  it("accepts any flow-* placeholder when expectedFlowDiagram is not provided", () => {
    const body = [
      OPENING,
      PURPOSE,
      ORDERED,
      `## Diagram\n\n\`\`\`mermaid\n%% livewiki/diagrams/flow-other-run.mmd\n\`\`\``,
      INVARIANTS,
      FAILURE,
      RELATED,
    ].join("\n\n");
    const r = validateStage4Artifact(flowPage(body), flowKeys, {
      moduleId: "batch-documentation-run",
      moduleRole: "product",
      pageKind: "flow",
    });
    expect(r.errors).toEqual([]);
  });

  it.each([
    [
      "missing H1",
      [
        "This page explains how a batch run documents the repository end to end.",
        PURPOSE, ORDERED, DIAGRAM, INVARIANTS, FAILURE, RELATED,
      ].join("\n\n"),
      "required page opening H1 is missing",
      "(absent)",
    ],
    [
      "late H1",
      ["Introductory text.", OPENING, PURPOSE, ORDERED, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n"),
      "required page opening H1 appears after other content",
      "# Batch documentation run",
    ],
    [
      "missing responsibility",
      ["# Batch documentation run", PURPOSE, ORDERED, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n"),
      "page opening responsibility paragraph is missing",
      "(absent)",
    ],
    [
      "two responsibility paragraphs",
      [
        "# Batch documentation run\n\nThis page explains how a batch run documents the repository end to end.\n\nA second paragraph is not allowed here.",
        PURPOSE, ORDERED, DIAGRAM, INVARIANTS, FAILURE, RELATED,
      ].join("\n\n"),
      "page opening responsibility block must be exactly one prose paragraph",
      "A second paragraph is not allowed here.",
    ],
    [
      "an anchor marker before Purpose",
      [
        "# Batch documentation run\n\nThis page explains how a batch run documents the repository end to end.\n\n<!-- lw:anchors src/cli.ts#run -->",
        `## Purpose\n\nA batch run starts from the CLI and produces accepted module pages.`,
        ORDERED, DIAGRAM, INVARIANTS, FAILURE, RELATED,
      ].join("\n\n"),
      "page opening responsibility block must be exactly one prose paragraph",
      "<!-- lw:anchors src/cli.ts#run -->",
    ],
    [
      "missing Purpose",
      [OPENING, ORDERED, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n"),
      'required page opening H2 "Purpose" is missing or malformed',
      "## Ordered flow",
    ],
    [
      "Purpose without prose",
      [OPENING, `## Purpose\n\n<!-- lw:anchors src/cli.ts#run -->`, ORDERED, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n"),
      'page opening "Purpose" must contain one or more prose paragraphs',
      "(absent)",
    ],
    [
      "missing Ordered flow",
      [OPENING, PURPOSE, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n"),
      'required page opening H2 "Ordered flow" is missing or malformed',
      "## Diagram",
    ],
    [
      "Ordered flow without a numbered list",
      [OPENING, PURPOSE, `## Ordered flow\n\nThe CLI parses the invocation and the orchestrator documents each module.`, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n"),
      'page opening "Ordered flow" must contain a numbered Markdown list with at least one item',
      "The CLI parses the invocation and the orchestrator documents each module.",
    ],
    [
      "missing Diagram",
      [OPENING, PURPOSE, ORDERED, INVARIANTS, FAILURE, RELATED].join("\n\n"),
      'required page opening H2 "Diagram" is missing or malformed',
      "## Invariants",
    ],
    [
      "Diagram without the placeholder line",
      [OPENING, PURPOSE, ORDERED, `## Diagram\n\n\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\``, INVARIANTS, FAILURE, RELATED].join("\n\n"),
      'page opening "Diagram" must contain a fenced mermaid code block holding a %% livewiki/diagrams/flow-<slug>.mmd placeholder line',
      "(absent)",
    ],
    [
      "missing Invariants",
      [OPENING, PURPOSE, ORDERED, DIAGRAM, FAILURE, RELATED].join("\n\n"),
      'required page opening H2 "Invariants" is missing or malformed',
      "## Failure and recovery",
    ],
    [
      "Invariants without content",
      [OPENING, PURPOSE, ORDERED, DIAGRAM, `## Invariants`, FAILURE, RELATED].join("\n\n"),
      'page opening "Invariants" must contain prose or bullets',
      "(absent)",
    ],
    [
      "missing Failure and recovery",
      [OPENING, PURPOSE, ORDERED, DIAGRAM, INVARIANTS, RELATED].join("\n\n"),
      'required page opening H2 "Failure and recovery" is missing or malformed',
      "## Related pages",
    ],
    [
      "missing Related pages",
      [OPENING, PURPOSE, ORDERED, DIAGRAM, INVARIANTS, FAILURE].join("\n\n"),
      'required page opening H2 "Related pages" is missing or malformed',
      "(absent)",
    ],
    [
      "Related pages without a link",
      [OPENING, PURPOSE, ORDERED, DIAGRAM, INVARIANTS, FAILURE, `## Related pages\n\nSee the module pages for details.`].join("\n\n"),
      'page opening "Related pages" must contain at least one Markdown link',
      "See the module pages for details.",
    ],
    [
      "Diagram misordered before Ordered flow",
      [OPENING, PURPOSE, DIAGRAM, ORDERED, INVARIANTS, FAILURE, RELATED].join("\n\n"),
      'required page opening H2 "Diagram" is missing or malformed',
      "## Invariants",
    ],
  ])("reports the first flow opening failure for %s", (_name, body, message, offending) => {
    const errors = validateStage4Artifact(flowPage(body), flowKeys, flowContext).errors;
    const openingErrors = errors.filter((error) => error.code === "missing_page_opening");
    expect(openingErrors).toHaveLength(1);
    expect(openingErrors[0]).toMatchObject({ message, offending, location: "body" });
  });

  it("wrong diagram placeholder vs expectedFlowDiagram → missing_page_opening naming the expected placeholder", () => {
    const body = [
      OPENING,
      PURPOSE,
      ORDERED,
      `## Diagram\n\n\`\`\`mermaid\n%% livewiki/diagrams/flow-other-run.mmd\n\`\`\``,
      INVARIANTS,
      FAILURE,
      RELATED,
    ].join("\n\n");
    const errors = validateStage4Artifact(flowPage(body), flowKeys, flowContext).errors;
    const openingErrors = errors.filter((e) => e.code === "missing_page_opening");
    expect(openingErrors).toHaveLength(1);
    expect(openingErrors[0]!.message).toBe(
      'page opening "Diagram" placeholder must be exactly "%% livewiki/diagrams/flow-batch-documentation-run.mmd"',
    );
    expect(openingErrors[0]!.offending).toBe("%% livewiki/diagrams/flow-other-run.mmd");
  });

  it("flow frontmatter without `modules:` → invalid_frontmatter", () => {
    const fm = `---
title: Batch documentation run
owner: generated
anchors:
  - src/cli.ts#run
  - src/core.ts#batch
---
`;
    const errors = validateStage4Artifact(flowPage(fullBody(), fm), flowKeys, flowContext).errors;
    const errs = errors.filter((e) => e.code === "invalid_frontmatter");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toMatch(/`modules:`/);
  });

  it("flow frontmatter with an empty `modules:` list → invalid_frontmatter", () => {
    const fm = `---
title: Batch documentation run
owner: generated
anchors:
  - src/cli.ts#run
  - src/core.ts#batch
modules:
---
`;
    const errors = validateStage4Artifact(flowPage(fullBody(), fm), flowKeys, flowContext).errors;
    const errs = errors.filter((e) => e.code === "invalid_frontmatter");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toMatch(/at least one participating module ID/);
  });

  it("flow frontmatter with a scalar `modules:` value → invalid_frontmatter", () => {
    const fm = `---
title: Batch documentation run
owner: generated
anchors:
  - src/cli.ts#run
  - src/core.ts#batch
modules: cli
---
`;
    const errors = validateStage4Artifact(flowPage(fullBody(), fm), flowKeys, flowContext).errors;
    const errs = errors.filter((e) => e.code === "invalid_frontmatter");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toMatch(/non-empty string list/);
  });

  it("flow `modules:` mismatch vs expectedFlowModules → invalid_frontmatter", () => {
    const errors = validateStage4Artifact(flowPage(fullBody()), flowKeys, {
      ...flowContext,
      expectedFlowModules: ["cli", "mcp"],
    }).errors;
    const errs = errors.filter((e) => e.code === "invalid_frontmatter");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toMatch(/must equal the candidate module set/);
  });

  it("flow `modules:` subset of expectedFlowModules → invalid_frontmatter", () => {
    const fm = `---
title: Batch documentation run
owner: generated
anchors:
  - src/cli.ts#run
  - src/core.ts#batch
modules:
  - cli
---
`;
    const errors = validateStage4Artifact(flowPage(fullBody(), fm), flowKeys, flowContext).errors;
    expect(errors.some((e) => e.code === "invalid_frontmatter")).toBe(true);
  });

  it("closed-key dual completeness: key missing from flow frontmatter → missing_closed_key tagged frontmatter", () => {
    const fm = `---
title: Batch documentation run
owner: generated
anchors:
  - src/cli.ts#run
modules:
  - cli
  - core
---
`;
    const errors = validateStage4Artifact(flowPage(fullBody(), fm), flowKeys, flowContext).errors;
    const fmMissing = errors.filter(
      (e) => e.code === "missing_closed_key" && e.location === "frontmatter",
    );
    expect(fmMissing.map((e) => e.offending)).toEqual(["src/core.ts#batch", "src/store.ts#persist"]);
    expect(
      errors.some((e) => e.code === "missing_closed_key" && e.location === "section"),
    ).toBe(false);
  });

  it("closed-key dual completeness: key missing from flow section markers → missing_closed_key tagged section", () => {
    const failureNoMarker = `## Failure and recovery

A failed task is marked and the run continues to the next task.`;
    const body = [OPENING, PURPOSE, ORDERED, DIAGRAM, INVARIANTS, failureNoMarker, RELATED].join("\n\n");
    const errors = validateStage4Artifact(flowPage(body), flowKeys, flowContext).errors;
    const sectionMissing = errors.filter(
      (e) => e.code === "missing_closed_key" && e.location === "section",
    );
    expect(sectionMissing.map((e) => e.offending)).toEqual(["src/store.ts#persist"]);
    expect(
      errors.some((e) => e.code === "missing_closed_key" && e.location === "frontmatter"),
    ).toBe(false);
  });

  it("invented key in flow frontmatter → anchor_outside_closed_list", () => {
    const fm = `---
title: Batch documentation run
owner: generated
anchors:
  - src/cli.ts#run
  - src/core.ts#batch
  - src/other.ts#nope
modules:
  - cli
  - core
---
`;
    const errors = validateStage4Artifact(flowPage(fullBody(), fm), flowKeys, flowContext).errors;
    expect(
      errors.some(
        (e) => e.code === "anchor_outside_closed_list" && e.offending === "src/other.ts#nope",
      ),
    ).toBe(true);
  });

  it("flow pages may cite a subset of the closed list (upper bound, not assignment)", () => {
    // The page cites the three keys its marker-carrying sections need (one
    // distinct key per required section, R10.1 D2); src/extra.ts#unused is
    // a closed-list key the page does not use — no missing_closed_key.
    const fm = `---
title: Batch documentation run
owner: generated
anchors:
  - src/cli.ts#run
  - src/core.ts#batch
  - src/store.ts#persist
modules:
  - cli
  - core
---
`;
    const closedWithUnused = [...flowKeys, "src/extra.ts#unused"];
    const errors = validateStage4Artifact(flowPage(fullBody(), fm), closedWithUnused, flowContext).errors;
    expect(errors.filter((e) => e.code === "missing_closed_key")).toEqual([]);
    expect(errors).toEqual([]);
  });

  // === R10.1 item D — marker placement and semantic-tier coverage ===

  it.each([
    [
      "Diagram",
      `## Diagram\n\n<!-- lw:anchors src/core.ts#batch -->\n\n\`\`\`mermaid\n%% livewiki/diagrams/flow-batch-documentation-run.mmd\n\`\`\``
    ],
    [
      "Invariants",
      `## Invariants\n\n<!-- lw:anchors src/core.ts#batch -->\n\n- Every page passes the validator before write.`
    ],
    [
      "Related pages",
      `## Related pages\n\n<!-- lw:anchors src/core.ts#batch -->\n\n- [CLI module](cli.md)`
    ],
  ])("marker inside %s → anchor_in_disallowed_section naming the section", (name, section) => {
    const orderedNoMarker = `## Ordered flow\n\n1. The CLI parses the invocation.\n2. The orchestrator documents each module.`;
    const body = [
      OPENING,
      PURPOSE,
      orderedNoMarker,
      name === "Diagram" ? section : DIAGRAM,
      name === "Invariants" ? section : INVARIANTS,
      FAILURE,
      name === "Related pages" ? section : RELATED,
    ].join("\n\n");
    const errors = validateStage4Artifact(flowPage(body), flowKeys, flowContext).errors;
    const disallowed = errors.filter((e) => e.code === "anchor_in_disallowed_section");
    expect(disallowed).toHaveLength(1);
    expect(disallowed[0]!.message).toContain(`"${name}"`);
    expect(disallowed[0]!.offending).toBe("<!-- lw:anchors src/core.ts#batch -->");
  });

  it("marker before the first H2 → anchor_in_disallowed_section (preamble)", () => {
    const preamble = `${OPENING}\n\n<!-- lw:anchors src/cli.ts#run -->`;
    const purposeNoMarker = `## Purpose\n\nA batch run starts from the CLI and produces accepted module pages.`;
    const body = [preamble, purposeNoMarker, ORDERED, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n");
    const errors = validateStage4Artifact(flowPage(body), flowKeys, flowContext).errors;
    const disallowed = errors.filter((e) => e.code === "anchor_in_disallowed_section");
    expect(disallowed).toHaveLength(1);
    expect(disallowed[0]!.message).toMatch(/before the first H2/);
    expect(disallowed[0]!.offending).toBe("<!-- lw:anchors src/cli.ts#run -->");
  });

  it("a marker inside an H3 descending from `## Ordered flow` is allowed and counts for D2", () => {
    const orderedH3 = `## Ordered flow\n\n1. The CLI parses the invocation.\n2. The orchestrator documents each module.\n\n### Step details\n\n<!-- lw:anchors src/core.ts#batch -->\n\nProse about the orchestration step.`;
    const body = [OPENING, PURPOSE, orderedH3, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n");
    const r = validateStage4Artifact(flowPage(body), flowKeys, flowContext);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it.each([
    [
      "Purpose",
      `## Purpose\n\nA batch run starts from the CLI and produces accepted module pages.`,
      "src/core.ts#batch src/store.ts#persist",
    ],
    [
      "Ordered flow",
      `## Ordered flow\n\n1. The CLI parses the invocation.\n2. The orchestrator documents each module.`,
      "src/cli.ts#run src/store.ts#persist",
    ],
    [
      "Failure and recovery",
      `## Failure and recovery\n\nA failed task is marked and the run continues to the next task.`,
      "src/cli.ts#run src/core.ts#batch",
    ],
  ])("required section %s without any marker → anchor_missing_in_required_section", (name, markerlessSection, cited) => {
    const citedKeys = (cited as string).split(" ");
    const fm = [
      "---",
      "title: Batch documentation run",
      "owner: generated",
      "anchors:",
      ...citedKeys.map((k) => `  - ${k}`),
      "modules:",
      "  - cli",
      "  - core",
      "---",
      "",
    ].join("\n");
    const body = [
      OPENING,
      name === "Purpose" ? markerlessSection : PURPOSE,
      name === "Ordered flow" ? markerlessSection : ORDERED,
      DIAGRAM,
      INVARIANTS,
      name === "Failure and recovery" ? markerlessSection : FAILURE,
      RELATED,
    ].join("\n\n");
    const errors = validateStage4Artifact(flowPage(body, fm), flowKeys, flowContext).errors;
    // The cited keys stay dual-consistent (no missing_closed_key): the
    // only defect is the named section carrying no marker.
    expect(errors.map((e) => e.code)).toEqual(["anchor_missing_in_required_section"]);
    expect(errors[0]!.message).toContain(`"${name}"`);
    expect(errors[0]!.offending).toBe(name);
  });

  const flowGroups = {
    entryKeys: ["src/cli.ts#run"],
    boundaryKeys: ["src/core.ts#batch"],
    sinkKeys: ["src/store.ts#persist"],
  } as const;

  it("a page citing ≥1 key from each non-empty group passes (tier coverage satisfied)", () => {
    const r = validateStage4Artifact(flowPage(fullBody()), flowKeys, {
      ...flowContext,
      flowKeyGroups: flowGroups,
    });
    expect(r.errors).toEqual([]);
  });

  it("a non-empty group left uncited → anchor_missing_required_tier naming the group", () => {
    // src/extra.ts#unused is the only sink key; the page cites the other three.
    const closedWithUnused = [...flowKeys, "src/extra.ts#unused"];
    const errors = validateStage4Artifact(flowPage(fullBody()), closedWithUnused, {
      ...flowContext,
      flowKeyGroups: { ...flowGroups, sinkKeys: ["src/extra.ts#unused"] },
    }).errors;
    expect(errors.map((e) => e.code)).toEqual(["anchor_missing_required_tier"]);
    expect(errors[0]!.message).toContain('"sink"');
    expect(errors[0]!.message).toContain("src/extra.ts#unused");
    expect(errors[0]!.offending).toBe("sink");
  });

  it("empty or closed-list-foreign groups are never required", () => {
    const r = validateStage4Artifact(flowPage(fullBody()), flowKeys, {
      ...flowContext,
      flowKeyGroups: {
        entryKeys: [],
        boundaryKeys: ["src/ghost.ts#nope"],
        sinkKeys: ["src/store.ts#persist"],
      },
    });
    expect(r.errors).toEqual([]);
  });

  it("absent groups leave the tier rule inert", () => {
    const r = validateStage4Artifact(flowPage(fullBody()), flowKeys, flowContext);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("a group key cited only in frontmatter does not count (dual citation rule)", () => {
    // src/core.ts#batch is in the frontmatter list but in no section marker:
    // not "cited" for the boundary group (and one-sided for the dual rule).
    const orderedNoMarker = `## Ordered flow\n\n1. The CLI parses the invocation.\n2. The orchestrator documents each module.`;
    const body = [OPENING, PURPOSE, orderedNoMarker, DIAGRAM, INVARIANTS, FAILURE, RELATED].join("\n\n");
    const errors = validateStage4Artifact(flowPage(body), flowKeys, {
      ...flowContext,
      flowKeyGroups: flowGroups,
    }).errors;
    const tiers = errors.filter((e) => e.code === "anchor_missing_required_tier");
    expect(tiers).toHaveLength(1);
    expect(tiers[0]!.message).toContain('"boundary"');
    expect(
      errors.some((e) => e.code === "missing_closed_key" && e.offending === "src/core.ts#batch"),
    ).toBe(true);
  });

  it("module pages are unaffected by the flow placement and tier rules", () => {
    const modulePage = [
      "---",
      "title: Some module",
      "owner: generated",
      "anchors:",
      "  - src/a.ts#a",
      "---",
      "",
      "# Some module",
      "",
      "This page documents the module's indexed responsibilities.",
      "",
      "## When to use this page",
      "",
      "- Review behavior.",
      "- Change behavior.",
      "",
      "## How it fits",
      "",
      "This module provides one part of the repository implementation.",
      "",
      "## Details",
      "",
      "<!-- lw:anchors src/a.ts#a -->",
      "",
      "Body.",
      "",
    ].join("\n");
    const r = validateStage4Artifact(modulePage, ["src/a.ts#a"], {
      moduleId: "mod",
      moduleRole: "product",
    });
    expect(r.errors).toEqual([]);
  });
});

// === Recovery tier (Component 2): relaxed validation contract ===
//
// The relaxed contract relaxes ONLY presentation: prose-vs-bullet shape
// and the required-section sets. Anchors, closed-list exactness,
// frontmatter identity, the diagram placeholder, marker placement, the
// TODO ban, empty_section, and tier coverage NEVER relax.

describe("artifact.validateStage4Artifact — relaxed module contract (Component 2)", () => {
  const keys = ["src/a.ts#a", "src/a.ts#b"];
  const FM = `---
title: Mod
owner: generated
anchors:
  - src/a.ts#a
  - src/a.ts#b
---
`;
  const ctx = (relaxed: boolean) => ({
    moduleId: "mod",
    moduleRole: "product" as const,
    ...(relaxed ? { relaxed: true } : {}),
  });
  /** Fails strict (1 bullet in When-to-use, bullets in How-it-fits); passes relaxed. */
  const RELAXED_MODULE = `${FM}
# Mod

This page documents the module responsibilities.

## When to use this page

- Review the module behavior.

## How it fits

- The module provides one part of the implementation.
- It collaborates with the neighboring modules.

## Details

<!-- lw:anchors src/a.ts#a src/a.ts#b -->

Body.
`;
  /** Fully strict-valid module page (2 bullets, prose How-it-fits). */
  const STRICT_MODULE = `${FM}
# Mod

This page documents the module responsibilities.

## When to use this page

- Review the module behavior.
- Change the module implementation.

## How it fits

The module provides one part of the implementation.

## Details

<!-- lw:anchors src/a.ts#a src/a.ts#b -->

Body.
`;

  it("module: bullets in How-it-fits and a 1-bullet task list pass relaxed, fail strict", () => {
    const strict = validateStage4Artifact(RELAXED_MODULE, keys, ctx(false));
    expect(strict.ok).toBe(false);
    expect(strict.errors.some((e) => e.code === "missing_page_opening")).toBe(true);
    const relaxed = validateStage4Artifact(RELAXED_MODULE, keys, ctx(true));
    expect(relaxed.errors).toEqual([]);
    expect(relaxed.ok).toBe(true);
  });

  it("module: a missing required H2 is still rejected under relaxed", () => {
    const noWhen = RELAXED_MODULE.replace("## When to use this page", "## Tasks renamed");
    const relaxed = validateStage4Artifact(noWhen, keys, ctx(true));
    expect(relaxed.ok).toBe(false);
    expect(relaxed.errors.some((e) => e.code === "missing_page_opening")).toBe(true);
  });

  it("module: an anchor outside the closed list is still rejected under relaxed", () => {
    const bad = RELAXED_MODULE.replace("src/a.ts#b -->", "src/a.ts#b src/a.ts#UNKNOWN -->");
    const relaxed = validateStage4Artifact(bad, keys, ctx(true));
    expect(relaxed.ok).toBe(false);
    expect(relaxed.errors.some((e) => e.code === "anchor_outside_closed_list")).toBe(true);
  });

  it("markDegradedArtifact inserts the frontmatter flag and the notice as the first body line", () => {
    const marked = markDegradedArtifact(STRICT_MODULE);
    expect(marked).toContain("quality: degraded\n---");
    const bodyStart = marked.indexOf("\n---\n") + "\n---\n".length;
    expect(marked.slice(bodyStart).startsWith(`\n${buildDegradedNotice("Mod")}\n\n# Mod\n`)).toBe(true);
    // Idempotent: a second marking changes nothing.
    expect(markDegradedArtifact(marked)).toBe(marked);
    // No frontmatter block → unchanged (validation rejects it regardless).
    expect(markDegradedArtifact("# no frontmatter\n")).toBe("# no frontmatter\n");
  });

  it("parametrizes the degraded notice per page title (round-5 re-eval fix (a))", () => {
    const other = STRICT_MODULE.replace("# Mod\n", "# Session\n");
    const markedA = markDegradedArtifact(STRICT_MODULE);
    const markedB = markDegradedArtifact(other);
    // Two degraded pages never share a verbatim notice paragraph.
    expect(markedA).toContain(buildDegradedNotice("Mod"));
    expect(markedB).toContain(buildDegradedNotice("Session"));
    expect(buildDegradedNotice("Mod")).not.toBe(buildDegradedNotice("Session"));
    // Relaxed validation still tolerates each page's own notice line.
    expect(validateStage4Artifact(markedB, keys, ctx(true)).ok).toBe(true);
    // Without an H1 the notice falls back to the frontmatter title.
    const noH1 = STRICT_MODULE.replace("# Mod\n\n", "");
    expect(markDegradedArtifact(noH1)).toContain(buildDegradedNotice("Mod"));
  });

  it("the degraded notice before the H1 is tolerated under relaxed only", () => {
    const marked = markDegradedArtifact(STRICT_MODULE);
    const strict = validateStage4Artifact(marked, keys, ctx(false));
    expect(strict.ok).toBe(false);
    expect(
      strict.errors.some(
        (e) => e.code === "missing_page_opening" && e.message.includes("H1 appears after other content"),
      ),
    ).toBe(true);
    const relaxed = validateStage4Artifact(marked, keys, ctx(true));
    expect(relaxed.errors).toEqual([]);
    expect(relaxed.ok).toBe(true);
  });
});

describe("artifact.validateStage4Artifact — relaxed flow contract (Component 2)", () => {
  const flowKeys = ["src/cli.ts#run", "src/core.ts#batch", "src/store.ts#persist"];
  const FM = `---
title: Batch documentation run
owner: generated
anchors:
  - src/cli.ts#run
  - src/core.ts#batch
  - src/store.ts#persist
modules:
  - cli
  - core
---
`;
  const ctx = (relaxed: boolean) => ({
    moduleId: "batch-documentation-run",
    moduleRole: "product" as const,
    pageKind: "flow" as const,
    expectedFlowDiagram: "livewiki/diagrams/flow-batch-documentation-run.mmd",
    expectedFlowModules: ["core", "cli"],
    ...(relaxed ? { relaxed: true } : {}),
  });
  /**
   * Reduced-section relaxed page: Purpose as bullets, no Invariants, no
   * Failure and recovery. Every cited key is dual-cited (frontmatter AND
   * one marker) and markers live in allowed sections only.
   */
  const RELAXED_FLOW = `${FM}
# Batch documentation run

This page explains how a batch run documents the repository end to end.

## Purpose

<!-- lw:anchors src/cli.ts#run -->

- A batch run starts from the CLI and produces accepted module pages.

## Ordered flow

<!-- lw:anchors src/core.ts#batch src/store.ts#persist -->

1. The CLI parses the invocation.
2. The orchestrator documents each module.

## Diagram

\`\`\`mermaid
%% livewiki/diagrams/flow-batch-documentation-run.mmd
\`\`\`

## Related pages

- [CLI module](cli.md)
- [Core module](core.md)
`;

  it("flow: bullets in Purpose and the reduced section set pass relaxed, fail strict", () => {
    const strict = validateStage4Artifact(RELAXED_FLOW, flowKeys, ctx(false));
    expect(strict.ok).toBe(false);
    expect(strict.errors.some((e) => e.code === "missing_page_opening")).toBe(true);
    const relaxed = validateStage4Artifact(RELAXED_FLOW, flowKeys, ctx(true));
    expect(relaxed.errors).toEqual([]);
    expect(relaxed.ok).toBe(true);
  });

  it("flow: the Diagram placeholder stays strict under relaxed", () => {
    const noDiagram = RELAXED_FLOW.replace("## Diagram", "## Skipped diagram");
    const relaxed = validateStage4Artifact(noDiagram, flowKeys, ctx(true));
    expect(relaxed.ok).toBe(false);
    expect(relaxed.errors.some((e) => e.code === "missing_page_opening")).toBe(true);
  });

  it("flow: marker placement stays strict under relaxed (disallowed section)", () => {
    const moved = RELAXED_FLOW.replace(
      "## Related pages\n\n- [CLI module](cli.md)",
      "## Related pages\n\n<!-- lw:anchors src/store.ts#persist -->\n\n- [CLI module](cli.md)",
    ).replace(" src/store.ts#persist -->", " -->");
    const relaxed = validateStage4Artifact(moved, flowKeys, ctx(true));
    expect(relaxed.ok).toBe(false);
    expect(relaxed.errors.some((e) => e.code === "anchor_in_disallowed_section")).toBe(true);
  });

  it("flow: Related pages stays required under relaxed", () => {
    const noRelated = RELAXED_FLOW.replace("## Related pages", "## elsewhere");
    const relaxed = validateStage4Artifact(noRelated, flowKeys, ctx(true));
    expect(relaxed.ok).toBe(false);
    expect(relaxed.errors.some((e) => e.code === "missing_page_opening")).toBe(true);
  });
});

describe("artifact.validateStage4Artifact — relaxed topic contract (Component 2)", () => {
  const topicKeys = ["src/a.ts#a", "src/a.ts#b"];
  const FM = `---
title: My Topic
owner: generated
kind: topic
order: 1
intent: Explain the topic.
modules:
  - mod-a
flows: []
anchors:
  - src/a.ts#a
  - src/a.ts#b
---
`;
  const ctx = (relaxed: boolean) => ({
    moduleId: "my-topic",
    moduleRole: "product" as const,
    pageKind: "topic" as const,
    expectedTopicTitle: "My Topic",
    expectedTopicOrder: 1,
    expectedTopicIntent: "Explain the topic.",
    expectedTopicModules: ["mod-a"],
    expectedTopicFlows: [],
    ...(relaxed ? { relaxed: true } : {}),
  });
  /** Reduced-section relaxed topic: bullets everywhere, only the three required H2s. */
  const RELAXED_TOPIC = `${FM}
# My Topic

- The reader problem in bullet form.

## Purpose

<!-- lw:anchors src/a.ts#a -->

- Bulleted purpose grounded in the evidence.

## Behavioral contract

<!-- lw:anchors src/a.ts#b -->

- Bulleted contract grounded in the evidence.

## Related pages

- [Topics hub](index.md)
- [mod-a module](../mod-a/index.md)
`;

  it("topic: the reduced section set with bullets passes relaxed, fails strict", () => {
    const strict = validateStage4Artifact(RELAXED_TOPIC, topicKeys, ctx(false));
    expect(strict.ok).toBe(false);
    expect(strict.errors.some((e) => e.code === "missing_page_opening")).toBe(true);
    const relaxed = validateStage4Artifact(RELAXED_TOPIC, topicKeys, ctx(true));
    expect(relaxed.errors).toEqual([]);
    expect(relaxed.ok).toBe(true);
  });

  it("topic: Behavioral contract stays required under relaxed", () => {
    const noContract = RELAXED_TOPIC.replace("## Behavioral contract", "## Agreement");
    const relaxed = validateStage4Artifact(noContract, topicKeys, ctx(true));
    expect(relaxed.ok).toBe(false);
    expect(relaxed.errors.some((e) => e.code === "missing_page_opening")).toBe(true);
  });

  it("topic: frontmatter identity stays strict under relaxed", () => {
    const wrongTitle = RELAXED_TOPIC.replace("# My Topic", "# Another Title");
    const relaxed = validateStage4Artifact(wrongTitle, topicKeys, ctx(true));
    expect(relaxed.ok).toBe(false);
    expect(relaxed.errors.some((e) => e.code === "missing_page_opening")).toBe(true);
  });
});

describe("artifact.validateStage4Artifact — topic source-link citations (D2 follow-up)", () => {
  // MPTP measurement run (2026-07-27): 18 citations written as Markdown
  // links to source paths (`[sym](app/services/bgm.py#sym)`) passed the
  // topic validator AND verify (which only checks .md/.mmd targets) but do
  // not resolve for readers.
  const topicKeys = ["src/a.ts#a", "src/a.ts#b", "src/a.ts#c", "src/a.ts#d", "src/a.ts#e"];
  const FM = `---
title: My Topic
owner: generated
kind: topic
order: 1
intent: Explain the topic.
modules:
  - mod-a
flows: []
anchors:
  - src/a.ts#a
  - src/a.ts#b
  - src/a.ts#c
  - src/a.ts#d
  - src/a.ts#e
---
`;
  const ctx = {
    moduleId: "my-topic",
    moduleRole: "product" as const,
    pageKind: "topic" as const,
    expectedTopicTitle: "My Topic",
    expectedTopicOrder: 1,
    expectedTopicIntent: "Explain the topic.",
    expectedTopicModules: ["mod-a"],
    expectedTopicFlows: [],
  };
  const topicPage = (purposeProse: string) => `${FM}
# My Topic

The reader needs the topic contract in one place.

## Purpose

<!-- lw:anchors src/a.ts#a -->

${purposeProse}

## When to use this page

<!-- lw:anchors src/a.ts#b -->

Read this when changing the coordinated behavior.

## Behavioral contract

<!-- lw:anchors src/a.ts#c -->

The behavioral contract grounded in the cited evidence.

## Failure and recovery

<!-- lw:anchors src/a.ts#d -->

The excerpt shows no retry path; the flow fails open.

## Change map

<!-- lw:anchors src/a.ts#e -->

Change requires updating the cited symbol and its module page.

## Related pages

- [Topics hub](index.md)
- [mod-a module](../mod-a/index.md)
`;

  it("flags a Markdown link to a source path as topic_source_link", () => {
    const page = topicPage(
      "The uploader [`save_bgm_upload`](app/services/bgm.py#save_bgm_upload) stages the stream into a temp file.",
    );
    const result = validateStage4Artifact(page, topicKeys, ctx);
    expect(result.ok).toBe(false);
    const error = result.errors.find((e) => e.code === "topic_source_link");
    expect(error).toBeDefined();
    expect(error!.offending).toBe("app/services/bgm.py#save_bgm_upload");
  });

  it("flags a source-path link even without a #fragment", () => {
    const page = topicPage("The service is configured in [the compose file](docker-compose.yml).");
    const result = validateStage4Artifact(page, topicKeys, ctx);
    expect(result.errors.some((e) => e.code === "topic_source_link")).toBe(true);
  });

  it("accepts the inline-code closed-list key citation form", () => {
    const page = topicPage(
      "The uploader `app/services/bgm.py#save_bgm_upload` stages the stream into a temp file.",
    );
    const result = validateStage4Artifact(page, topicKeys, ctx);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts wiki-artifact and external links in prose", () => {
    const page = topicPage(
      "See [the module page](../mod-a/index.md), [the diagram](../diagrams/flow-x.mmd), and [the upstream docs](https://example.com/docs).",
    );
    const result = validateStage4Artifact(page, topicKeys, ctx);
    expect(result.errors.some((e) => e.code === "topic_source_link")).toBe(false);
  });
});

describe("model_invented_manual diagnostics (2026-08-12)", () => {
  it("reports every occurrence with count and body line numbers, fences included", () => {
    // The detector stays raw on purpose: the manual-block preservation
    // extractor is not fence-aware, so a fenced marker would otherwise
    // become immortal "human" content (rule #6). The diagnostic must count
    // fenced occurrences too — a boolean error trapped the repair loop
    // when a page carried several markers.
    const art = [
      "---",
      "title: x",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#login",
      "---",
      "",
      "# x",
      "",
      "Intro mentions <!-- lw:manual --> inline.",
      "",
      "```markdown",
      "<!-- lw:manual -->",
      "note",
      "<!-- /lw:manual -->",
      "```",
      "",
      "## Details",
      "",
      "<!-- lw:anchors src/auth.ts#login -->",
      "",
      "Prose about login.",
      "",
    ].join("\n");
    const r = validateStage4Artifact(art, ["src/auth.ts#login"]);
    expect(r.ok).toBe(false);
    const manual = r.errors.filter((e) => e.code === "model_invented_manual");
    // ONE structured error carrying the full occurrence list (not N errors).
    expect(manual).toHaveLength(1);
    expect(manual[0]?.offending).toBe("<!-- lw:manual -->");
    expect(manual[0]?.message).toContain("2 <!-- lw:manual --> marker occurrence(s) at body line(s)");
  });
});
