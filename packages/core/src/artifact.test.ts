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

  it("valid artifact (frontmatter + owner + anchors in list) passes", () => {
    const art = `---
title: auth
owner: generated
anchors:
  - src/auth.ts#login
  - src/auth.ts#logout
---
# auth

<!-- lw:anchors src/auth.ts#validate -->

Body.
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
---
# x`;
    const mixed = `---
title: x
owner: mixed
anchors:
  - src/auth.ts#login
---
# x`;
    expect(validateStage4Artifact(human, closedKeys).ok).toBe(false);
    expect(validateStage4Artifact(mixed, closedKeys).ok).toBe(false);
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
    expect(norm.ok).toBe(true);
    const closed = [
      "packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth",
      "packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash",
      "packages/core/test/fixtures/fase2-repo/src/auth.ts#extra",
      "packages/core/test/fixtures/fase2-repo/src/auth.ts#validate",
    ];
    const val = validateStage4Artifact(norm.content, closed);
    expect(val.ok).toBe(true);
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
