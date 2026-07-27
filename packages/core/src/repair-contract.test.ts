import { describe, it, expect } from "vitest";
import {
  ALL_ARTIFACT_VALIDATION_CODES,
  PAGE_KINDS,
  SUPPORTED_FIXES,
  UNCLASSIFIED,
  collectUnclassified,
  formatUnrepairableMessage,
  isUnrepairableErrorSet,
  renderActionDirective,
  renderReportOnlyBlock,
  type PageKind,
} from "./repair-contract.js";
import {
  MECHANICAL_STAGE4_CODES,
  MECHANICAL_UPPER_BOUND_CODES,
} from "./artifact-repair.js";
import type { ArtifactValidationError } from "./prompts.js";

function err(
  code: ArtifactValidationError["code"],
  extra?: Partial<ArtifactValidationError>,
): ArtifactValidationError {
  return {
    code,
    message: `message for ${code}`,
    location: "body",
    ...extra,
  };
}

describe("repair-contract — exhaustiveness (the closed contract)", () => {
  it("every ArtifactValidationCode appears, per page kind, in EXACTLY ONE of SUPPORTED_FIXES / UNCLASSIFIED", () => {
    // No duplicates inside the runtime mirror of the union.
    expect(new Set(ALL_ARTIFACT_VALIDATION_CODES).size).toBe(
      ALL_ARTIFACT_VALIDATION_CODES.length,
    );
    for (const kind of PAGE_KINDS) {
      for (const code of ALL_ARTIFACT_VALIDATION_CODES) {
        const hasDirective = SUPPORTED_FIXES[kind][code] !== undefined;
        const hasReason = UNCLASSIFIED[kind][code] !== undefined;
        expect(
          hasDirective !== hasReason,
          `${kind}/${code}: must be in exactly one of SUPPORTED_FIXES/UNCLASSIFIED (directive=${hasDirective}, unclassified=${hasReason})`,
        ).toBe(true);
      }
    }
  });

  it("every UNCLASSIFIED entry carries a non-empty one-line reason", () => {
    for (const kind of PAGE_KINDS) {
      for (const [code, reason] of Object.entries(UNCLASSIFIED[kind])) {
        expect(typeof reason, `${kind}/${code}`).toBe("string");
        expect(reason!.length, `${kind}/${code}`).toBeGreaterThan(0);
        expect(reason, `${kind}/${code}: reason must be one line`).not.toContain("\n");
      }
    }
  });

  it("no stray keys: maps only contain known codes", () => {
    const known = new Set<string>(ALL_ARTIFACT_VALIDATION_CODES);
    for (const kind of PAGE_KINDS) {
      for (const code of Object.keys(SUPPORTED_FIXES[kind])) {
        expect(known.has(code), `${kind}/${code}`).toBe(true);
      }
      for (const code of Object.keys(UNCLASSIFIED[kind])) {
        expect(known.has(code), `${kind}/${code}`).toBe(true);
      }
    }
  });

  it("mechanically-repairable codes always have a prompt directive (one list, no drift)", () => {
    for (const code of MECHANICAL_STAGE4_CODES) {
      expect(
        SUPPORTED_FIXES.module[code],
        `module/${code} is mechanically repairable and must carry a directive`,
      ).toBeDefined();
    }
    for (const code of MECHANICAL_UPPER_BOUND_CODES) {
      for (const kind of ["flow", "topic"] as const) {
        expect(
          SUPPORTED_FIXES[kind][code],
          `${kind}/${code} is mechanically repairable and must carry a directive`,
        ).toBeDefined();
      }
    }
  });

  it("manual_block_altered is unclassified for every kind (rule #6 — human content is never model-repaired)", () => {
    for (const kind of PAGE_KINDS) {
      expect(SUPPORTED_FIXES[kind].manual_block_altered).toBeUndefined();
      expect(UNCLASSIFIED[kind].manual_block_altered).toContain("rule #6");
    }
  });
});

describe("repair-contract — directive rendering (behavioral parity with the historical if-chains)", () => {
  it("topic topic_source_link: names the offending link and the inline-code fix; empty without an offending target", () => {
    const text = renderActionDirective(
      "topic",
      err("topic_source_link", { offending: "app/services/bgm.py#save_bgm_upload" }),
      { messageSafe: "m", offendingSafe: "app/services/bgm.py#save_bgm_upload" },
    );
    expect(text).toContain("app/services/bgm.py#save_bgm_upload");
    expect(text).toContain("inline code");
    expect(
      renderActionDirective("topic", err("topic_source_link"), { messageSafe: "m" }),
    ).toBe("");
  });

  it("module anchor_outside_closed_list: ellipsis variant and plain removal, verbatim", () => {
    const ellipsis = renderActionDirective(
      "module",
      err("anchor_outside_closed_list", { offending: "…", location: "section", sectionSlug: "details" }),
      { messageSafe: "m", offendingSafe: "…" },
    );
    expect(ellipsis).toBe(
      'The `lw:anchors` marker was abbreviated with "…". REMOVE the ellipsis and rewrite that marker with every key for that section written in full, one by one, copied byte-for-byte from the closed list. NEVER substitute another key for the ellipsis or add an arbitrary key.',
    );
    const plain = renderActionDirective(
      "module",
      err("anchor_outside_closed_list", { offending: "src/x.ts#fake", location: "frontmatter" }),
      { messageSafe: "m", offendingSafe: "src/x.ts#fake" },
    );
    expect(plain).toBe(
      'REMOVE this invalid anchor "src/x.ts#fake" entirely. Do NOT replace it with another key.',
    );
  });

  it("module anchor_outside_closed_list renders NO action without an offending key (parity)", () => {
    expect(
      renderActionDirective("module", err("anchor_outside_closed_list"), { messageSafe: "m" }),
    ).toBe("");
  });

  it("module duplicate_anchor: section / frontmatter / generic variants with the aggregate-marker suffix, verbatim", () => {
    const section = renderActionDirective(
      "module",
      err("duplicate_anchor", { offending: "k", location: "section", sectionSlug: "details" }),
      { messageSafe: "m", offendingSafe: "k" },
    );
    expect(section).toBe(
      'DELETE this exact key "k" from the `lw:anchors` marker in section "details". It already appears in its proper marker elsewhere; KEEP that proper occurrence and do not move or add this key anywhere else.' +
        " If the page has an aggregate or summary `lw:anchors` marker duplicating per-section keys, DELETE that aggregate marker entirely.",
    );
    const fm = renderActionDirective(
      "module",
      err("duplicate_anchor", { offending: "k", location: "frontmatter" }),
      { messageSafe: "m", offendingSafe: "k" },
    );
    expect(fm).toBe(
      'DELETE the extra list entry for this exact key "k" from the frontmatter anchors list and keep EXACTLY ONE list entry.' +
        " If the page has an aggregate or summary `lw:anchors` marker duplicating per-section keys, DELETE that aggregate marker entirely.",
    );
  });

  it("flow duplicate_anchor: no aggregate-marker suffix (parity with the stage-5 if-chain)", () => {
    const fm = renderActionDirective(
      "flow",
      err("duplicate_anchor", { offending: "k", location: "frontmatter" }),
      { messageSafe: "m", offendingSafe: "k" },
    );
    expect(fm).toBe(
      'DELETE the extra list entry for this exact key "k" from the frontmatter anchors list and keep EXACTLY ONE list entry.',
    );
  });

  it("module missing_page_opening uses the neutralized message as SPECIFIC FAILURE", () => {
    const action = renderActionDirective(
      "module",
      err("missing_page_opening"),
      { messageSafe: "opening is absent" },
    );
    expect(action).toContain("SPECIFIC FAILURE: opening is absent. Replace the opening after frontmatter with the complete required H1");
  });

  it("flow missing_page_opening carries the flow opening contract (verbatim)", () => {
    const action = renderActionDirective(
      "flow",
      err("missing_page_opening"),
      { messageSafe: "bad opening" },
    );
    expect(action).toContain("SPECIFIC FAILURE: bad opening. Replace the opening after frontmatter with the complete required flow opening");
    expect(action).toContain("`Purpose`, `Ordered flow` (numbered list), `Invariants`, `Failure and recovery`, `Related pages`");
  });

  it("flow missing_page_opening with a section-level prose failure gets a targeted section directive (Etapa 3 run #3)", () => {
    const action = renderActionDirective(
      "flow",
      err("missing_page_opening"),
      { messageSafe: 'page opening "Failure and recovery" must contain one or more prose paragraphs' },
    );
    expect(action).toContain("section-content failure, not a page-structure one");
    expect(action).toContain("`Failure and recovery` H2 heading");
    expect(action).toContain("no bullet lists");
    // The page-structure rewrite text must NOT be offered for this shape.
    expect(action).not.toContain("Replace the opening after frontmatter");
  });

  it("flow missing_page_opening section directive allows bullets only for Invariants", () => {
    const action = renderActionDirective(
      "flow",
      err("missing_page_opening"),
      { messageSafe: 'page opening "Invariants" must contain prose or bullets' },
    );
    expect(action).toContain("`Invariants` H2 heading");
    expect(action).toContain("prose paragraphs or bullets");
    expect(action).not.toContain("no bullet lists");
  });

  it("topic missing_page_opening mirrors the topic opening contract", () => {
    const action = renderActionDirective(
      "topic",
      err("missing_page_opening"),
      { messageSafe: "bad opening" },
    );
    expect(action).toContain("SPECIFIC FAILURE: bad opening. Rewrite the opening to match the topic contract");
    expect(action).toContain("`Purpose`, `When to use this page`, `Behavioral contract`, `Failure and recovery`, `Change map`, `Related pages`");
  });

  it("topic duplicate_anchor prefers the deterministic assigned section when the map resolves", () => {
    const withMap = renderActionDirective(
      "topic",
      err("duplicate_anchor", { offending: "k" }),
      { messageSafe: "m", offendingSafe: "k", assignedSectionLabel: () => "Change map" },
    );
    expect(withMap).toBe(
      'DELETE this exact key from every section marker EXCEPT "Change map" — that is its one authoritative section per the Section assignment table. Keep exactly one occurrence, there.',
    );
    const withoutMap = renderActionDirective(
      "topic",
      err("duplicate_anchor", { offending: "k" }),
      { messageSafe: "m", offendingSafe: "k" },
    );
    expect(withoutMap).toBe(
      "DELETE the extra occurrence(s) of this exact key and keep EXACTLY ONE — one in frontmatter, one in a single section marker.",
    );
  });

  it("newly-directed codes that rendered bare before: frontmatter/body/reasoning/manual", () => {
    for (const kind of PAGE_KINDS) {
      for (const code of [
        "no_frontmatter",
        "invalid_frontmatter",
        "missing_owner",
        "wrong_owner",
        "empty_body",
        "empty_after_normalize",
        "reasoning_only",
        "unclosed_reasoning",
        "model_invented_manual",
      ] as const) {
        const action = renderActionDirective(kind, err(code), { messageSafe: "m" });
        expect(action.length, `${kind}/${code} must render a directive`).toBeGreaterThan(0);
      }
    }
    expect(
      renderActionDirective("module", err("model_invented_manual"), { messageSafe: "m" }),
    ).toBe("DELETE the lw:manual block entirely; it is reserved for human content and must never be emitted.");
    expect(
      renderActionDirective("module", err("auxiliary_page_not_compact"), { messageSafe: "m" }),
    ).toContain("compact auxiliary contract");
  });

  it("verify codes render their specific directives; verify_failed keeps a generic one", () => {
    expect(
      renderActionDirective("flow", err("broken_internal_link"), { messageSafe: "m" }),
    ).toContain("must be the bare `index.md` target");
    expect(
      renderActionDirective("module", err("broken_internal_link"), { messageSafe: "m" }),
    ).toContain("correct the named internal link");
    expect(
      renderActionDirective("topic", err("broken_internal_link"), { messageSafe: "m" }),
    ).toContain("the topics hub is the bare `index.md`");
    expect(
      renderActionDirective("module", err("broken_anchor"), { messageSafe: "m" }),
    ).toContain("does not resolve to any indexed symbol");
    expect(
      renderActionDirective("module", err("invalid_mermaid_diagram"), { messageSafe: "m" }),
    ).toContain("simplify the diagram syntax");
    for (const kind of PAGE_KINDS) {
      expect(
        renderActionDirective(kind, err("verify_failed"), { messageSafe: "m" }),
      ).toBe("fix the exact verify issue named in the error.");
    }
  });

  it("unclassified codes render no ACTION", () => {
    for (const kind of PAGE_KINDS) {
      for (const code of Object.keys(UNCLASSIFIED[kind]) as Array<ArtifactValidationError["code"]>) {
        expect(
          renderActionDirective(kind, err(code), { messageSafe: "m" }),
          `${kind}/${code}`,
        ).toBe("");
      }
    }
  });
});

describe("repair-contract — report-only block and early abort", () => {
  it("report-only block is empty when every error has a directive", () => {
    expect(
      renderReportOnlyBlock("module", [
        err("broken_anchor"),
        err("empty_section", { location: "section" }),
      ]),
    ).toEqual([]);
  });

  it("report-only block lists each unclassified code once, with its reason", () => {
    const block = renderReportOnlyBlock("module", [
      err("broken_anchor"),
      err("manual_block_altered"),
      err("manual_block_altered"),
    ]);
    expect(block).toHaveLength(2);
    expect(block[0]).toContain("no supported repair exists");
    expect(block[0]).toContain("do NOT attempt to guess");
    expect(block[1]).toBe(`- [manual_block_altered]: ${UNCLASSIFIED.module.manual_block_altered}`);
  });

  it("collectUnclassified dedupes by code, first-seen order", () => {
    const entries = collectUnclassified("flow", [
      err("manual_block_altered"),
      err("broken_anchor"), // classified — skipped
      err("missing_wiki_path"),
      err("manual_block_altered"),
    ]);
    expect(entries.map((e) => e.code)).toEqual(["manual_block_altered", "missing_wiki_path"]);
  });

  it("isUnrepairableErrorSet: empty set is never unrepairable", () => {
    expect(isUnrepairableErrorSet("module", [])).toBe(false);
  });

  it("isUnrepairableErrorSet: all-unclassified set aborts; any directive-bearing code keeps the set repairable", () => {
    expect(isUnrepairableErrorSet("module", [err("manual_block_altered")])).toBe(true);
    expect(
      isUnrepairableErrorSet("module", [
        err("manual_block_altered"),
        err("missing_wiki_path"),
      ]),
    ).toBe(true);
    expect(
      isUnrepairableErrorSet("module", [
        err("manual_block_altered"),
        err("broken_internal_link"),
      ]),
    ).toBe(false);
    // Kind-specific: anchor_in_disallowed_section is unclassified for module
    // pages but has a directive for flow pages.
    expect(isUnrepairableErrorSet("module", [err("anchor_in_disallowed_section")])).toBe(true);
    expect(isUnrepairableErrorSet("flow", [err("anchor_in_disallowed_section")])).toBe(false);
  });

  it("formatUnrepairableMessage names the target and every unclassified code with its reason", () => {
    const message = formatUnrepairableMessage("module", "auth", [
      err("manual_block_altered"),
      err("missing_wiki_path"),
    ]);
    expect(message).toContain('task "auth" failed without consuming repair budget');
    expect(message).toContain("- [manual_block_altered]:");
    expect(message).toContain("rule #6");
    expect(message).toContain("- [missing_wiki_path]:");
  });
});
