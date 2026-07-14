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
      expect(r.errors.some((e) => e.code === "empty_section")).toBe(true);
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
      expect(r.errors.some((e) => e.code === "unclosed_markdown")).toBe(true);
    });

    it("unclosed inline code span (cut mid-token, the tools.md finding) → unclosed_markdown", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Run with \`node acceptance-analysis.mjs <artifactRoot
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.code === "unclosed_markdown")).toBe(true);
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

    it("plain prose without TODO/TBD → not flagged", () => {
      const art = fullArt(`# x

<!-- lw:anchors src/auth.ts#login src/auth.ts#logout src/auth.ts#validate -->

Everything here is fully described, nothing pending.
`);
      const r = validateStage4Artifact(art, closedKeys);
      expect(r.errors.some((e) => e.code === "todo_marker_present")).toBe(false);
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
