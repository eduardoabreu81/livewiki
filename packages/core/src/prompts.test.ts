import { describe, it, expect } from "vitest";
import {
  buildStage4Prompt,
  buildStage2RefinePrompt,
  buildQuickstartPrompt,
  buildOverviewPrompt,
  buildRepairPrompt,
  neutralizeUntrustedControlMarkers,
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

  it("repair prompt requires completeness and embeds a larger prior-candidate window", () => {
    const longPrior = "P".repeat(5000);
    const r = buildRepairPrompt(
      sampleModule,
      ["src/a.ts#x"],
      "sym",
      "code",
      longPrior,
      [{ code: "missing_closed_key", message: "missing", location: "global", offending: "src/a.ts#x" }],
      "en",
    );
    expect(r.system).toMatch(/COMPLETENESS/i);
    // Previously truncated at 2000; must keep a multi-kilobyte window.
    expect(r.user.length).toBeGreaterThan(4000);
    expect(r.user).toContain("P".repeat(4000));
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
    const r = buildRepairPrompt(sampleModule, closed, "sym", "code", "prior text", errors, "en");
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
      "en",
    );
    expect(rSection.user).toMatch(/exactly one section marker ONLY/i);

    expect(rFrontmatter.system).toMatch(/COMPLETENESS IS TWO INDEPENDENT REQUIREMENTS/i);
    expect(rFrontmatter.system).toMatch(/ADD the key ONLY to the location named by that error/i);
  });

  it("repair prompt receives the prior candidate (truncated) and instructs no reasoning prose", () => {
    const r = buildRepairPrompt(
      sampleModule,
      ["k"],
      "sym",
      "code",
      "PRIOR CANDIDATE TEXT",
      [{ code: "empty_body", message: "no body", location: "body" }],
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
      "en",
    );
    expect(r.user).not.toContain("<!-- lw:anchors ... -->");
    expect(r.user).not.toContain("<!-- lw:anchors fake-key -->");
    for (const keys of copyableAnchorMarkers(r.user)) {
      for (const k of keys) expect(closed).toContain(k);
    }
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
