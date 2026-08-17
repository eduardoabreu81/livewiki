import { describe, it, expect } from "vitest";
import { extractAnchors, slugify } from "./anchors.js";

describe("slugify", () => {
  it("lowercase + hyphens + no accents", () => {
    expect(slugify("Fluxo de validação")).toBe("fluxo-de-validacao");
  });

  it("removes punctuation", () => {
    expect(slugify("Auth — login & sessão")).toBe("auth-login-sessao");
  });

  it("collapses multiple spaces", () => {
    expect(slugify("a   b  c")).toBe("a-b-c");
  });

  it("remove leading/trailing whitespace", () => {
    expect(slugify("  foo  ")).toBe("foo");
  });

  it("preserves digits", () => {
    expect(slugify("Step 1: init")).toBe("step-1-init");
  });
});

describe("extractAnchors", () => {
  it("page without frontmatter: empty", () => {
    const r = extractAnchors("# Apenas um título\n\nbody");
    expect(r.pageAnchors).toEqual([]);
    expect(r.sectionAnchors).toEqual([]);
    expect(r.manualBlocks).toEqual([]);
    expect(r.owner).toBe("generated");
  });

  it("page with frontmatter: extracts pageAnchors and owner", () => {
    const src = `---
title: Auth
owner: human
anchors:
  - src/auth/login.ts
  - src/auth/login.ts#validateToken
---

## Fluxo

texto`;
    const r = extractAnchors(src);
    expect(r.pageAnchors).toEqual([
      "src/auth/login.ts",
      "src/auth/login.ts#validateToken",
    ]);
    expect(r.owner).toBe("human");
  });

  it("extracts section anchors from <!-- lw:anchors ... --> after a heading", () => {
    const src = `---
title: Auth
---

## Fluxo de validação
<!-- lw:anchors src/auth/login.ts#validateToken src/auth/session.ts#refresh -->
O token é validado...

## Refresh
<!-- lw:anchors src/auth/login.ts#refresh -->
Descrição do refresh.
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors.length).toBe(2);

    const fluxo = r.sectionAnchors[0]!;
    expect(fluxo.headingText).toBe("Fluxo de validação");
    expect(fluxo.sectionSlug).toBe("fluxo-de-validacao");
    expect(fluxo.symbolKeys).toEqual([
      "src/auth/login.ts#validateToken",
      "src/auth/session.ts#refresh",
    ]);
    expect(fluxo.inManualBlock).toBe(false);

    const refresh = r.sectionAnchors[1]!;
    expect(refresh.headingText).toBe("Refresh");
    expect(refresh.sectionSlug).toBe("refresh");
  });

  it("sectionSlug is unique per heading (deduplication by slug)", () => {
    // SPEC §"Anchor granularity: per section vs per page" — Phase 2
    // implements both. If two sections have the same heading text, the slug is equal.
    // That is not a problem — the DB has (wiki_path, section_slug) UNIQUE.
    const src = `---
title: T
---

## Foo
<!-- lw:anchors a#x -->

## Foo
<!-- lw:anchors b#y -->
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors.length).toBe(2);
    expect(r.sectionAnchors[0]!.sectionSlug).toBe("foo");
    expect(r.sectionAnchors[1]!.sectionSlug).toBe("foo");
  });

  it("extracts manual blocks with correct start/end", () => {
    const src = `---
title: T
---

## Notas
<!-- lw:manual -->
Texto que o agente NÃO pode reescrever.
<!-- /lw:manual -->

Mais texto normal.
`;
    const r = extractAnchors(src);
    expect(r.manualBlocks.length).toBe(1);
    expect(src.slice(r.manualBlocks[0]!.start)).toMatch(/<!-- lw:manual -->/);
    expect(src.slice(r.manualBlocks[0]!.end)).toMatch(/<!-- \/lw:manual -->/);
  });

  it("section anchor inside a manual block is flagged with inManualBlock=true", () => {
    const src = `---
title: T
---

## Notas manuais
<!-- lw:manual -->
<!-- lw:anchors src/x.ts#y -->
Texto manual.
<!-- /lw:manual -->
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors.length).toBe(1);
    expect(r.sectionAnchors[0]!.inManualBlock).toBe(true);
  });

  it("section anchor OUTSIDE a manual block has inManualBlock=false", () => {
    const src = `---
title: T
---

## Normal
<!-- lw:anchors src/x.ts#y -->
Texto.

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/x.ts#z -->
<!-- /lw:manual -->
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors.length).toBe(2);
    expect(r.sectionAnchors[0]!.inManualBlock).toBe(false);
    expect(r.sectionAnchors[1]!.inManualBlock).toBe(true);
  });

  it("anchor with no preceding heading is ignored (malformed page)", () => {
    const src = `---
title: T
---

<!-- lw:anchors src/x.ts#y -->
Texto sem heading.
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors).toEqual([]);
  });

  it("multiple manual blocks: each one becomes a separate entry", () => {
    const src = `---
title: T
---

## A
<!-- lw:manual -->
A1
<!-- /lw:manual -->

## B
<!-- lw:manual -->
B1
<!-- /lw:manual -->
`;
    const r = extractAnchors(src);
    expect(r.manualBlocks.length).toBe(2);
  });

  it("malformed manual block (end without start) is ignored", () => {
    const src = `---
title: T
---

Texto.
<!-- /lw:manual -->
`;
    const r = extractAnchors(src);
    expect(r.manualBlocks).toEqual([]);
  });

  it("headings of different levels (## and ###) both extracted", () => {
    const src = `---
title: T
---

## Top
<!-- lw:anchors a#x -->

### Sub
<!-- lw:anchors a#y -->
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors.length).toBe(2);
    expect(r.sectionAnchors[0]!.sectionSlug).toBe("top");
    expect(r.sectionAnchors[1]!.sectionSlug).toBe("sub");
  });

  it("anchor with multiple spaces between keys is parsed correctly", () => {
    const src = `---
title: T
---

## H
<!-- lw:anchors   a#x    b#y   c#z -->
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors[0]!.symbolKeys).toEqual(["a#x", "b#y", "c#z"]);
  });

  it("anchor with a single key and extra spaces does not include an empty string", () => {
    const src = `---
title: T
---

## H
<!-- lw:anchors only#one -->
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors[0]!.symbolKeys).toEqual(["only#one"]);
  });

  it("ignores fenced markers and fenced headings while preserving a real marker offset", () => {
    const fencedMarker = "<!-- lw:anchors fake#ellipsis ... real#key -->";
    const realMarker = "<!-- lw:anchors real#key -->";
    const src = `---
title: Fence-aware anchors
anchors:
  - real#key
---

## Real heading

\`\`\`markdown
## Fake fenced heading
${fencedMarker}
\`\`\`

${realMarker}
Real prose.
`;

    const result = extractAnchors(src);

    expect(result.sectionAnchors).toHaveLength(1);
    expect(result.sectionAnchors[0]?.symbolKeys).toEqual(["real#key"]);
    expect(result.sectionAnchors[0]?.headingText).toBe("Real heading");
    expect(result.sectionAnchors[0]?.sectionSlug).toBe("real-heading");
    expect(result.sectionAnchors[0]?.anchorMarkerOffset).toBe(src.indexOf(realMarker));
  });

  it("ignores an inline-code marker example", () => {
    const realMarker = "<!-- lw:anchors real#key -->";
    const src = `---
title: Inline example
---

## Real heading
The syntax \`<!-- lw:anchors fake#key -->\` is display text.

${realMarker}
Real prose.
`;

    const result = extractAnchors(src);

    expect(result.sectionAnchors).toHaveLength(1);
    expect(result.sectionAnchors[0]?.symbolKeys).toEqual(["real#key"]);
    expect(result.sectionAnchors[0]?.anchorMarkerOffset).toBe(src.indexOf(realMarker));
  });
});
