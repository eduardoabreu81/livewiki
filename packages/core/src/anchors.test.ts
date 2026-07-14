import { describe, it, expect } from "vitest";
import { extractAnchors, slugify } from "./anchors.js";

describe("slugify", () => {
  it("lowercase + hífens + sem acentos", () => {
    expect(slugify("Fluxo de validação")).toBe("fluxo-de-validacao");
  });

  it("remove pontuação", () => {
    expect(slugify("Auth — login & sessão")).toBe("auth-login-sessao");
  });

  it("colapsa múltiplos espaços", () => {
    expect(slugify("a   b  c")).toBe("a-b-c");
  });

  it("remove leading/trailing whitespace", () => {
    expect(slugify("  foo  ")).toBe("foo");
  });

  it("preserva dígitos", () => {
    expect(slugify("Step 1: init")).toBe("step-1-init");
  });
});

describe("extractAnchors", () => {
  it("página sem frontmatter: vazio", () => {
    const r = extractAnchors("# Apenas um título\n\nbody");
    expect(r.pageAnchors).toEqual([]);
    expect(r.sectionAnchors).toEqual([]);
    expect(r.manualBlocks).toEqual([]);
    expect(r.owner).toBe("generated");
  });

  it("página com frontmatter: extrai pageAnchors e owner", () => {
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

  it("extrai section anchors de <!-- lw:anchors ... --> após heading", () => {
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

  it("sectionSlug é único por heading (deduplicação por slug)", () => {
    // SPEC §"Granularidade de âncora por seção vs por página" — Fase 2
    // implementa ambas. Se duas seções têm mesmo heading text, slug é igual.
    // Não há problema — DB tem (wiki_path, section_slug) UNIQUE.
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

  it("extrai manual blocks com start/end corretos", () => {
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

  it("section anchor dentro de manual block é flagada com inManualBlock=true", () => {
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

  it("section anchor FORA de manual block tem inManualBlock=false", () => {
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

  it("anchor sem heading anterior é ignorado (página malformada)", () => {
    const src = `---
title: T
---

<!-- lw:anchors src/x.ts#y -->
Texto sem heading.
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors).toEqual([]);
  });

  it("múltiplos manual blocks: cada um vira um entry separado", () => {
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

  it("manual block malformado (end sem start) é ignorado", () => {
    const src = `---
title: T
---

Texto.
<!-- /lw:manual -->
`;
    const r = extractAnchors(src);
    expect(r.manualBlocks).toEqual([]);
  });

  it("heading de níveis diferentes (## e ###) ambos extraídos", () => {
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

  it("anchor com múltiplos espaços entre keys é parseado corretamente", () => {
    const src = `---
title: T
---

## H
<!-- lw:anchors   a#x    b#y   c#z -->
`;
    const r = extractAnchors(src);
    expect(r.sectionAnchors[0]!.symbolKeys).toEqual(["a#x", "b#y", "c#z"]);
  });

  it("anchor com single key e espaços extras não inclui string vazia", () => {
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
