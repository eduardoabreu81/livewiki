/**
 * section-guard.test.ts — recovery tier (Component 1): H2-section splitting
 * and the anti-cascade splice guard for surgical repair.
 *
 * Contracts covered:
 *   - splitH2Sections: prefix + H2 intervals (H3+ stays inside its parent
 *     H2), fenced code with `##` lines is not a boundary, CRLF offsets are
 *     exact byte offsets.
 *   - spliceSections: target sections replaced, everything else preserved
 *     byte-for-byte; null on any cascade (changed prefix, changed non-target
 *     section, added/removed/renamed section, absent or ambiguous target).
 *   - surgicalRepairTargetSections: the eligibility rule (codes + resolvable
 *     section per error; message-named section for section-level
 *     missing_page_opening).
 */

import { describe, it, expect } from "vitest";
import {
  splitH2Sections,
  spliceSections,
  slugifyHeading,
  surgicalRepairTargetSections,
} from "./section-guard.js";
import type { ArtifactValidationError } from "./prompts.js";

const PAGE = [
  "---",
  "title: test",
  "owner: generated",
  "---",
  "",
  "# test",
  "",
  "Opening paragraph.",
  "",
  "## Alpha",
  "",
  "Alpha body.",
  "",
  "### Alpha detail",
  "",
  "Nested H3 stays inside Alpha.",
  "",
  "## Beta",
  "",
  "Beta body.",
  "",
  "## Gamma",
  "",
  "Gamma body.",
  "",
].join("\n");

describe("splitH2Sections", () => {
  it("splits prefix and H2 sections; H3 stays inside its parent H2", () => {
    const split = splitH2Sections(PAGE);
    expect(split.prefix).toBe(
      "---\ntitle: test\nowner: generated\n---\n\n# test\n\nOpening paragraph.\n\n",
    );
    expect(split.sections.map((s) => s.slug)).toEqual(["alpha", "beta", "gamma"]);
    const alpha = split.sections[0]!;
    const alphaText = PAGE.slice(alpha.start, alpha.end);
    expect(alphaText).toContain("### Alpha detail");
    expect(alphaText).toContain("Nested H3 stays inside Alpha.");
    expect(alphaText).not.toContain("## Beta");
    const gamma = split.sections[2]!;
    expect(PAGE.slice(gamma.start, gamma.end)).toBe("## Gamma\n\nGamma body.\n");
  });

  it("a page with no H2 is all prefix", () => {
    const split = splitH2Sections("# title\n\nonly opening.\n");
    expect(split.prefix).toBe("# title\n\nonly opening.\n");
    expect(split.sections).toEqual([]);
  });

  it("`##` lines inside fenced code are not section boundaries", () => {
    const page = [
      "## Alpha",
      "",
      "```md",
      "## Fake heading",
      "```",
      "",
      "Alpha body.",
      "",
      "## Beta",
      "",
      "Beta body.",
      "",
    ].join("\n");
    const split = splitH2Sections(page);
    expect(split.sections.map((s) => s.slug)).toEqual(["alpha", "beta"]);
    const alpha = split.sections[0]!;
    expect(page.slice(alpha.start, alpha.end)).toContain("## Fake heading");
  });

  it("CRLF: offsets are exact byte offsets into the original text", () => {
    const crlf = PAGE.replace(/\n/g, "\r\n");
    const split = splitH2Sections(crlf);
    expect(split.sections.map((s) => s.slug)).toEqual(["alpha", "beta", "gamma"]);
    const beta = split.sections[1]!;
    expect(crlf.slice(beta.start, beta.start + 7)).toBe("## Beta");
    expect(crlf.slice(beta.start, beta.end)).toContain("Beta body.\r\n");
    expect(split.prefix).toBe(crlf.slice(0, split.sections[0]!.start));
  });

  it("slugifyHeading mirrors the validator rule (accents, punctuation, case)", () => {
    expect(slugifyHeading("Failure and recovery")).toBe("failure-and-recovery");
    expect(slugifyHeading("When to use this page")).toBe("when-to-use-this-page");
    expect(slugifyHeading("Café: Über!")).toBe("cafe-uber");
  });
});

describe("spliceSections", () => {
  it("replaces only the target section, preserving everything else byte-for-byte", () => {
    const repaired = PAGE.replace("Beta body.", "Beta body, now with real prose.");
    const merged = spliceSections(PAGE, repaired, ["beta"]);
    expect(merged).toBe(repaired);
    // The guard result is `original` with Beta swapped in — identical here
    // because the model complied and changed nothing else.
    expect(merged).toContain("Alpha body.");
    expect(merged).toContain("Gamma body.");
  });

  it("cascade: a non-target section changed → null", () => {
    // Repaired rewrites Alpha AND Beta; only Beta is targeted. The guard
    // must reject: Alpha is a non-target section that changed.
    const repaired = PAGE
      .replace("Alpha body.", "Alpha rewritten.")
      .replace("Beta body.", "Beta fixed.");
    expect(spliceSections(PAGE, repaired, ["beta"])).toBeNull();
  });

  it("multiple targets are all replaced", () => {
    const repaired = PAGE
      .replace("Alpha body.", "Alpha fixed.")
      .replace("Gamma body.", "Gamma fixed.");
    const merged = spliceSections(PAGE, repaired, ["alpha", "gamma"]);
    expect(merged).toBe(repaired);
  });

  it("cascade: changed prefix (frontmatter/opening) → null", () => {
    const repaired = PAGE.replace("title: test", "title: changed").replace(
      "Beta body.",
      "Beta fixed.",
    );
    expect(spliceSections(PAGE, repaired, ["beta"])).toBeNull();
  });

  it("cascade: added section → null", () => {
    const repaired = PAGE + "## Delta\n\nNew section.\n";
    expect(spliceSections(PAGE, repaired, ["beta"])).toBeNull();
  });

  it("cascade: removed non-target section → null", () => {
    const repaired = PAGE.replace("## Gamma\n\nGamma body.\n", "");
    expect(spliceSections(PAGE, repaired, ["beta"])).toBeNull();
  });

  it("cascade: renamed section heading (slug change) → null", () => {
    const repaired = PAGE.replace("## Gamma", "## Renamed");
    expect(spliceSections(PAGE, repaired, ["beta"])).toBeNull();
  });

  it("unknown target section (absent in repaired) → null", () => {
    const repaired = PAGE.replace("## Beta\n\nBeta body.\n\n", "");
    expect(spliceSections(PAGE, repaired, ["beta"])).toBeNull();
  });

  it("target absent in the original → null", () => {
    expect(spliceSections(PAGE, PAGE, ["does-not-exist"])).toBeNull();
  });

  it("ambiguous target (duplicate slug) → null", () => {
    const dup = PAGE + "## Beta\n\nSecond beta.\n";
    expect(spliceSections(dup, dup, ["beta"])).toBeNull();
  });

  it("empty target list → null", () => {
    expect(spliceSections(PAGE, PAGE, [])).toBeNull();
  });

  it("CRLF: a compliant CRLF response splices cleanly", () => {
    const crlf = PAGE.replace(/\n/g, "\r\n");
    const repaired = crlf.replace("Beta body.", "Beta body, fixed.");
    const merged = spliceSections(crlf, repaired, ["beta"]);
    expect(merged).toBe(repaired);
  });

  it("CRLF: a lone changed line ending outside the target is a cascade", () => {
    const crlf = PAGE.replace(/\n/g, "\r\n");
    // Model "normalized" one non-target line ending — byte difference outside
    // the target section must be rejected.
    const repaired = crlf.replace("Gamma body.\r\n", "Gamma body.\n");
    expect(spliceSections(crlf, repaired, ["beta"])).toBeNull();
  });

  it("fences containing `##` inside a non-target section must match byte-for-byte", () => {
    const withFence = PAGE.replace(
      "Gamma body.",
      "Gamma body.\n\n```md\n## not a heading\n```",
    );
    // Compliant: identical page → merged equals original.
    expect(spliceSections(withFence, withFence, ["beta"])).toBe(withFence);
    // Non-compliant: fence content changed inside non-target Gamma → null.
    const tampered = withFence.replace("## not a heading", "## changed");
    expect(spliceSections(withFence, tampered, ["beta"])).toBeNull();
  });
});

describe("surgicalRepairTargetSections", () => {
  const err = (
    code: string,
    message: string,
    location: "frontmatter" | "section" | "body" | "global",
    sectionSlug?: string,
  ): ArtifactValidationError => ({
    code: code as ArtifactValidationError["code"],
    message,
    location,
    ...(sectionSlug !== undefined ? { sectionSlug } : {}),
  });

  it("eligible set: every error carries an eligible code and a sectionSlug", () => {
    const targets = surgicalRepairTargetSections([
      err("empty_section", "section marker at offset 10 has no real prose", "section", "details"),
      err("anchor_missing_in_required_section", "the named section carries no marker", "section", "purpose"),
    ]);
    expect(targets).toEqual(["details", "purpose"]);
  });

  it("section-level missing_page_opening resolves the section from the message", () => {
    const targets = surgicalRepairTargetSections([
      err(
        "missing_page_opening",
        'page opening "Failure and recovery" must contain one or more prose paragraphs',
        "body",
      ),
    ]);
    expect(targets).toEqual(["failure-and-recovery"]);
  });

  it("the topic section-content message shape also resolves (topic section \"X\" must contain)", () => {
    const targets = surgicalRepairTargetSections([
      err(
        "missing_page_opening",
        'topic section "Change map" must contain grounded prose, bullets, or links',
        "body",
      ),
      err("empty_section", "section marker at offset 560 has no real prose", "section", "change-map"),
    ]);
    expect(targets).toEqual(["change-map"]);
  });

  it("deduplicates targets, first-seen order", () => {
    const targets = surgicalRepairTargetSections([
      err("empty_section", "no prose", "section", "details"),
      err("todo_marker_present", "placeholder", "section", "details"),
    ]);
    expect(targets).toEqual(["details"]);
  });

  it("an ineligible code anywhere in the set → null", () => {
    expect(
      surgicalRepairTargetSections([
        err("empty_section", "no prose", "section", "details"),
        err("anchor_outside_closed_list", "bad anchor", "frontmatter"),
      ]),
    ).toBeNull();
  });

  it("an eligible code without a resolvable section → null", () => {
    // broken_internal_link from verify carries location body and no slug.
    expect(
      surgicalRepairTargetSections([
        err("broken_internal_link", "link target does not resolve", "body"),
      ]),
    ).toBeNull();
  });

  it("page-structure missing_page_opening (no quoted section) → null", () => {
    expect(
      surgicalRepairTargetSections([
        err("missing_page_opening", "required page opening H1 is missing", "body"),
      ]),
    ).toBeNull();
  });

  it("empty error set → null", () => {
    expect(surgicalRepairTargetSections([])).toBeNull();
  });
});
