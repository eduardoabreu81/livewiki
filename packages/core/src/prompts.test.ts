import { describe, it, expect } from "vitest";
import {
  buildStage4Prompt,
  buildStage2RefinePrompt,
  buildQuickstartPrompt,
  buildOverviewPrompt,
  buildRepairPrompt,
  neutralizeUntrustedControlMarkers,
  neutralizeUntrustedControlMarkersExceptValidAnchors,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  DEFAULT_OUTPUT_TOKEN_BUDGET,
} from "./prompts.js";
import type { Module } from "./modules.js";

/** Extract every `<!-- lw:anchors ... -->` marker body from a prompt string. */
function copyableAnchorMarkers(text: string): string[][] {
  const out: string[][] = [];
  for (const m of text.matchAll(/<!--\s*lw:anchors\s+([^>]*?)\s*-->/g)) {
    out.push((m[1] ?? "").trim().split(/\s+/).filter(Boolean));
  }
  return out;
}

const sampleModule: Module = {
  id: "auth",
  paths: ["src/auth/login.ts", "src/auth/session.ts"],
  symbolCount: 5,
};

describe("prompts — todos em inglês (templates)", () => {
  it("stage 4 system prompt é em inglês (não muda com language)", () => {
    const en = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code", "en");
    const pt = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code", "pt-BR");
    // System prompt é o mesmo — language aparece como instrução mas texto base é inglês
    expect(en.system).toBe(pt.system);
    expect(en.system).toMatch(/technical documentation generator/);
  });

  it("language aparece no user prompt como instrução explícita", () => {
    const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code", "es");
    expect(r.user).toMatch(/es/);
  });

  it("language default é 'en'", () => {
    const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code");
    expect(r.user).toMatch(/en/);
  });

  it("lista fechada de chaves canônicas aparece verbatim no user prompt", () => {
    const closedKeys = ["src/auth.ts#login", "src/auth.ts#session", "src/auth.ts#logout"];
    const r = buildStage4Prompt(sampleModule, closedKeys, "sym", "code");
    for (const k of closedKeys) {
      expect(r.user).toContain(k);
    }
  });

  it("regra 'NEVER invent' presente no system prompt", () => {
    const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code");
    expect(r.system).toMatch(/NEVER invent/);
  });

  it("stage 4 system requires complete closed-list coverage (no partial budget escape)", () => {
    const r = buildStage4Prompt(sampleModule, ["src/a.ts#x"], "sym", "code");
    expect(r.system).toMatch(/COMPLETENESS/i);
    expect(r.system).toMatch(/Partial coverage is rejected/);
    expect(r.system).not.toMatch(/budget is exhausted/);
    expect(r.system).toMatch(/incomplete coverage|closed-list key is missing|missing from the page/i);
  });

  it("stage 4 system requires independent frontmatter and section coverage", () => {
    const r = buildStage4Prompt(sampleModule, ["src/a.ts#x"], "sym", "code");
    expect(r.system).toMatch(/TWO INDEPENDENT REQUIREMENTS/i);
    expect(r.system).toMatch(/frontmatter anchors list alone MUST contain every closed-list key/i);
    expect(r.system).toMatch(/section markers alone.*MUST also contain every closed-list key/i);
  });

  it("stage 4 system requires exactly-once anchors and forbids aggregate section markers", () => {
    const r = buildStage4Prompt(sampleModule, ["src/a.ts#x"], "sym", "code");
    expect(r.system).toMatch(
      /frontmatter anchors list alone MUST contain every closed-list key EXACTLY ONCE/i,
    );
    expect(r.system).toMatch(
      /section markers alone.*MUST also contain every closed-list key EXACTLY ONCE/i,
    );
    expect(r.system).toMatch(/Do NOT emit an aggregate or summary `lw:anchors` marker/i);
    expect(r.system).toMatch(/Each key belongs to EXACTLY ONE section marker/i);
  });

  it("stage 4 system requires prose after every section marker and closed Markdown", () => {
    const r = buildStage4Prompt(sampleModule, ["src/a.ts#x"], "sym", "code");
    expect(r.system).toMatch(/followed by real explanatory prose/i);
    expect(r.system).toMatch(/[Cc]lose every (fenced code block|Markdown construct)/);
    expect(r.system).toMatch(/never end the page mid code-span or mid-fence/i);
  });

  it("stage 4 system bans TODO/TBD placeholders", () => {
    const r = buildStage4Prompt(sampleModule, ["src/a.ts#x"], "sym", "code");
    expect(r.system).not.toMatch(/write "TODO:"/i);
    expect(r.system).toMatch(/do not write "TODO", "TBD"/i);
    expect(r.system).toMatch(/"TODO"\/"TBD" text in the body, outside a fenced\/inline code example/i);
  });

  it("repair prompt requires completeness and embeds the full prior candidate within its supplied budget", () => {
    const longPrior = `${"P".repeat(20_000)}FULL_CANDIDATE_TAIL`;
    const r = buildRepairPrompt(
      sampleModule,
      ["src/a.ts#x"],
      "sym",
      "code",
      longPrior,
      [{ code: "missing_closed_key", message: "missing", location: "global", offending: "src/a.ts#x" }],
      25_000,
      "en",
    );
    expect(r.system).toMatch(/COMPLETENESS/i);
    expect(r.user).toContain(longPrior);
    expect(r.user).toContain("FULL_CANDIDATE_TAIL");
  });
});

// === U — prompt hardening (Phase-5 plan) + clean-v5 ellipsis finding ===
// The LLM copied `<!-- lw:anchors ... -->` / key1 placeholders into pages.
// Prompts must never ship invalid copyable markers.
describe("prompts U — hardening (no copyable fake anchors)", () => {
  it("stage 4 system prompt does NOT contain the string 'key1' or 'key2' as placeholders", () => {
    const r = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code");
    expect(r.system).not.toMatch(/\bkey1\b/);
    expect(r.system).not.toMatch(/\bkey2\b/);
  });

  it("stage 4 + repair prompts NEVER contain the ellipsis marker <!-- lw:anchors ... -->", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const stage4 = buildStage4Prompt(sampleModule, closed, "sym", "code");
    const repair = buildRepairPrompt(
      sampleModule,
      closed,
      "sym",
      "code",
      "prior",
      [{ code: "anchor_outside_closed_list", message: "bad", location: "section", offending: "..." }],
      60_000,
      "en",
    );
    for (const text of [stage4.system, stage4.user, repair.system, repair.user]) {
      expect(text).not.toContain("<!-- lw:anchors ... -->");
      expect(text).not.toMatch(/lw:anchors\s+\.\.\./);
    }
  });

  it("stage 4 section-marker example uses only real closed-list keys", () => {
    const closed = ["packages/core/src/batch.ts#runBatch", "packages/core/src/batch.ts#statusToExitCode"];
    const r = buildStage4Prompt(sampleModule, closed, "sym", "code");
    expect(r.user).toContain(`<!-- lw:anchors ${closed[0]} ${closed[1]} -->`);
    expect(r.user).not.toMatch(/lw:anchors\s+key\d/);
    expect(r.user).not.toMatch(/lw:anchors\s+<key>/);
    expect(r.system).toMatch(/AUTHORITATIVE KEY SOURCE|byte-for-byte/i);
  });

  it("stage 4 system prompt does NOT contain a literal lw:anchors marker with placeholder keys", () => {
    const r = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code");
    expect(r.system).not.toMatch(/<!--\s*lw:anchors/);
    expect(r.system).not.toMatch(/lw:anchors\s+[a-z]+\s+[a-z]+/);
  });

  it("repair prompt does NOT contain 'key1' or 'key2' as placeholders", () => {
    const r = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "sym",
      "code",
      "prior candidate content",
      [{ code: "wrong_owner", message: "owner wrong", location: "frontmatter" }],
      60_000,
      "en",
    );
    expect(r.system).not.toMatch(/\bkey1\b/);
    expect(r.system).not.toMatch(/\bkey2\b/);
    expect(r.user).not.toMatch(/\bkey1\b/);
    expect(r.user).not.toMatch(/\bkey2\b/);
  });

  it("repair prompt receives the closed key list verbatim and the structured errors", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const errors: import("./prompts.js").ArtifactValidationError[] = [
      { code: "wrong_owner", message: "owner must be generated", location: "frontmatter" },
      { code: "anchor_outside_closed_list", message: "fake key", location: "frontmatter", offending: "fake-key" },
    ];
    const r = buildRepairPrompt(
      sampleModule,
      closed,
      "sym",
      "code",
      "prior text",
      errors,
      60_000,
      "en",
    );
    for (const k of closed) {
      expect(r.user).toContain(k);
    }
    expect(r.user).toContain("owner must be generated");
    expect(r.user).toContain("fake-key");
  });

  it("repair prompt tells the LLM to REMOVE an invalid anchor, not replace it with an arbitrary key", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const r = buildRepairPrompt(
      sampleModule,
      closed,
      "sym",
      "code",
      '<!-- lw:anchors ... -->\nBody',
      [
        {
          code: "anchor_outside_closed_list",
          message: 'section anchor "..." is not in the module\'s closed key list',
          location: "section",
          offending: "...",
        },
      ],
      60_000,
      "en",
    );
    expect(r.user).toContain("offending: ...");
    expect(r.user).toMatch(/ACTION:\s*REMOVE this invalid anchor "\.\.\."/i);
    expect(r.user).not.toMatch(/ACTION:.*replace offending/i);
    for (const k of closed) {
      expect(r.user).toContain(k);
    }
    expect(r.system).toMatch(/REMOVE that exact offending anchor entirely/i);
    expect(r.system).not.toMatch(/REPLACE that exact token/i);
  });

  it("repair prompt does NOT instruct substituting an arbitrary closed-list key for an invalid one", () => {
    const r = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "sym",
      "code",
      "prior",
      [{ code: "anchor_outside_closed_list", message: "bad", location: "section", offending: "fake-key" }],
      60_000,
      "en",
    );
    expect(r.system).not.toMatch(/replace it with a real key/i);
    expect(r.user).not.toMatch(/replace offending "fake-key" with a key/i);
    expect(r.user).toMatch(/REMOVE this invalid anchor "fake-key" entirely\. Do NOT replace it with another key\./);
  });

  it("repair prompt with anchor_outside_closed_list never instructs substituting an arbitrary key — including the user-prompt headings", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const r = buildRepairPrompt(
      sampleModule,
      closed,
      "sym",
      "code",
      "prior candidate",
      [{ code: "anchor_outside_closed_list", message: "bad", location: "section", offending: "fake-key" }],
      60_000,
      "en",
    );
    // Nowhere in the whole prompt (system + user, including the section
    // heading that introduces the structured-error list) may there be an
    // instruction to REPLACE the offending token with a closed-list key.
    for (const text of [r.system, r.user]) {
      expect(text).not.toMatch(/replace (every )?offending token with a real closed-list key/i);
      expect(text).not.toMatch(/replace .*offending.* with a key/i);
      expect(text).not.toMatch(/replace it with a real key/i);
      expect(text).not.toMatch(/replace it with another key from the closed list/i);
    }
    expect(r.user).toContain(
      "# Structured errors from the validator (FIX ALL — remove outside-list anchors; " +
        "add only the exact missing keys named by missing_closed_key):",
    );
  });

  it("repair prompt for missing_closed_key instructs adding ONLY to the location named by the error, no duplicates", () => {
    const rFrontmatter = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login", "src/auth.ts#logout"],
      "sym",
      "code",
      "prior",
      [{ code: "missing_closed_key", message: "missing", location: "frontmatter", offending: "src/auth.ts#logout" }],
      60_000,
      "en",
    );
    expect(rFrontmatter.user).toMatch(/ACTION:\s*ADD this exact key "src\/auth\.ts#logout"/i);
    expect(rFrontmatter.user).toMatch(/frontmatter anchors list ONLY/i);
    expect(rFrontmatter.user).toMatch(/do not duplicate it/i);

    const rSection = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login", "src/auth.ts#logout"],
      "sym",
      "code",
      "prior",
      [{ code: "missing_closed_key", message: "missing", location: "section", offending: "src/auth.ts#logout" }],
      60_000,
      "en",
    );
    expect(rSection.user).toMatch(/exactly one section marker ONLY/i);

    expect(rFrontmatter.system).toMatch(/COMPLETENESS IS TWO INDEPENDENT REQUIREMENTS/i);
    expect(rFrontmatter.system).toMatch(/ADD the key ONLY to the location named by that error/i);
  });

  it("repair prompt gives duplicate_anchor an explicit delete-extras action", () => {
    const key = "src/auth.ts#login";
    const r = buildRepairPrompt(
      sampleModule,
      [key],
      "sym",
      "code",
      `<!-- lw:anchors ${key} -->\n<!-- lw:anchors ${key} -->`,
      [
        {
          code: "duplicate_anchor",
          message: "key appears in more than one section marker",
          location: "section",
          sectionSlug: "validation-flow",
          offending: key,
        },
      ],
      60_000,
      "en",
    );

    expect(r.user).toContain(`[duplicate_anchor] (section "validation-flow")`);
    expect(r.user).toContain(`ACTION: this exact key "${key}"`);
    expect(r.user).toMatch(/appears more than once in the section markers; DELETE the extra occurrence\(s\) and keep EXACTLY ONE/i);
    expect(r.user).toMatch(/DELETE that aggregate marker entirely/i);
  });

  it("repair constraints mirror exactly-once rules and preservation requires deleting duplicates", () => {
    const key = "src/auth.ts#login";
    const r = buildRepairPrompt(
      sampleModule,
      [key],
      "sym",
      "code",
      `<!-- lw:anchors ${key} -->`,
      [{ code: "duplicate_anchor", message: "duplicate", location: "section", offending: key }],
      60_000,
      "en",
    );

    expect(r.system).toMatch(
      /frontmatter anchors list alone MUST contain every closed-list key EXACTLY ONCE/i,
    );
    expect(r.system).toMatch(
      /section markers alone.*MUST also contain every closed-list key EXACTLY ONCE/i,
    );
    expect(r.system).toMatch(/Do NOT emit an aggregate or summary `lw:anchors` marker/i);
    expect(r.user).toMatch(/preserved as the correct syntax reference/i);
    expect(r.user).toMatch(/preservation is NOT an instruction to keep every occurrence/i);
    expect(r.user).toMatch(
      /when a duplicate_anchor error names a key, DELETE its extra preserved copies and keep EXACTLY ONE/i,
    );
  });

  it("repair prompt receives the prior candidate within its budget and instructs no reasoning prose", () => {
    const r = buildRepairPrompt(
      sampleModule,
      ["k"],
      "sym",
      "code",
      "PRIOR CANDIDATE TEXT",
      [{ code: "empty_body", message: "no body", location: "body" }],
      60_000,
      "en",
    );
    expect(r.user).toContain("PRIOR CANDIDATE TEXT");
    expect(r.system).toMatch(/Do NOT wrap your output in code fences/);
  });
});

// === Codex blocker fix: source / priorCandidate are UNTRUSTED content ===
// A fake `<!-- lw:anchors ... -->` embedded in repo code (comments, strings)
// or in a rejected prior candidate must never survive into the final prompt
// as copyable marker syntax — only the dynamic example built from real
// closed-list keys may look like a marker.
describe("prompts — untrusted content neutralization (source / priorCandidate)", () => {
  it("selective neutralization preserves valid anchor markers byte-for-byte", () => {
    const marker = "<!--  lw:anchors\tsrc/auth.ts#login src/auth.ts#logout src/auth.ts#login  -->";
    const closed = Object.freeze(["src/auth.ts#login", "src/auth.ts#logout"]);

    expect(
      neutralizeUntrustedControlMarkersExceptValidAnchors(marker, closed),
    ).toBe(marker);
  });

  it("selective neutralization removes anchor markers with unknown, malformed, or empty key sets", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const rejectedMarkers = [
      "<!-- lw:anchors src/auth.ts#login fake-key -->",
      "<!-- /lw:anchors src/auth.ts#login -->",
      "<!-- lw:anchors -->",
    ];

    for (const marker of rejectedMarkers) {
      const result = neutralizeUntrustedControlMarkersExceptValidAnchors(
        marker,
        closed,
      );
      expect(result).toBe(" ".repeat(marker.length));
      expect(result).toHaveLength(marker.length);
    }
  });

  it("selective neutralization removes manual and unknown control-marker types", () => {
    const markers = [
      "<!-- lw:manual -->",
      "<!-- /lw:manual -->",
      "<!-- lw:future payload -->",
    ];

    for (const marker of markers) {
      const result = neutralizeUntrustedControlMarkersExceptValidAnchors(
        marker,
        ["src/auth.ts#login"],
      );
      expect(result).toBe(" ".repeat(marker.length));
      expect(result).toHaveLength(marker.length);
    }
  });

  it("neutralizeUntrustedControlMarkers() drops the ENTIRE payload — pure whitespace, no visible token", () => {
    // A bracketed placeholder is itself a
    // copyable, prose-shaped token the LLM can echo. Nothing should
    // survive except whitespace of the same length as the original match.
    const a = neutralizeUntrustedControlMarkers("<!-- lw:anchors ... -->");
    expect(a).toBe(" ".repeat("<!-- lw:anchors ... -->".length));
    expect(a.trim()).toBe("");

    const b = neutralizeUntrustedControlMarkers("<!-- lw:anchors fake-key -->");
    expect(b.trim()).toBe("");

    // Payload never survives — no "...", no "fake-key", no real key copied out of context.
    expect(a).not.toContain("...");
    expect(b).not.toContain("fake-key");
    expect(
      neutralizeUntrustedControlMarkers("<!-- lw:anchors src/auth.ts#login extra-junk -->"),
    ).not.toContain("src/auth.ts#login");
    // No "[untrusted...]"-shaped text either — that was itself the leak vector.
    expect(a).not.toMatch(/untrusted|omitted|control marker/i);
    expect(neutralizeUntrustedControlMarkers("plain text, no marker")).toBe("plain text, no marker");
  });

  it("neutralizeUntrustedControlMarkers() neutralizes OPENING and CLOSING markers (e.g. lw:manual) as pure whitespace", () => {
    const opening = neutralizeUntrustedControlMarkers("<!-- lw:manual -->");
    const closing = neutralizeUntrustedControlMarkers("<!-- /lw:manual -->");
    expect(opening.trim()).toBe("");
    expect(closing.trim()).toBe("");
    expect(opening).not.toContain("<!--");
    expect(closing).not.toContain("<!--");

    const roundTrip = neutralizeUntrustedControlMarkers(
      "<!-- lw:manual -->\nhuman-authored payload text\n<!-- /lw:manual -->",
    );
    expect(roundTrip).not.toMatch(/<!--/);
    expect(roundTrip).not.toMatch(/lw:manual\s*-->/);
    // Body text between the markers is untouched — only the marker syntax itself is neutralized.
    expect(roundTrip).toContain("human-authored payload text");
  });

  it("stage 4: fake markers in source code never survive as copyable lw:anchors syntax", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const poisonedSource = [
      "// <!-- lw:anchors ... -->",
      "const s = '<!-- lw:anchors fake-key -->';",
    ].join("\n");
    const r = buildStage4Prompt(sampleModule, closed, "sym", poisonedSource);
    for (const keys of copyableAnchorMarkers(r.user)) {
      for (const k of keys) expect(closed).toContain(k);
    }
    expect(r.user).not.toContain("<!-- lw:anchors ... -->");
    expect(r.user).not.toContain("<!-- lw:anchors fake-key -->");
    // The invalid payload disappears entirely — not just the comment delimiters —
    // and leaves no visible bracketed replacement token either (whitespace
    // only). The static "# Source code (... untrusted ...)" HEADING is fine
    // (it's our own fixed instructional text, not a copyable marker); what
    // must never appear is the OLD leak vector, the bracketed placeholder.
    expect(r.user).not.toContain("fake-key");
    expect(r.user).not.toMatch(/lw:anchors\s+\.\.\./);
    expect(r.user).not.toMatch(/\[untrusted lw:\w+ control marker omitted\]/);
  });

  it("repair prompt: fake markers in source AND priorCandidate never survive as copyable syntax", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const poisonedSource = "/* <!-- lw:anchors ... --> */";
    const poisonedPrior = [
      "---",
      "title: x",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#login",
      "---",
      "<!-- lw:anchors fake-key -->",
      "Body.",
    ].join("\n");
    const r = buildRepairPrompt(
      sampleModule,
      closed,
      "sym",
      poisonedSource,
      poisonedPrior,
      [{ code: "anchor_outside_closed_list", message: "bad", location: "section", offending: "fake-key" }],
      60_000,
      "en",
    );
    expect(r.user).not.toContain("<!-- lw:anchors ... -->");
    expect(r.user).not.toContain("<!-- lw:anchors fake-key -->");
    for (const keys of copyableAnchorMarkers(r.user)) {
      for (const k of keys) expect(closed).toContain(k);
    }
  });

  it("repair prompt preserves valid candidate markers only, while source markers remain fully neutralized", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const validMarker = `<!-- lw:anchors ${closed.join(" ")} -->`;
    const priorCandidate = [
      validMarker,
      "Candidate prose.",
      "<!-- lw:anchors src/auth.ts#login fake-key -->",
      "<!-- lw:manual -->",
      "Manual-shaped candidate text.",
      "<!-- /lw:manual -->",
    ].join("\n");
    const poisonedSource = [
      validMarker,
      "<!-- lw:anchors fake-source-key -->",
    ].join("\n");

    const r = buildRepairPrompt(
      sampleModule,
      closed,
      "sym",
      poisonedSource,
      priorCandidate,
      [{ code: "todo_marker_present", message: "replace placeholder", location: "body" }],
      60_000,
      "en",
    );

    expect(r.user.split(validMarker)).toHaveLength(2);
    expect(r.user).not.toContain("fake-key");
    expect(r.user).not.toContain("fake-source-key");
    expect(r.user).not.toContain("<!-- lw:manual -->");
    expect(r.user).not.toContain("<!-- /lw:manual -->");
    expect(r.user).toMatch(/section markers whose keys are all in the closed list are preserved/i);
    expect(r.user).toMatch(/do NOT copy invalid keys/i);
  });

  it("generic: every copyable lw:anchors marker in the final prompt (stage4 + repair) uses ONLY closed-list keys", () => {
    const closed = ["packages/core/src/batch.ts#runBatch", "packages/core/src/batch.ts#statusToExitCode"];
    const poisonedSource = [
      "<!-- lw:anchors ... -->",
      "<!-- lw:anchors fake-key -->",
      "<!-- lw:anchors packages/core/src/batch.ts#runBatch not-a-real-key -->",
    ].join("\n");
    const stage4 = buildStage4Prompt(sampleModule, closed, "sym", poisonedSource);
    const repair = buildRepairPrompt(
      sampleModule,
      closed,
      "sym",
      poisonedSource,
      poisonedSource,
      [{ code: "anchor_outside_closed_list", message: "bad", location: "section", offending: "fake-key" }],
      60_000,
      "en",
    );
    for (const text of [stage4.user, repair.user]) {
      for (const keys of copyableAnchorMarkers(text)) {
        for (const k of keys) {
          expect(closed).toContain(k);
        }
      }
    }
    // Stage 4 has no structured errors, so the poisoned payload has no other
    // legitimate channel to appear through — it must vanish completely.
    expect(stage4.user).not.toContain("fake-key");
    expect(stage4.user).not.toContain("not-a-real-key");
    expect(stage4.user).not.toMatch(/\.\.\./);
  });
});

describe("prompts — stage 2 refine", () => {
  it("output JSON only (sem markdown fence)", () => {
    const r = buildStage2RefinePrompt([sampleModule]);
    expect(r.system).toMatch(/JSON only/);
    expect(r.system).toMatch(/No markdown fences/);
  });

  it("schema documentado no system prompt", () => {
    const r = buildStage2RefinePrompt([sampleModule]);
    expect(r.system).toMatch(/"id"/);
    expect(r.system).toMatch(/"paths"/);
  });

  it("regra 'every original path appears in EXACTLY one module'", () => {
    const r = buildStage2RefinePrompt([sampleModule]);
    expect(r.system).toMatch(/EXACTLY one module/);
  });

  it("lista heurística de módulos aparece no user prompt", () => {
    const mods: Module[] = [
      { id: "auth", paths: ["src/auth/a.ts"], symbolCount: 3 },
      { id: "utils", paths: ["src/utils/x.ts"], symbolCount: 1 },
    ];
    const r = buildStage2RefinePrompt(mods);
    expect(r.user).toContain("auth");
    expect(r.user).toContain("utils");
  });
});

describe("prompts — quickstart + overview", () => {
  it("quickstart limita tamanho (max 200 lines)", () => {
    const r = buildQuickstartPrompt([sampleModule], "syms");
    expect(r.system).toMatch(/200 lines/);
  });

  it("quickstart NÃO pede frontmatter (é entry point, não code doc)", () => {
    const r = buildQuickstartPrompt([sampleModule], "syms");
    expect(r.system).toMatch(/NO frontmatter/);
  });

  it("overview pede frontmatter owner: generated", () => {
    const r = buildOverviewPrompt([sampleModule], "summary");
    expect(r.system).toMatch(/owner: generated/);
  });

  it("overview tem language instruction explícita", () => {
    const r = buildOverviewPrompt([sampleModule], "summary", "pt-BR");
    expect(r.user).toMatch(/pt-BR/);
  });
});

describe("prompts — constants", () => {
  it("tem budgets default razoáveis", () => {
    expect(DEFAULT_CONTEXT_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(DEFAULT_OUTPUT_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_TOKEN_BUDGET).toBeGreaterThan(DEFAULT_OUTPUT_TOKEN_BUDGET);
  });
});

describe("prompts — cobertura language", () => {
  it("aceita language em vários formatos BCP-47", () => {
    for (const lang of ["en", "pt-BR", "es", "fr", "ja", "zh-CN"]) {
      const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code", lang);
      expect(r.user).toContain(lang);
    }
  });
});

// === D1 — adversarial injection suite (Lot D) ===
// Attack-shaped cases against the selective neutralization function
// and the full repair prompt, asserting byte-exact survival /
// neutralization. Each test pins one concrete invariant from the
// contract; together they lock the injection defense so a future
// "smart" relaxation is a conscious decision.
describe("prompts D1 — adversarial injection suite (selective neutralization + candidate-only)", () => {
  it("D1.1 mixed markers on consecutive lines — only the valid one survives, the rest are pure whitespace", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const validMarker = `<!-- lw:anchors ${closed.join(" ")} -->`;
    const fakeMarker = "<!-- lw:anchors src/auth.ts#login fake-key -->";
    const manualOpen = "<!-- lw:manual -->";
    const manualClose = "<!-- /lw:manual -->";
    const closingForm = "<!-- /lw:anchors src/auth.ts#login -->";

    // Adjacent on consecutive lines — no leading/trailing text
    // to mask a partial match.
    const prior = [
      validMarker,
      fakeMarker,
      manualOpen,
      "Manual-shaped text between the open and close.",
      manualClose,
      closingForm,
    ].join("\n");

    const result = neutralizeUntrustedControlMarkersExceptValidAnchors(
      prior,
      closed,
    );

    // Valid marker: byte-for-byte preserved
    expect(result).toContain(validMarker);
    // Fake marker: same-length whitespace, no copyable token survives
    const fakeOffset = result.indexOf(" ".repeat(fakeMarker.length));
    expect(fakeOffset).toBeGreaterThan(-1);
    expect(result.slice(fakeOffset, fakeOffset + fakeMarker.length)).toBe(
      " ".repeat(fakeMarker.length),
    );
    expect(result).not.toContain("fake-key");
    expect(result).not.toMatch(/lw:anchors\s+src\/auth\.ts#login\s+fake-key/);
    // lw:manual open/close: pure whitespace, no <!-- survives at those offsets
    const manualOpenOffset = prior.indexOf(manualOpen);
    expect(result.slice(manualOpenOffset, manualOpenOffset + manualOpen.length)).toBe(
      " ".repeat(manualOpen.length),
    );
    const manualCloseOffset = prior.indexOf(manualClose);
    expect(result.slice(manualCloseOffset, manualCloseOffset + manualClose.length)).toBe(
      " ".repeat(manualClose.length),
    );
    // The closing-form anchor (`/lw:anchors`) — pure whitespace
    const closingOffset = prior.indexOf(closingForm);
    expect(result.slice(closingOffset, closingOffset + closingForm.length)).toBe(
      " ".repeat(closingForm.length),
    );
    // Body text between the manual markers is preserved (neutralizer
    // only rewrites marker syntax, not intervening prose).
    expect(result).toContain("Manual-shaped text between the open and close.");
    // The ONLY remaining `<!--` in the result is from the valid marker.
    // Every other `<!--`-shaped token in the input was neutralized to
    // whitespace, so the count of `<!--` occurrences must be exactly 1.
    const commentOpens = (result.match(/<!--/g) ?? []).length;
    expect(commentOpens).toBe(1);
    // Likewise, every `lw:manual` and `lw:anchors` token in the
    // result is either part of the valid marker or has been replaced
    // by whitespace — never a copyable token from the fake/closing
    // forms.
    const manualSpans = result.match(/lw:manual/g) ?? [];
    expect(manualSpans).toHaveLength(0);
    const anchorsTokens = result.match(/lw:anchors/g) ?? [];
    expect(anchorsTokens).toHaveLength(1);
  });

  it("D1.2 a marker whose keys are all valid EXCEPT one case- or suffix-mutated key is FULLY neutralized", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];

    // Case-mutated: closed list is lowercase, marker uses uppercase
    // on one key. Exact-match is case-sensitive — must be rejected.
    const caseMutated = "<!-- lw:anchors src/auth.ts#login SRC/auth.ts#logout -->";
    // Suffix-mutated: appends an extra dash + token
    const suffixMutated = "<!-- lw:anchors src/auth.ts#login src/auth.ts#logout-extra -->";
    // Truncated prefix: a key that's a closed-list key with the tail chopped
    const truncatedKey = "<!-- lw:anchors src/auth.ts#logi -->";

    for (const marker of [caseMutated, suffixMutated, truncatedKey]) {
      const result = neutralizeUntrustedControlMarkersExceptValidAnchors(
        marker,
        closed,
      );
      expect(result).toBe(" ".repeat(marker.length));
      expect(result).toHaveLength(marker.length);
      expect(result.trim()).toBe("");
      // The mutated keys themselves must not survive as visible tokens
      expect(result).not.toContain("SRC/auth.ts#logout");
      expect(result).not.toContain("src/auth.ts#logout-extra");
      expect(result).not.toContain("src/auth.ts#logi");
    }
  });

  it("D1.3 fence-agnostic: a marker inside a fenced code block is treated the same as one outside", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const validMarker = `<!-- lw:anchors ${closed.join(" ")} -->`;
    const fakeMarker = "<!-- lw:anchors src/auth.ts#login fake-key -->";

    // Fenced block with the valid marker — implementation is
    // fence-agnostic, so the marker survives the same as it would
    // outside the fence. We pin this exact behavior so any future
    // "smart" fence-aware change is a conscious decision.
    const insideFence = ["```md", validMarker, "```"].join("\n");
    const r1 = neutralizeUntrustedControlMarkersExceptValidAnchors(insideFence, closed);
    expect(r1).toContain(validMarker);
    // The fence delimiters themselves are plain text and stay as-is.
    expect(r1).toContain("```md");
    expect(r1).toMatch(/```\s*$/);
    // The fence content is still a fenced code block: opening and
    // closing ``` preserved in order.
    expect(r1.indexOf("```md")).toBeLessThan(r1.indexOf(validMarker));
    expect(r1.indexOf(validMarker)).toBeLessThan(r1.lastIndexOf("```"));

    // Fenced block with a fake marker — neutralized exactly the same
    // as it would be outside the fence.
    const insideFenceFake = ["```md", fakeMarker, "```"].join("\n");
    const r2 = neutralizeUntrustedControlMarkersExceptValidAnchors(insideFenceFake, closed);
    const fakeOffset = insideFenceFake.indexOf(fakeMarker);
    expect(r2.slice(fakeOffset, fakeOffset + fakeMarker.length)).toBe(
      " ".repeat(fakeMarker.length),
    );
    expect(r2).not.toContain("fake-key");
    expect(r2).not.toMatch(/<!--\s*lw:anchors\s+src\/auth\.ts#login\s+fake-key\s*-->/);

    // Same shape (valid + fake adjacent) but inside one fenced block
    // — the valid marker still survives and the fake is still
    // neutralized. This is the fence-agnostic guarantee: no special
    // treatment of code blocks.
    const mixedFence = ["```md", validMarker, fakeMarker, "```"].join("\n");
    const r3 = neutralizeUntrustedControlMarkersExceptValidAnchors(mixedFence, closed);
    expect(r3).toContain(validMarker);
    expect(r3).not.toContain("fake-key");
  });

  it("D1.4 long fake marker spanning the 200-char offending boundary never reconstructs as a complete marker", () => {
    // Build a fake marker whose key body is > DIAGNOSTIC_TEXT_CAP
    // (200) chars long. The validator's `offending` field will
    // contain this whole key, then be truncated to 200 chars by
    // `summarizeValidationErrors`. The truncated text must not
    // contain enough to reconstruct a complete `<!-- lw:anchors
    // ... -->` marker (which would be a copyable fake anchor in
    // a future prompt). This ties into the previous contract's I4
    // (content safety of the diagnostic history).
    const padding = "A".repeat(220);
    const fakeLongKey = `<!-- lw:anchors fake-key ${padding} -->`;
    expect(fakeLongKey.length).toBeGreaterThan(200);
    const closed = ["src/auth.ts#login"];

    // Apply the selective neutralizer: the fake marker must be
    // neutralized whole, leaving the diagnostic excerpt as a 200-char
    // prefix that is NOT a complete fake marker.
    const neutralized = neutralizeUntrustedControlMarkersExceptValidAnchors(
      fakeLongKey,
      closed,
    );
    // The full fake marker does not survive
    expect(neutralized).not.toContain(fakeLongKey);
    expect(neutralized).not.toContain("fake-key");

    // Truncate to 200 chars (the diagnostic's per-field cap)
    const truncated = neutralized.slice(0, 200);
    // Truncated prefix is pure whitespace + start of original marker
    // — no complete copyable marker fits in 200 chars
    expect(truncated).not.toMatch(/<!--\s*lw:anchors[\s\S]*?-->/);
    // The remaining tail (after 200 chars) is empty or whitespace;
    // it can never re-form a closing ` -->` pair.
    const tail = neutralized.slice(200);
    expect(tail).toBe(" ".repeat(neutralized.length - 200));
    // Even if a future reader concatenated the truncated prefix with
    // any other diagnostic string of equal length, no `-->`
    // closing appears in the first 200 chars.
    expect(truncated).not.toContain("-->");
  });

  it("D1.5 source block with a FULLY VALID closed-list marker is STILL neutralized (selective is candidate-only)", () => {
    // The selective preservation rule applies to the prior-candidate
    // block ONLY. The source block continues to use the full
    // neutralizer. A valid-looking marker in the source must be
    // neutralized, otherwise a poisoned repo code comment could
    // re-introduce a copyable marker.
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    // Build a marker that is NOT the same as the example marker
    // emitted by the stage-4 prompt (different key ordering), so we
    // can disambiguate "from the example" vs "from the source block"
    // when scanning the prompt output.
    const validMarker = `<!-- lw:anchors ${[...closed].reverse().join(" ")} -->`;
    const poisonedSource = [
      "// pretend this is repo code:",
      validMarker,
      "const x = 1;",
    ].join("\n");

    // Stage 4: source block uses the full neutralizer
    const stage4 = buildStage4Prompt(sampleModule, closed, "sym", poisonedSource);

    // The valid-shaped marker in source MUST be neutralized — even
    // though it would survive if it were in the prior-candidate.
    // We isolate the source block and assert the marker is gone
    // there specifically (the rest of the prompt may contain the
    // stage-4 EXAMPLE marker, which is built from the same closed
    // list in the canonical order).
    const sourceHeaderIdx = stage4.user.indexOf("# Source code");
    expect(sourceHeaderIdx).toBeGreaterThan(-1);
    // Find the ``` fence that opens the source block (first one
    // AFTER the header line).
    const sourceFenceStart = stage4.user.indexOf("```", sourceHeaderIdx);
    expect(sourceFenceStart).toBeGreaterThan(-1);
    const sourceFenceEnd = stage4.user.indexOf("```", sourceFenceStart + 3);
    expect(sourceFenceEnd).toBeGreaterThan(sourceFenceStart);
    const sourceBlockContent = stage4.user.slice(sourceFenceStart + 3, sourceFenceEnd);
    expect(sourceBlockContent).toContain("const x = 1;");
    expect(sourceBlockContent).not.toContain(validMarker);
    // No `<!--` in the source block — the marker is gone
    expect(sourceBlockContent).not.toContain("<!--");

    // Repair prompt: source block also uses the full neutralizer
    // (the candidate block would be selective, but the source
    // block is always full-neutralize).
    const repair = buildRepairPrompt(
      sampleModule,
      closed,
      "sym",
      poisonedSource,
      `# candidate\n${validMarker}`,
      [{ code: "empty_body", message: "no body", location: "body" }],
      60_000,
      "en",
    );

    // The source block in the repair prompt is gone.
    const repairSourceHeader = repair.user.indexOf("# Source code");
    expect(repairSourceHeader).toBeGreaterThan(-1);
    const repairSourceStart = repair.user.indexOf("```", repairSourceHeader);
    const repairSourceEnd = repair.user.indexOf("```", repairSourceStart + 3);
    const repairSourceContent = repair.user.slice(
      repairSourceStart + 3,
      repairSourceEnd,
    );
    expect(repairSourceContent).not.toContain(validMarker);
    expect(repairSourceContent).not.toContain("<!--");

    // The candidate block IS selective — the valid marker in the
    // candidate survives in the prior-candidate section. We
    // disambiguate by isolating the candidate block: the source
    // block is gone (we already asserted above), the candidate
    // block follows the "# Prior candidate" header.
    const candidateHeader = repair.user.indexOf("# Prior candidate");
    expect(candidateHeader).toBeGreaterThan(-1);
    const candStart = repair.user.indexOf("```", candidateHeader);
    const candEnd = repair.user.indexOf("```", candStart + 3);
    const candidateContent = repair.user.slice(candStart + 3, candEnd);
    expect(candidateContent).toContain(validMarker);
    expect(candidateContent).toContain("# candidate");
  });
});
