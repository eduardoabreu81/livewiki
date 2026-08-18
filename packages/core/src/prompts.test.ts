import { describe, it, expect } from "vitest";
import {
  buildStage4Prompt,
  buildRepairPrompt,
  buildStage5Prompt,
  buildStage5RepairPrompt,
  buildTopicPrompt,
  buildTopicRepairPrompt,
  buildTopicRefinePrompt,
  buildSurgicalRepairPrompt,
  neutralizeUntrustedControlMarkers,
  neutralizeUntrustedControlMarkersExceptValidAnchors,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  DEFAULT_OUTPUT_TOKEN_BUDGET,
  PAGE_OPENING_PROMPT_RULES,
  FLOW_PAGE_PROMPT_RULES,
  LITERAL_SIGNATURE_PROMPT_RULE,
  EXCEPTION_BRANCH_PROMPT_RULE,
  INVENTORY_AUTHORITY_PROMPT_RULE,
  BRANCH_PRECISION_PROMPT_RULE,
  FILE_NARRATIVE_PROMPT_RULES,
} from "./prompts.js";
import type { ArtifactValidationError } from "./prompts.js";
import type { Module } from "./modules.js";
import type { FlowCandidate } from "./flows.js";
import type { TopicCandidate } from "./topics.js";

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

describe("prompts — all in English (templates)", () => {
  it("stage 4 system prompt is in English (does not change with language)", () => {
    const en = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code", "en");
    const pt = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code", "pt-BR");
    // System prompt is the same — language appears as an instruction but the base text is English
    expect(en.system).toBe(pt.system);
    expect(en.system).toMatch(/technical documentation generator/);
  });

  it("language appears in the user prompt as an explicit instruction", () => {
    const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code", "es");
    expect(r.user).toMatch(/es/);
  });

  it("language default is 'en'", () => {
    const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code");
    expect(r.user).toMatch(/en/);
  });

  it("closed list of canonical keys appears verbatim in the user prompt", () => {
    const closedKeys = ["src/auth.ts#login", "src/auth.ts#session", "src/auth.ts#logout"];
    const r = buildStage4Prompt(sampleModule, closedKeys, "sym", "code");
    for (const k of closedKeys) {
      expect(r.user).toContain(k);
    }
  });

  it("'NEVER invent' rule present in the system prompt", () => {
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

  it("stage 4 system requires primary exactly-once placement and forbids aggregate or roundup markers", () => {
    const r = buildStage4Prompt(sampleModule, ["src/a.ts#x"], "sym", "code");
    expect(r.system).toMatch(
      /frontmatter anchors list alone MUST contain every closed-list key EXACTLY ONCE/i,
    );
    expect(r.system).toMatch(
      /section markers alone.*MUST also contain every closed-list key EXACTLY ONCE/i,
    );
    expect(r.system).toMatch(/Do NOT emit an aggregate or summary `lw:anchors` marker/i);
    expect(r.system).toMatch(/Each key belongs to EXACTLY ONE section marker/i);
    expect(r.system).toMatch(/PRIMARY-SECTION RULE/i);
    expect(r.system).toMatch(
      /relevant to several sections.*EXACTLY ONE marker.*section that primarily documents it/i,
    );
    expect(r.system).toMatch(/Other sections may reference the symbol in prose only/i);
    expect(r.system).toMatch(/NEVER include its key in their markers/i);
    expect(r.system).toMatch(/Do NOT create a roundup or thematic section/i);
    expect(r.system).toMatch(/"helpers" or "utilities"/i);
    expect(r.system).toMatch(/re-lists keys that belong to other sections' markers/i);
  });

  it("stage 4 system forbids marker abbreviation and placeholder or example anchor keys", () => {
    const r = buildStage4Prompt(sampleModule, ["src/a.ts#x"], "sym", "code");
    expect(r.system).toMatch(/Anchor keys MUST be copied byte-for-byte from the closed list ONLY/i);
    expect(r.system).toMatch(/An `lw:anchors` marker is NEVER abbreviated/i);
    expect(r.system).toMatch(/write every key in full, one by one, separated by spaces/i);
    expect(r.system).toContain('The characters "…" or "..." must never appear ANYWHERE inside a marker');
    expect(r.system).toMatch(/not as a key, not as a list continuation/i);
    expect(r.system).toMatch(/no exception for long lists/i);
    expect(r.system).toMatch(/NEVER use a placeholder or example token as a key/i);
    expect(r.system).toMatch(/even when the documented source itself contains marker-like examples/i);
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

  it("repair hard constraints forbid abbreviating any lw:anchors marker", () => {
    const r = buildRepairPrompt(
      sampleModule,
      ["src/a.ts#x"],
      "sym",
      "code",
      "prior",
      [{ code: "wrong_owner", message: "owner wrong", location: "frontmatter" }],
      60_000,
      "en",
    );
    expect(r.system).toMatch(/An `lw:anchors` marker is NEVER abbreviated/i);
    expect(r.system).toMatch(/write every key in full, one by one, separated by spaces/i);
    expect(r.system).toContain('The characters "…" or "..." must never appear ANYWHERE inside a marker');
    expect(r.system).toMatch(/not as a key, not as a list continuation/i);
    expect(r.system).toMatch(/no exception for long lists/i);
  });

  it("initial and repair prompts direct marker examples into fenced code blocks", () => {
    const sentence =
      "Markers inside fenced code blocks are never parsed as real markers — to show marker syntax as an example, put it in a fenced code block.";
    const initial = buildStage4Prompt(
      sampleModule,
      ["src/a.ts#x"],
      "sym",
      "code",
    );
    const repair = buildRepairPrompt(
      sampleModule,
      ["src/a.ts#x"],
      "sym",
      "code",
      "prior",
      [],
      60_000,
      "en",
    );

    expect(initial.system).toContain(sentence);
    expect(repair.system).toContain(sentence);
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

  it.each(["...", "…"])("repair prompt treats %s as a marker abbreviation requiring a full rewrite", (ellipsis) => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const r = buildRepairPrompt(
      sampleModule,
      closed,
      "sym",
      "code",
      `<!-- lw:anchors ${ellipsis} -->\nBody`,
      [
        {
          code: "anchor_outside_closed_list",
          message: `section anchor "${ellipsis}" is not in the module's closed key list`,
          location: "section",
          offending: ellipsis,
        },
      ],
      60_000,
      "en",
    );
    expect(r.user).toContain(`offending: ${ellipsis}`);
    expect(r.user).toContain(`The \`lw:anchors\` marker was abbreviated with "${ellipsis}"`);
    expect(r.user).toMatch(/REMOVE the ellipsis and rewrite that marker/i);
    expect(r.user).toMatch(/every key for that section written in full, one by one/i);
    expect(r.user).toMatch(/NEVER substitute another key for the ellipsis or add an arbitrary key/i);
    expect(r.user).not.toContain(`REMOVE this invalid anchor "${ellipsis}" entirely`);
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
    expect(rFrontmatter.user).toMatch(/\[missing_closed_key\] \(frontmatter\): 1 exact closed-list key is missing/i);
    expect(rFrontmatter.user).toMatch(/ACTION:\s*ADD every key below byte-for-byte to the frontmatter anchors list/i);
    expect(rFrontmatter.user).toMatch(/do not duplicate a key/i);
    expect(rFrontmatter.user).toMatch(/  - src\/auth\.ts#logout/);

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
    expect(rSection.user).toMatch(/\[missing_closed_key\] \(section\): 1 exact closed-list key is missing/i);
    expect(rSection.user).toMatch(/exactly one primary section marker per key ONLY/i);

    expect(rFrontmatter.system).toMatch(/COMPLETENESS IS TWO INDEPENDENT REQUIREMENTS/i);
    expect(rFrontmatter.system).toMatch(/ADD every listed key ONLY to that group's named location/i);
  });

  it("groups a full section-side coverage failure without repeating one action per key", () => {
    const keys = Array.from(
      { length: 45 },
      (_, index) => `packages/core/src/module-${index + 1}.ts#symbol${index + 1}`,
    );
    const errors = [
      ...keys.map((key) => ({
        code: "missing_closed_key" as const,
        message: "closed-list key missing from section markers",
        location: "section" as const,
        offending: key,
      })),
      {
        code: "unclosed_markdown" as const,
        message: "unclosed inline-code span opened at line 170 (delimiter length 1)",
        location: "body" as const,
        offending: "The final `token",
      },
    ];

    const repair = buildRepairPrompt(
      sampleModule,
      keys,
      "symbols",
      "source",
      "prior candidate",
      errors,
      60_000,
      "en",
    );

    expect(repair.user).toContain("[missing_closed_key] (section): 45 exact closed-list keys are missing");
    expect(repair.user.match(/ACTION: ADD every key below/g)).toHaveLength(1);
    expect(repair.user).not.toContain("ACTION: ADD this exact key");
    expect(repair.user).toContain("[unclosed_markdown]");
    for (const key of keys) {
      expect(repair.user.split(key)).toHaveLength(3); // closed list + one grouped repair entry
    }
  });

  it("repair prompt gives duplicate_anchor a section-specific deletion action", () => {
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
    expect(r.user).toContain(
      `ACTION: DELETE this exact key "${key}" from the \`lw:anchors\` marker in section "validation-flow".`,
    );
    expect(r.user).toMatch(/already appears in its proper marker elsewhere/i);
    expect(r.user).toMatch(/KEEP that proper occurrence and do not move or add this key anywhere else/i);
    expect(r.user).toMatch(/DELETE that aggregate marker entirely/i);
  });

  it("repair prompt gives frontmatter duplicate_anchor a list-specific deletion action", () => {
    const key = "src/auth.ts#login";
    const r = buildRepairPrompt(
      sampleModule,
      [key],
      "sym",
      "code",
      `---\nanchors:\n  - ${key}\n  - ${key}\n---`,
      [
        {
          code: "duplicate_anchor",
          message: "key appears more than once in frontmatter",
          location: "frontmatter",
          offending: key,
        },
      ],
      60_000,
      "en",
    );

    expect(r.user).toContain(`[duplicate_anchor] (frontmatter)`);
    expect(r.user).toContain(
      `ACTION: DELETE the extra list entry for this exact key "${key}" from the frontmatter anchors list and keep EXACTLY ONE list entry.`,
    );
    expect(r.user).not.toMatch(/marker in section/i);
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

describe("prompts — Lot N page opening and factual precision", () => {
  const repairPrompt = () => buildRepairPrompt(
    sampleModule,
    ["src/auth.ts#login"],
    "- src/auth.ts#login (function): function login(user: User): Session",
    "function login(user: User) { try { return create(user); } catch { return fallback(user); } }",
    "prior",
    [],
    60_000,
    "en",
  );

  it("carries the identical opening contract in initial and repair prompts", () => {
    const initial = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "symbols", "source");
    const repair = repairPrompt();
    for (const rule of PAGE_OPENING_PROMPT_RULES) {
      expect(initial.system).toContain(rule);
      expect(repair.system).toContain(rule);
    }
    const openingRules = PAGE_OPENING_PROMPT_RULES.join("\n");
    expect(openingRules).toContain("case-insensitively");
    expect(openingRules).toContain("one or more short prose paragraphs");
    expect(openingRules).toContain("Bold text, inline code, and links are allowed");
  });

  it("requires literal signatures, no invention for empty signatures, and visible branches in both prompts", () => {
    const initial = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "symbols", "source");
    const repair = repairPrompt();
    for (const prompt of [initial.system, repair.system]) {
      expect(prompt).toContain(LITERAL_SIGNATURE_PROMPT_RULE);
      expect(prompt).toContain("copy that signature byte-for-byte");
      expect(prompt).toContain("If the table has no signature, do not invent one");
      expect(prompt).toContain(EXCEPTION_BRANCH_PROMPT_RULE);
      expect(prompt).toContain("explicitly scope the prose to the normal path");
      // Anti-meta rule (C3): the model never narrates excerpt coverage; the
      // tool owns coverage honesty via the deterministic Navigate-block note.
      expect(prompt).toContain("never narrate what the excerpt does or does not contain");
      expect(prompt).not.toContain("does not establish exhaustive behavior");
      // Inventory authority (round-4 defect): the prompt's own inventory —
      // not README/excerpt prose, which may be stale — is the only source
      // for inventory facts like "3 test files".
      expect(prompt).toContain(INVENTORY_AUTHORITY_PROMPT_RULE);
      expect(prompt).toContain("AUTHORITATIVE for inventory facts");
      expect(prompt).toContain("never copy an inventory claim");
    }
  });

  it("emits mechanical repair actions for both new structural codes", () => {
    const repair = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "symbols",
      "source",
      "prior",
      [
        {
          code: "missing_page_opening",
          message: 'page opening "When to use this page" task list must contain only 2 to 4 non-empty Markdown bullets',
          location: "body",
          offending: "- Review behavior.",
        },
        { code: "title_equals_module_id", message: "title equals id", location: "frontmatter", offending: "auth" },
      ],
      60_000,
      "en",
    );
    expect(repair.user).toMatch(/missing_page_opening.*ACTION: SPECIFIC FAILURE: page opening "When to use this page" task list must contain only 2 to 4 non-empty Markdown bullets\. Replace the opening/s);
    expect(repair.user).toMatch(/title_equals_module_id.*ACTION: replace the frontmatter title and H1/s);
  });

  it("neutralizes lw:* control markers carried inside an offending page snippet", () => {
    const markerShapedOffending = '<!-- lw:anchors src/evil.ts#fake -->';
    const repair = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "symbols",
      "source",
      "prior",
      [
        {
          code: "missing_page_opening",
          message: "required page opening H1 appears after other content",
          location: "body",
          offending: markerShapedOffending,
        },
      ],
      60_000,
      "en",
    );
    // The offending snippet is the model's own untrusted page text: it must
    // never re-enter the prompt as a copyable control marker.
    expect(repair.user).not.toContain(markerShapedOffending);
    expect(repair.user).toMatch(/missing_page_opening.*ACTION: SPECIFIC FAILURE: required page opening H1 appears after other content/s);
  });

  it("fixture quotes a supplied signature byte-for-byte before behavior prose", () => {
    const signature = "function login(user: User, options?: LoginOptions): Promise<Session>";
    const symbolsTable = `- src/auth.ts#login (function): ${signature}`;
    const fixtureOutput = [
      "## Login behavior",
      `\`${signature}\``,
      "On the normal path, the function creates a session for the supplied user.",
    ].join("\n\n");
    expect(symbolsTable).toContain(signature);
    expect(fixtureOutput).toContain(`\`${signature}\``);
    expect(fixtureOutput.indexOf(signature)).toBeLessThan(fixtureOutput.indexOf("On the normal path"));
  });

  it("fixture with an empty symbol-table signature does not fabricate one", () => {
    const symbolsTable = "- src/auth.ts#login (function): ";
    const fixtureOutput = "The supplied source identifies `src/auth.ts#login`; the symbols table supplies no signature.";
    expect(symbolsTable.endsWith(": ")).toBe(true);
    expect(fixtureOutput).not.toMatch(/function\s+login\s*\(/);
    expect(fixtureOutput).toContain("src/auth.ts#login");
  });

  it("fixture scopes normal-path prose and acknowledges a visible catch fallback", () => {
    const source = "try { return createSession(user); } catch { return anonymousSession(); }";
    const fixtureOutput = "On the normal path, the function returns the created session. If creation throws, the visible catch branch falls back to an anonymous session.";
    expect(source).toContain("catch");
    expect(fixtureOutput).toMatch(/normal path/i);
    expect(fixtureOutput).toMatch(/catch branch falls back/i);
    expect(fixtureOutput).not.toMatch(/\balways\b|\bguarantees\b|\bmandatory\b/i);
  });
});

describe("prompts — constants", () => {
  it("has reasonable default budgets", () => {
    expect(DEFAULT_CONTEXT_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(DEFAULT_OUTPUT_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_TOKEN_BUDGET).toBeGreaterThan(DEFAULT_OUTPUT_TOKEN_BUDGET);
  });
});

describe("prompts — language coverage", () => {
  it("accepts language in several BCP-47 formats", () => {
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

  it("D1.3 prompt neutralization stays fence-agnostic while document parsing masks code separately", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const validMarker = `<!-- lw:anchors ${closed.join(" ")} -->`;
    const fakeMarker = "<!-- lw:anchors src/auth.ts#login fake-key -->";

    // This helper sanitizes an untrusted prompt payload; it does not parse a
    // wiki document. The repair-recovery contract keeps this injection-defense
    // pass fence-agnostic, while artifact/anchor parsing uses markdown-mask.
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

describe("prompts — safe enclosing fence scales with longest inner backtick run", () => {
  // Defect 1 (fence selector): fixed triple-backtick fences break the
  // prompt boundary when the enclosed content contains its own
  // triple-backtick (or longer) fences. The fix must choose an outer
  // fence strictly longer than every enclosed backtick run, for both
  // the initial-source block and the repair prior-candidate block.
  //
  // Defect 4 (fence amplification): the previous selector had no cap.
  // A 60,000-character backtick run in the source produced a
  // 60,001-character outer fence, adding another ~120,000 delimiter
  // characters to the user prompt. The fix caps the fence length
  // (preferring backticks, then tildes) and bound-encodes the
  // enclosed content in the pathologically pathological case where
  // BOTH character classes have very long runs.

  function outerFenceFor(
    user: string,
    header: string,
  ): { fence: string; content: string } | null {
    const headerIdx = user.indexOf(header);
    if (headerIdx < 0) return null;
    // Find the first line that is JUST a fence (3+ backticks or
    // 3+ tildes, optional leading/trailing whitespace). The opening
    // fence is whatever character class the wrap helper picked.
    const afterHeader = user.slice(headerIdx);
    const openingMatch = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/m.exec(
      afterHeader,
    );
    if (!openingMatch || !openingMatch[1]) return null;
    const fence = openingMatch[1];
    const char = fence[0]!;
    const len = fence.length;
    const start = headerIdx + openingMatch.index;
    const innerStart = start + openingMatch[0].length;
    // The matching closing fence is on its own line later in the
    // string, with the same character class and a length ≥ the
    // opening (CommonMark rule). The wrap helper chose a length
    // strictly greater than every surviving run in the encoded
    // content, so the first matching closing fence is the right
    // one.
    const closeRe = new RegExp(
      `^[ \\t]{0,3}\\${char}{${len},}[ \\t]*$`,
      "m",
    );
    const rest = user.slice(innerStart);
    const closeMatch = closeRe.exec(rest);
    if (!closeMatch) return null;
    return {
      fence,
      content: rest.slice(0, closeMatch.index),
    };
  }

  it("outer fence is strictly longer than any inner backtick run, for both initial-source and repair-candidate (3, 4, 16)", () => {
    for (const innerRun of [3, 4, 16]) {
      const innerFence = "`".repeat(innerRun) + "x\ncontent\n" + "`".repeat(innerRun);

      const stage4 = buildStage4Prompt(
        sampleModule,
        ["src/a.ts#x"],
        "sym",
        innerFence,
        "en",
      );
      const sourceBlock = outerFenceFor(stage4.user, "# Source code");
      expect(sourceBlock, `inner run ${innerRun} (initial-source)`).toBeDefined();
      expect(sourceBlock!.fence.length, `inner run ${innerRun} (initial-source)`)
        .toBeGreaterThan(innerRun);
      expect(sourceBlock!.content).toContain(innerFence);

      const repair = buildRepairPrompt(
        sampleModule,
        ["src/a.ts#x"],
        "sym",
        "src content",
        `prior\n${innerFence}\nrest`,
        [{ code: "empty_body", message: "x", location: "body" }],
        60_000,
        "en",
      );
      const candBlock = outerFenceFor(repair.user, "# Prior candidate");
      expect(candBlock, `inner run ${innerRun} (repair-candidate)`).toBeDefined();
      expect(candBlock!.fence.length, `inner run ${innerRun} (repair-candidate)`)
        .toBeGreaterThan(innerRun);
      expect(candBlock!.content).toContain(innerFence);
    }
  });

  it("60,000-character backtick run in source does not amplify the user prompt past a bounded envelope (R3 amplification fix)", () => {
    // The pathological case: 60,000 consecutive backticks in the
    // source. The previous selector returned a 60,001-character
    // fence, inflating the user prompt to ~181,494 chars. The fix
    // caps wrapper growth by selecting tildes (zero tildes in the
    // content) and emitting a small fence.
    const run = "`".repeat(60_000);
    const stage4 = buildStage4Prompt(
      sampleModule,
      ["src/a.ts#x"],
      "sym",
      run,
      "en",
    );
    const sourceBlock = outerFenceFor(stage4.user, "# Source code");
    expect(sourceBlock).toBeDefined();
    // Tildes are now the chosen delimiter (backticks have a
    // pathological run); the fence is the minimum 3 tildes.
    expect(sourceBlock!.fence.startsWith("~")).toBe(true);
    expect(sourceBlock!.fence.length).toBeLessThanOrEqual(64);
    // The content is preserved (60,000 backticks) — no bounded
    // encoding was needed because tildes offered a safe fence.
    expect(sourceBlock!.content).toContain(run);
    // The wrapper growth is bounded: even though the content is
    // 60,000 chars, the total user prompt must not exceed the
    // content size by more than a small constant factor (other
    // prompt sections contribute, but the wrapper itself is now
    // ~10 chars instead of ~120,000).
    const wrapperOverhead =
      stage4.user.length - run.length - (stage4.user.length - stage4.user.indexOf(run) - run.length);
    // Rough check: the content+wrapper should not be ~120,000 chars
    // larger than the content alone.
    expect(stage4.user.length).toBeLessThan(run.length + 50_000);
    // The unused-var assignment is fine; the value documents the
    // wrapper contribution to the user prompt.
    void wrapperOverhead;

    // Same for the repair prior-candidate block. Use a larger
    // maxCandidateChars so the 60k-backtick run is not sliced
    // before it reaches the wrap helper — the test's intent is to
    // verify the wrapper behavior, not the slice budget.
    const repair = buildRepairPrompt(
      sampleModule,
      ["src/a.ts#x"],
      "sym",
      "src content",
      `prior\n${run}\nrest`,
      [{ code: "empty_body", message: "x", location: "body" }],
      200_000,
      "en",
    );
    const candBlock = outerFenceFor(repair.user, "# Prior candidate");
    expect(candBlock).toBeDefined();
    expect(candBlock!.fence.startsWith("~")).toBe(true);
    expect(candBlock!.fence.length).toBeLessThanOrEqual(64);
    expect(candBlock!.content).toContain(run);
    expect(repair.user.length).toBeLessThan(run.length + 50_000);
  });

  it("60,000-character tilde run also bounded (symmetric to the backtick case)", () => {
    const run = "~".repeat(60_000);
    const stage4 = buildStage4Prompt(
      sampleModule,
      ["src/a.ts#x"],
      "sym",
      run,
      "en",
    );
    const sourceBlock = outerFenceFor(stage4.user, "# Source code");
    expect(sourceBlock).toBeDefined();
    // The cheaper character is now backticks (zero backtick runs in
    // the content); the fence is backticks.
    expect(sourceBlock!.fence.startsWith("`")).toBe(true);
    expect(sourceBlock!.fence.length).toBeLessThanOrEqual(64);
    expect(sourceBlock!.content).toContain(run);
    expect(stage4.user.length).toBeLessThan(run.length + 50_000);
  });

  it("pathological case where BOTH characters have long runs uses bound-encoded tildes with no run longer than the fence", () => {
    // Both backticks AND tildes have 1,000-character runs in the
    // content. Tildes are picked (less common in real source) and
    // bound-encoded so no run in the encoded content is longer
    // than the fence. The CommonMark rule (closing fence must be
    // ≥ opening fence) means the encoded content cannot close the
    // capped tilde fence.
    const content = "`".repeat(1_000) + "\n" + "~".repeat(1_000);
    const stage4 = buildStage4Prompt(
      sampleModule,
      ["src/a.ts#x"],
      "sym",
      content,
      "en",
    );
    const sourceBlock = outerFenceFor(stage4.user, "# Source code");
    expect(sourceBlock).toBeDefined();
    expect(sourceBlock!.fence.startsWith("~")).toBe(true);
    expect(sourceBlock!.fence.length).toBeLessThanOrEqual(64);
    // No run of either delimiter in the encoded content is longer
    // than the fence (so no run can close it).
    const encoded = sourceBlock!.content;
    const backtickRuns = [...encoded.matchAll(/`+/g)].map((m) => m[0].length);
    const tildeRuns = [...encoded.matchAll(/~+/g)].map((m) => m[0].length);
    for (const r of backtickRuns) {
      expect(r, `backtick run length ${r} should be < fence length ${sourceBlock!.fence.length}`).toBeLessThan(sourceBlock!.fence.length);
    }
    for (const r of tildeRuns) {
      expect(r, `tilde run length ${r} should be < fence length ${sourceBlock!.fence.length}`).toBeLessThan(sourceBlock!.fence.length);
    }
  });
});

describe("prompts — zero-key stage-4 instructions are non-contradictory", () => {
  // Defect 2 (contradictory zero-key instructions): the previous branch
  // said "emit no anchors" and "the page is rejected without
  // closed-list anchors" — a direct contradiction. The replacement
  // must spell out the contract and still require the page opening.
  //
  // Defect 5 (zero-key fake marker regression): the previous wording
  // contained the exact copyable placeholder
  //   `<!-- lw:anchors ... -->`
  // in the zero-key branch — an LLM reading that line can copy the
  // placeholder verbatim into its output, producing a page that
  // carries a fake anchor marker. The fix replaces the placeholder
  // with descriptive non-copyable wording. The strengthened test
  // asserts BOTH the contract is present AND the prompt does not
  // ship any complete fake marker, ellipsis placeholder offered as
  // marker syntax, anchor requirement, or relaxed opening rule.
  it("zero-key branch is non-contradictory, present, and still requires the page opening", () => {
    const r = buildStage4Prompt(sampleModule, [], "sym", "src content", "en");
    const repair = buildRepairPrompt(
      sampleModule,
      [],
      "sym",
      "src content",
      "prior",
      [{
        code: "missing_page_opening",
        message: 'page opening "How it fits" contains a heading',
        location: "body",
        offending: "### Test environment",
      }],
      60_000,
      "en",
    );
    // Contradictory text must be gone.
    expect(r.user).not.toMatch(/rejected without closed-list anchors/i);
    expect(r.user).not.toMatch(/the page is rejected without/i);
    // Contract must be present.
    expect(r.user).toMatch(/zero-key contract/i);
    expect(r.user).toMatch(/no extracted canonical symbols/i);
    expect(r.user).toMatch(/still generate a useful/i);
    expect(r.user).toMatch(/required page opening/i);
    expect(r.user).toMatch(/unanchored implementation sections/i);
    expect(r.user).toMatch(/no frontmatter anchor entries/i);
    // The contract still bans emitting any anchor-surface marker.
    expect(r.user).toMatch(/no\s+(?:control-marker\s+comments?|lw:anchors)/i);
    // Page-opening requirement is NOT relaxed.
    expect(r.system).toMatch(/H1 human-meaningful title/);
    expect(r.system).toMatch(/When to use this page/);
    expect(r.system).toMatch(/How it fits/);
    expect(`${r.system}\n${repair.system}\n${repair.user}`).not.toMatch(
      /before the first anchored (?:implementation )?section/i,
    );
    expect(repair.user).toMatch(/before the first implementation section/i);
  });

  it("zero-key branch never embeds a complete copyable lw:anchors marker, ellipsis placeholder, or anchor requirement", () => {
    const r = buildStage4Prompt(sampleModule, [], "sym", "src content", "en");
    // No complete opening or closing lw:anchors control marker in
    // either prompt message — the LLM must not see a copyable
    // fake/ellipsis anchor marker it could copy verbatim.
    expect(r.user).not.toMatch(/<!--\s*lw:anchors\b/);
    expect(r.user).not.toMatch(/<!--\s*\/lw:anchors\b/);
    expect(r.system).not.toMatch(/<!--\s*lw:anchors\b/);
    expect(r.system).not.toMatch(/<!--\s*\/lw:anchors\b/);
    // No ellipsis-style placeholder offered as marker syntax.
    // "..." or "…" appearing as a KEY or as a list-continuation
    // inside a marker is banned by the system prompt already; the
    // zero-key branch must not introduce a NEW copyable marker
    // that includes either glyph.
    expect(r.user).not.toMatch(/<!--[^>]*?\.{3}[^>]*?-->/);
    expect(r.user).not.toMatch(/<!--[^>]*?…[^>]*?-->/);
    // No anchor requirement is asserted for an empty closed list.
    // The page opening rule is in the system prompt and remains
    // unchanged; the zero-key branch must not add a new "you must
    // emit at least one anchor" line.
    expect(r.user).not.toMatch(/at least one anchor/i);
    expect(r.user).not.toMatch(/must include.*anchor/i);
    // Useful unanchored documentation remains required.
    expect(r.user).toMatch(/useful/i);
    expect(r.user).toMatch(/unanchored implementation sections/i);
  });
});

describe("prompts — repair prompt never ships a copyable lw:manual marker through structured error messages", () => {
  // Defect 2 (copyable lw:manual marker in repair prompts): the
  // `model_invented_manual` error's message and offending carry the
  // exact copyable `<!-- lw:manual -->` marker byte-for-byte, and
  // the previous buildRepairPrompt interpolated them into the
  // structured error line unchanged. R3 evidence: the LLM copied
  // the marker verbatim through every repair attempt. The fix
  // neutralizes both the message and the offending text before
  // they reach the prompt. The regression test below supplies a
  // `model_invented_manual` error whose message and offending
  // both contain the marker and asserts zero copyable opening or
  // closing manual markers survive in either the system or the
  // user prompt.
  it("model_invented_manual with marker in both message and offending → zero copyable lw:manual markers in either prompt message", () => {
    const marker = "<!-- lw:manual -->";
    const closing = "<!-- /lw:manual -->";
    const errs = [
      {
        code: "model_invented_manual" as const,
        message: `artifact contains a ${marker} block; these are reserved for human content (rule #6) and the orchestrator is the only one allowed to re-inject them from the previous version of the page`,
        location: "body" as const,
        offending: marker,
      },
    ];
    const r = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "sym",
      "src content",
      "prior",
      errs,
      60_000,
      "en",
    );
    // Defense-in-depth: neither prompt message may contain a
    // complete copyable opening OR closing lw:manual control
    // comment, even when the source data was full of them.
    expect(r.system).not.toMatch(/<!--\s*lw:manual\b/);
    expect(r.system).not.toMatch(/<!--\s*\/lw:manual\b/);
    expect(r.user).not.toMatch(/<!--\s*lw:manual\b/);
    expect(r.user).not.toMatch(/<!--\s*\/lw:manual\b/);
    // The structured error line is present (so the LLM still
    // learns about the failure) but the marker bytes are gone.
    expect(r.user).toContain("[model_invented_manual]");
    // Sanity: the literal strings passed by the test are
    // present in the source input — confirms the assertion
    // would have caught the regression.
    const neutralizedMessage = neutralizeUntrustedControlMarkers(
      errs[0]!.message,
    );
    expect(neutralizedMessage).not.toContain(marker);
    expect(neutralizedMessage).not.toContain(closing);
  });
});

describe("prompts — repair prompt never ships a copyable lw:* marker through ACTION branches", () => {
  // Review follow-up: the previous `model_invented_manual` fix
  // neutralized the leading `${e.message}` and `${e.offending}` on
  // the structured line, but several ACTION branches re-interpolated
  // the RAW value into the action text — the `missing_page_opening`
  // branch for `e.message`, and the `anchor_outside_closed_list`,
  // `missing_closed_key`, `duplicate_anchor` branches for
  // `e.offending`. The action branches now interpolate the safe
  // values, and a defense-in-depth pass re-neutralizes the COMPLETED
  // line. This regression exercises the most exposed path
  // (`missing_page_opening` with a marker-bearing message) and
  // asserts zero complete copyable opening or closing `lw:*`
  // control comment survives in either prompt message.
  it("missing_page_opening with marker-bearing message → no copyable lw:* control comment in either prompt message", () => {
    const marker = "<!-- lw:manual -->";
    const closing = "<!-- /lw:manual -->";
    const errs = [
      {
        code: "missing_page_opening" as const,
        // Realistic validator output that itself embeds a copyable
        // marker (e.g. when the failing page also triggered a
        // model_invented_manual check earlier). The previous
        // ACTION branch interpolated this message raw into the
        // directive text and shipped the marker through.
        message: `page opening H1 is missing or wrong; saw a copy of ${marker} on line 4`,
        location: "body" as const,
      },
    ];
    const r = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "sym",
      "src content",
      "prior",
      errs,
      60_000,
      "en",
    );
    // Neither prompt message may contain a complete copyable
    // opening OR closing lw:* control comment, anywhere.
    expect(r.system).not.toMatch(/<!--\s*lw:[a-zA-Z0-9_-]+/);
    expect(r.system).not.toMatch(/<!--\s*\/lw:[a-zA-Z0-9_-]+/);
    expect(r.user).not.toMatch(/<!--\s*lw:[a-zA-Z0-9_-]+/);
    expect(r.user).not.toMatch(/<!--\s*\/lw:[a-zA-Z0-9_-]+/);
    // The specific marker the test injected is also gone.
    expect(r.user).not.toContain(marker);
    expect(r.user).not.toContain(closing);
    // The structured error line is still present (so the LLM
    // still learns about the failure) and the safe-substituted
    // message survives (with the marker replaced by spaces of
    // equal length).
    expect(r.user).toContain("[missing_page_opening]");
    expect(r.user).toContain("SPECIFIC FAILURE:");
    // The marker characters are gone but the surrounding prose
    // is preserved (proves the fix is not over-aggressive).
    expect(r.user).toMatch(/saw a copy of\s+on line 4/);
  });

  it("missing_closed_key with marker-bearing offending → no copyable lw:* control comment in either prompt message", () => {
    const marker = "<!-- lw:manual -->";
    const errs = [
      {
        code: "missing_closed_key" as const,
        message: "closed-list key not declared",
        location: "frontmatter" as const,
        // Defensive: an `offending` value that itself embeds a
        // copyable marker (e.g. when a hand-written fixture uses
        // the marker as a placeholder). The action branch used
        // to interpolate raw `e.offending`.
        offending: marker,
      },
    ];
    const r = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "sym",
      "src content",
      "prior",
      errs,
      60_000,
      "en",
    );
    expect(r.system).not.toMatch(/<!--\s*lw:[a-zA-Z0-9_-]+/);
    expect(r.user).not.toMatch(/<!--\s*lw:[a-zA-Z0-9_-]+/);
    expect(r.user).not.toMatch(/<!--\s*\/lw:[a-zA-Z0-9_-]+/);
  });
});

describe("prompts — stage 5 flow placement and semantic key groups (R10.1 D)", () => {
  const flowCandidate: FlowCandidate = {
    slug: "cli-to-core",
    titleSeed: "Cli to Core",
    moduleIds: ["cli", "core"],
    seedKeys: ["src/cli.ts#run", "src/core.ts#batch", "src/store.ts#persist"],
    // R10.1 K groups (union = closed list).
    entryKeys: ["src/cli.ts#run"],
    boundaryKeys: ["src/core.ts#batch"],
    sinkKeys: ["src/store.ts#persist"],
    otherProductKeys: [],
    auxiliaryKeys: [],
    signals: { entry: ["cli"], persistence: ["core"], external: [] },
  };
  const flowClosedKeys = ["src/cli.ts#run", "src/core.ts#batch", "src/store.ts#persist"];
  const flowGroups = {
    entryKeys: ["src/cli.ts#run"],
    boundaryKeys: ["src/core.ts#batch"],
    sinkKeys: ["src/store.ts#persist"],
  };
  const stage5Repair = (errors: ReadonlyArray<ArtifactValidationError>) =>
    buildStage5RepairPrompt(
      flowCandidate,
      flowClosedKeys,
      "openings",
      "symbols",
      "source",
      "prior",
      errors,
      60_000,
    );

  it("FLOW_PAGE_PROMPT_RULES carries placement, per-section coverage, and group citation in both stage-5 prompts", () => {
    const initial = buildStage5Prompt(flowCandidate, flowClosedKeys, "openings", "symbols", "source");
    const repair = stage5Repair([]);
    for (const rule of FLOW_PAGE_PROMPT_RULES) {
      expect(initial.system).toContain(rule);
      expect(repair.system).toContain(rule);
    }
    const rules = FLOW_PAGE_PROMPT_RULES.join("\n");
    expect(rules).toContain("H3+ subsection");
    expect(rules).toContain("must carry at least one `lw:anchors` marker of its own");
    expect(rules).toContain("entry/boundary/sink key groups");
  });

  // Benchmark 0.2.1: bullets in `Purpose`/`Failure and recovery` caused most
  // of the flow retries. The strict contract rejects them there and accepts
  // them in `Invariants` — the prompt must say so where the model looks.
  it("states where a bullet list is rejected, in the rules and in the rejection list", () => {
    const initial = buildStage5Prompt(flowCandidate, flowClosedKeys, "openings", "symbols", "source");
    const repair = stage5Repair([]);
    const rules = FLOW_PAGE_PROMPT_RULES.join("\n");

    const purposeRule = FLOW_PAGE_PROMPT_RULES.find((rule) => rule.startsWith("- `Purpose`:"));
    const failureRule = FLOW_PAGE_PROMPT_RULES.find((rule) =>
      rule.startsWith("- `Failure and recovery`:"));
    expect(purposeRule).toMatch(/bullet list in this section is REJECTED/);
    expect(failureRule).toMatch(/bullet list in this section is REJECTED/);
    // Invariants keeps accepting either shape.
    expect(rules).toContain("`Invariants`: prose or bullets");

    // The initial prompt also lists it under REJECTION CRITERIA (the repair
    // prompt has no such list — it carries the shared rules plus per-error
    // directives, and the rules above already reached it).
    expect(initial.system).toContain(
      "`Purpose` or `Failure and recovery` written as a bullet list instead of prose paragraphs",
    );
    expect(repair.system).toContain(purposeRule!);
    expect(repair.system).toContain(failureRule!);
  });

  it("carries the anti-meta rule and no excerpt hedge in both stage-5 prompts", () => {
    const initial = buildStage5Prompt(flowCandidate, flowClosedKeys, "openings", "symbols", "source");
    const repair = stage5Repair([]);
    for (const prompt of [initial.system, repair.system]) {
      expect(prompt).toContain("never narrate what the excerpt does or does not contain");
      expect(prompt).not.toContain("does not establish exhaustive behavior");
      // Inventory authority is shared with the module prompts (same constant).
      expect(prompt).toContain(INVENTORY_AUTHORITY_PROMPT_RULE);
    }
  });

  it("buildStage5Prompt renders the semantic key groups when supplied", () => {
    const r = buildStage5Prompt(flowCandidate, flowClosedKeys, "openings", "symbols", "source", "en", undefined, flowGroups);
    expect(r.user).toContain("# Semantic key groups");
    expect(r.user).toContain("- entry keys: src/cli.ts#run");
    expect(r.user).toContain("- boundary keys: src/core.ts#batch");
    expect(r.user).toContain("- sink keys: src/store.ts#persist");
  });

  it("buildStage5Prompt omits the groups block when groups are not supplied", () => {
    const r = buildStage5Prompt(flowCandidate, flowClosedKeys, "openings", "symbols", "source");
    expect(r.user).not.toContain("# Semantic key groups");
  });

  it("group keys outside the closed list are not rendered (treated as absent)", () => {
    const r = buildStage5Prompt(flowCandidate, flowClosedKeys, "openings", "symbols", "source", "en", undefined, {
      entryKeys: ["src/ghost.ts#nope"],
      boundaryKeys: ["src/core.ts#batch", "src/ghost.ts#nope"],
      sinkKeys: [],
    });
    expect(r.user).toContain("- boundary keys: src/core.ts#batch");
    expect(r.user).not.toContain("src/ghost.ts#nope");
    expect(r.user).not.toContain("- entry keys:");
    expect(r.user).not.toContain("- sink keys:");
  });

  it("repair prompt carries ACTION directives for the three new placement/tier codes", () => {
    const repair = stage5Repair([
      {
        code: "anchor_in_disallowed_section",
        message:
          'lw:anchors marker is inside section "Diagram"; flow pages allow anchor markers only inside "Purpose", "Ordered flow", and "Failure and recovery"',
        location: "section",
        offending: "<!-- lw:anchors src/core.ts#batch -->",
      },
      {
        code: "anchor_missing_in_required_section",
        message: 'required flow section "Ordered flow" carries no lw:anchors marker',
        location: "section",
        offending: "Ordered flow",
      },
      {
        code: "anchor_missing_required_tier",
        message:
          'the page cites no key from the "boundary" group — cite at least one of its closed-list keys (src/core.ts#batch)',
        location: "section",
        offending: "boundary",
      },
    ]);
    expect(repair.user).toMatch(/anchor_in_disallowed_section.*ACTION: relocate this marker/s);
    expect(repair.user).toMatch(/anchor_missing_in_required_section.*ACTION: the named section carries no/s);
    expect(repair.user).toMatch(/anchor_missing_required_tier.*ACTION: the named semantic group has no cited key\. PICK one key/s);
    // The D1 offending was a full marker: no copyable lw:* comment survives.
    expect(repair.user).not.toMatch(/<!--\s*lw:[a-zA-Z0-9_-]+/);
    expect(repair.system).not.toMatch(/<!--\s*lw:[a-zA-Z0-9_-]+/);
  });

  it("stage-5 repair prompt states the upper-bound citation rule and carries no strict-completeness instruction", () => {
    const variants = [
      stage5Repair([]), // attempt 1 of 1 → final attempt (audit block rendered)
      buildStage5RepairPrompt(
        flowCandidate,
        flowClosedKeys,
        "openings",
        "symbols",
        "source",
        "prior",
        [],
        60_000,
        "en",
        { attempt: 1, total: 3 }, // non-final audit line rendered
      ),
    ];
    for (const r of variants) {
      // The citation rule, verbatim-consistent with the initial prompt.
      expect(r.system).toContain("CITE ONLY WHAT THE PAGE USES");
      expect(r.system).toContain("upper bound, not an assignment");
      expect(r.system).toContain("a key cited on only one side is rejected");
      expect(r.system).toContain("Closed-list keys the page does not use are fine");
      // No strict-completeness leftover (system or user, either variant).
      expect(r.system).not.toMatch(/every closed key/i);
      expect(r.user).not.toMatch(/every closed key/i);
      expect(r.system).not.toMatch(/equal the closed list/i);
      expect(r.user).not.toMatch(/equal the closed list/i);
      expect(r.system).not.toContain("COMPLETENESS IS TWO INDEPENDENT REQUIREMENTS");
      expect(r.user).not.toContain("COMPLETENESS IS TWO INDEPENDENT REQUIREMENTS");
    }
    expect(variants[0]!.user).toContain("Every CITED key declared in the frontmatter anchors list");
    expect(variants[0]!.user).toContain("Every CITED key declared exactly once across");
    expect(variants[1]!.user).toContain("every CITED key in frontmatter");
    expect(variants[1]!.user).toContain("every CITED key exactly once across section markers");
  });

  it("stage-5 repair prompt renders the semantic key groups when supplied", () => {
    const r = buildStage5RepairPrompt(
      flowCandidate,
      flowClosedKeys,
      "openings",
      "symbols",
      "source",
      "prior",
      [],
      60_000,
      "en",
      { attempt: 1, total: 2 },
      undefined,
      flowGroups,
    );
    expect(r.user).toContain("# Semantic key groups");
    expect(r.user).toContain("- entry keys: src/cli.ts#run");
    expect(r.user).toContain("- boundary keys: src/core.ts#batch");
    expect(r.user).toContain("- sink keys: src/store.ts#persist");
    // The tier rule: at least one cited key from each listed non-empty group.
    expect(r.user).toContain("at least one key from EACH group listed below");
  });

  it("stage-5 repair prompt omits the groups block when not supplied and filters out-of-list keys", () => {
    expect(stage5Repair([]).user).not.toContain("# Semantic key groups");
    const r = buildStage5RepairPrompt(
      flowCandidate,
      flowClosedKeys,
      "openings",
      "symbols",
      "source",
      "prior",
      [],
      60_000,
      "en",
      { attempt: 1, total: 2 },
      undefined,
      {
        entryKeys: ["src/ghost.ts#nope"],
        boundaryKeys: ["src/core.ts#batch", "src/ghost.ts#nope"],
        sinkKeys: [],
      },
    );
    expect(r.user).toContain("- boundary keys: src/core.ts#batch");
    expect(r.user).not.toContain("src/ghost.ts#nope");
    expect(r.user).not.toContain("- entry keys:");
    expect(r.user).not.toContain("- sink keys:");
  });

  it("buildStage5Prompt renders the fixed section-assignment table and swaps the PRIMARY-SECTION RULE wording", () => {
    const sectionMap = new Map<string, "purpose" | "ordered-flow" | "failure-and-recovery">([
      ["src/cli.ts#run", "purpose"],
      ["src/core.ts#batch", "ordered-flow"],
      ["src/store.ts#persist", "failure-and-recovery"],
    ]);
    const r = buildStage5Prompt(
      flowCandidate,
      flowClosedKeys,
      "openings",
      "symbols",
      "source",
      "en",
      undefined,
      undefined,
      sectionMap,
    );
    expect(r.user).toContain("# Section assignment (AUTHORITATIVE AND FIXED");
    expect(r.user).toContain("- Purpose: src/cli.ts#run");
    expect(r.user).toContain("- Ordered flow: src/core.ts#batch");
    expect(r.user).toContain("- Failure and recovery: src/store.ts#persist");
    expect(r.system).toMatch(/SECTION ASSIGNMENT IS FIXED, NOT YOURS TO DECIDE/);
    expect(r.system).not.toMatch(/PRIMARY-SECTION RULE/);
  });

  it("buildStage5Prompt omits the section-assignment table and keeps the old PRIMARY-SECTION RULE when no map is supplied", () => {
    const r = buildStage5Prompt(flowCandidate, flowClosedKeys, "openings", "symbols", "source");
    expect(r.user).not.toContain("# Section assignment");
    expect(r.system).toMatch(/PRIMARY-SECTION RULE/);
  });

  it("buildStage5RepairPrompt renders the same fixed section-assignment table", () => {
    const sectionMap = new Map<string, "purpose" | "ordered-flow" | "failure-and-recovery">([
      ["src/cli.ts#run", "purpose"],
      ["src/core.ts#batch", "ordered-flow"],
      ["src/store.ts#persist", "failure-and-recovery"],
    ]);
    const r = buildStage5RepairPrompt(
      flowCandidate,
      flowClosedKeys,
      "openings",
      "symbols",
      "source",
      "prior",
      [],
      60_000,
      "en",
      { attempt: 1, total: 2 },
      undefined,
      undefined,
      sectionMap,
    );
    expect(r.user).toContain("# Section assignment (AUTHORITATIVE AND FIXED");
    expect(r.user).toContain("- Purpose: src/cli.ts#run");
    expect(r.system).toMatch(/SECTION ASSIGNMENT IS FIXED, NOT YOURS TO DECIDE/);
  });

  it("stage-5 repair missing_closed_key block offers add-or-remove (no forced completeness)", () => {
    const r = stage5Repair([
      {
        code: "missing_closed_key",
        message: 'closed-list key "src/core.ts#batch" is not declared in any section marker',
        location: "section",
        offending: "src/core.ts#batch",
      },
    ]);
    expect(r.user).toContain("[missing_closed_key] (section): 1 exact closed-list key is missing");
    expect(r.user).toContain("REMOVE it from the opposite location");
  });

  it("stage-5 initial prompt pins the flows hub link to the bare `index.md` target", () => {
    const initial = buildStage5Prompt(flowCandidate, flowClosedKeys, "openings", "symbols", "source");
    // E2E evidence: the model generalized the module-link form `../<moduleId>.md`
    // to the hub and wrote `../index.md`, which resolves outside `flows/`.
    expect(initial.system).toContain("[How it works](index.md)");
    expect(initial.system).toContain("the bare `index.md` target");
    expect(initial.system).toContain("NEVER write `../index.md`");
  });

  it("stage-5 repair prompt carries the hub rule and the broken_internal_link bare-target ACTION (final and non-final)", () => {
    // Step 2a: the verify-code split preserves the real issue code — the
    // bare-target ACTION now hangs on `broken_internal_link` itself, while
    // legacy `verify_failed` keeps only a generic directive.
    const errors: ReadonlyArray<ArtifactValidationError> = [
      {
        code: "broken_internal_link",
        message:
          'the link "../index.md" in "Related pages" resolves to livewiki/index.md, which does not exist',
        location: "section",
        offending: "../index.md",
      },
    ];
    const variants = [
      stage5Repair(errors), // attempt 1 of 1 → final attempt (audit block rendered)
      buildStage5RepairPrompt(
        flowCandidate,
        flowClosedKeys,
        "openings",
        "symbols",
        "source",
        "prior",
        errors,
        60_000,
        "en",
        { attempt: 1, total: 3 }, // non-final audit line rendered
      ),
    ];
    for (const r of variants) {
      // The shared FLOW_PAGE_PROMPT_RULES carry the hub rule in the system prompt.
      expect(r.system).toContain("[How it works](index.md)");
      expect(r.system).toContain("NEVER write `../index.md`");
      // The per-error ACTION directs the bare target for broken_internal_link.
      expect(r.user).toMatch(/broken_internal_link.*ACTION: every link target must resolve/s);
      expect(r.user).toContain("must be the bare `index.md` target");
    }
  });

  it("legacy verify_failed renders a generic ACTION (old checkpoints)", () => {
    const repair = stage5Repair([
      {
        code: "verify_failed",
        message: "verify rejected the page",
        location: "body",
      },
    ]);
    expect(repair.user).toMatch(/verify_failed.*ACTION: fix the exact verify issue named in the error\./s);
  });

  it("neither stage-5 prompt asks the LLM to write a Diagram section or mention Mermaid (Priority-0 fix)", () => {
    // The diagram is generated deterministically by generateFlowDiagram
    // (flow-diagram.ts) and inserted by the orchestrator — the LLM writes
    // prose only. Module-vs-symbol diagram granularity is a rendering
    // decision made in code now, not a prompt instruction.
    const initial = buildStage5Prompt(flowCandidate, flowClosedKeys, "openings", "symbols", "source");
    const repair = stage5Repair([]);
    for (const r of [initial, repair]) {
      expect(r.system).toMatch(/prose only/i);
      expect(r.system).not.toContain("MODULE-granularity nodes");
      expect(r.system).not.toContain("mermaid fence holding the companion diagram source");
    }
  });
});

describe("prompts — buildTopicRefinePrompt (Workstream B)", () => {
  const proposals = [
    {
      title: "CLI and core overview",
      intent: "Explains how CLI and core coordinate request handling.",
      modules: ["cli", "core"],
      flows: ["cli-to-core"],
      groups: {
        contract: ["src/cli.ts#run"],
        state: ["src/core.ts#store"],
        output: ["src/core.ts#emit"],
        failure: ["src/core.ts#recover"],
      },
    },
  ];

  it("frames the LLM's role as a narrow refine pass, not a from-scratch proposer", () => {
    const r = buildTopicRefinePrompt(proposals, 4, "en");
    expect(r.system).toMatch(/ALREADY-VALID, closed topic plan/i);
    expect(r.system).toMatch(/You may NOT add a module, flow, or anchor/i);
    expect(r.system).toMatch(/You may NOT invent a new topic from scratch/i);
    expect(r.system).not.toMatch(/name a small set of concept pages/i); // old propose-from-scratch framing is gone
  });

  it("embeds the deterministic proposals verbatim as the editable input", () => {
    const r = buildTopicRefinePrompt(proposals, 4, "en");
    expect(r.user).toContain("CLI and core overview");
    expect(r.user).toContain("src/cli.ts#run");
    expect(r.user).toContain("src/core.ts#recover");
  });

  it("caps the produced topic count via the maxTopics parameter", () => {
    const r = buildTopicRefinePrompt(proposals, 2, "en");
    expect(r.system).toContain("Produce at most 2 topics.");
  });

  it("uses the same {topics:[...]} schema the validator already parses", () => {
    const r = buildTopicRefinePrompt(proposals, 4, "en");
    expect(r.system).toMatch(/\{"topics":\[\{"title":"\.\.\."/);
  });
});

// === Step 2b: rationale evidence block ===

describe("prompts — rationale evidence block (Step 2b)", () => {
  const rationale =
    "- [why] src/auth.ts:3 (src/auth.ts#login): WHY: tokens rotate to limit replay windows\n" +
    "- [todo] src/auth.ts:9 (file-level): TODO: audit refresh path";

  const sampleTopic: TopicCandidate = {
    title: "Auth lifecycle",
    intent: "Explain how authentication state is created and refreshed",
    modules: ["auth"],
    flows: [],
    groups: { contract: ["src/auth.ts#login"], state: [], output: [], failure: [] },
    planOrder: 1,
    evidenceHash: "abc123",
    slug: "auth-lifecycle",
    seedKeys: ["src/auth.ts#login"],
  };

  it("stage-4 initial prompt renders the block between symbol table and source", () => {
    const r = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code", "en", undefined, rationale);
    const blockIndex = r.user.indexOf("# Rationale evidence");
    expect(blockIndex).toBeGreaterThan(-1);
    expect(r.user).toContain("WHY: tokens rotate to limit replay windows");
    // Order: symbol table → rationale evidence → source code.
    expect(r.user.indexOf("# Symbol table:")).toBeLessThan(blockIndex);
    expect(r.user.indexOf("# Source code (truncated")).toBeGreaterThan(blockIndex);
    // System prompt pins rationale text out of the anchor-key space.
    expect(r.system).toMatch(/NEVER a source of anchor keys/);
  });

  it("stage-4 repair prompt renders the block", () => {
    const r = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "sym",
      "code",
      "prior",
      [],
      1000,
      "en",
      { attempt: 1, total: 1 },
      undefined,
      rationale,
    );
    expect(r.user).toContain("# Rationale evidence");
    expect(r.user).toContain("TODO: audit refresh path");
    expect(r.system).toMatch(/NEVER a source of anchor keys/);
  });

  it("topic initial and repair prompts render the block", () => {
    const initial = buildTopicPrompt(sampleTopic, "digest", "sym", "source", "en", undefined, rationale);
    expect(initial.user).toContain("# Rationale evidence");
    expect(initial.user.indexOf("# Symbol table")).toBeLessThan(initial.user.indexOf("# Rationale evidence"));
    expect(initial.user.indexOf("# Source evidence")).toBeGreaterThan(initial.user.indexOf("# Rationale evidence"));
    expect(initial.system).toMatch(/NEVER a source of anchor keys/);

    const repair = buildTopicRepairPrompt(
      sampleTopic,
      "digest",
      "sym",
      "source",
      "prior",
      [],
      1000,
      "en",
      { attempt: 1, total: 1 },
      undefined,
      rationale,
    );
    expect(repair.user).toContain("# Rationale evidence");
    expect(repair.system).toMatch(/NEVER a source of anchor keys/);
  });

  it("topic prompts carry the anti-meta rule and no excerpt hedge", () => {
    const initial = buildTopicPrompt(sampleTopic, "digest", "sym", "source", "en");
    expect(initial.system).toContain("never narrate what the excerpt does or does not contain");
    expect(initial.system).not.toContain("does not establish exhaustive behavior");
    // Inventory authority is shared with the module prompts (same constant).
    expect(initial.system).toContain(INVENTORY_AUTHORITY_PROMPT_RULE);
  });

  it("topic REPAIR prompt inherits the shared accuracy rules (no drift, #30 audit)", () => {
    const repair = buildTopicRepairPrompt(
      sampleTopic,
      "digest",
      "sym",
      "source",
      "prior",
      [],
      1000,
    );
    expect(repair.system).toContain(EXCEPTION_BRANCH_PROMPT_RULE);
    expect(repair.system).toContain(INVENTORY_AUTHORITY_PROMPT_RULE);
    expect(repair.system).toContain(BRANCH_PRECISION_PROMPT_RULE);
  });

  it("topic initial prompt shows a fenced frontmatter example with YAML block lists (dogfood run #3)", () => {
    // topic:f41eeea78a0d failed 4x with the list fields written as
    // comma-joined scalars — the prompt presented the accepted values
    // comma-joined and never showed the required YAML shape.
    const initial = buildTopicPrompt(sampleTopic, "digest", "sym", "source", "en");
    expect(initial.user).toContain("# Frontmatter syntax (concrete example");
    expect(initial.user).toContain("modules:\n  - auth\n");
    expect(initial.user).toContain("flows: []");
    expect(initial.user).toContain("anchors:\n  - src/auth.ts#login\n");
    expect(initial.user).toContain("NEVER a comma-joined scalar");
    // The ban rule lives in the shared TOPIC_PAGE_PROMPT_RULES, so the
    // initial AND repair system prompts inherit it without drift.
    expect(initial.system).toContain("one `- entry` line per value");
    expect(initial.system).toContain("modules: a, b, c");
    const repair = buildTopicRepairPrompt(
      sampleTopic,
      "digest",
      "sym",
      "source",
      "prior",
      [],
      1000,
    );
    expect(repair.system).toContain("one `- entry` line per value");
  });

  it("neutralizes lw:* control markers inside rationale text (never copyable anchor syntax)", () => {
    const poisoned = "- [hack] src/a.ts:1 (file-level): HACK: <!-- lw:anchors src/a.ts#fake --> must not survive";
    const r = buildStage4Prompt(sampleModule, ["src/a.ts#real"], "sym", "code", "en", undefined, poisoned);
    expect(r.user).toContain("# Rationale evidence");
    // The fake marker is whitespace-neutralized; the only copyable marker
    // syntax left in the prompt is the legit example built from real keys.
    expect(r.user).not.toContain("<!-- lw:anchors src/a.ts#fake -->");
    const markers = copyableAnchorMarkers(r.user).flat();
    expect(markers).not.toContain("src/a.ts#fake");
  });

  it("omits the block entirely when there is no rationale evidence", () => {
    const absent = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code", "en");
    expect(absent.user).not.toContain("# Rationale evidence");

    const empty = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code", "en", undefined, "");
    expect(empty.user).not.toContain("# Rationale evidence");

    const topic = buildTopicPrompt(sampleTopic, "digest", "sym", "source", "en");
    expect(topic.user).not.toContain("# Rationale evidence");
  });
});

// === Recovery tier (Component 1) — surgical repair prompt ===

describe("buildSurgicalRepairPrompt", () => {
  const failedPage = [
    "---",
    "title: Auth module",
    "owner: generated",
    "anchors:",
    "  - src/auth/login.ts#login",
    "---",
    "",
    "# Auth module",
    "",
    "This page documents authentication.",
    "",
    "## When to use this page",
    "",
    "- Review the login behavior.",
    "- Change the session handling.",
    "",
    "## How it fits",
    "",
    "Auth is one part of the repository.",
    "",
    "## Details",
    "",
    "<!-- lw:anchors src/auth/login.ts#login -->",
    "",
  ].join("\n");

  const eligibleErrors: ArtifactValidationError[] = [
    {
      code: "empty_section",
      message: "section marker at offset 200 has no real prose before the next heading/marker/end of page",
      location: "section",
      sectionSlug: "details",
    },
  ];

  it("names ONLY the affected sections and states the byte-identical contract", () => {
    const r = buildSurgicalRepairPrompt("module", failedPage, eligibleErrors, "", "en");
    expect(r.system).toContain('Change ONLY the content of these sections: "Details".');
    expect(r.system).toContain("byte-for-byte identical");
    expect(r.user).toContain('# Sections you may change (everything else stays byte-for-byte identical):');
    expect(r.user).toContain('- "Details"');
    expect(r.user).not.toContain('"How it fits"\n- ');
  });

  it("renders each error with its ACTION directive from the closed repair contract", () => {
    const r = buildSurgicalRepairPrompt("module", failedPage, eligibleErrors, "", "en");
    expect(r.user).toContain("- [empty_section] (section \"details\")");
    expect(r.user).toContain("ACTION:");
  });

  it("carries ONLY the supplied evidence slice — no closed list, no full symbol table", () => {
    const slice = "- src/auth/login.ts#login (function): login()\n\n// === src/auth/login.ts#login (src/auth/login.ts:1-1) ===\nexport function login() {}";
    const r = buildSurgicalRepairPrompt("module", failedPage, eligibleErrors, slice, "en");
    expect(r.user).toContain(slice.split("\n")[0]!);
    expect(r.user).not.toContain("# Closed list of canonical keys");
    expect(r.user).not.toContain("# Symbol table:");
    expect(r.user).not.toContain("# Source code (truncated by token budget");
  });

  it("size stays bounded by the inputs (page + capped evidence + small scaffold)", () => {
    const evidence = "x".repeat(12_000);
    const r = buildSurgicalRepairPrompt("module", failedPage, eligibleErrors, evidence, "en");
    // Scaffold (contract + error lines + headers) is small; the total must
    // track page + evidence, never the multi-hundred-KB full-context shape.
    expect(r.user.length).toBeLessThan(failedPage.length + 12_000 + 4_000);
    expect(r.system.length).toBeLessThan(4_000);
  });

  it("embeds the failed page with its lw:anchors markers verbatim (the syntax to preserve)", () => {
    const r = buildSurgicalRepairPrompt("module", failedPage, eligibleErrors, "", "en");
    expect(r.user).toContain("<!-- lw:anchors src/auth/login.ts#login -->");
  });

  it("says so explicitly when the affected sections cite no anchor keys", () => {
    const r = buildSurgicalRepairPrompt("module", failedPage, eligibleErrors, "", "en");
    expect(r.user).toContain("(no anchor keys are cited in the affected sections — no evidence slice)");
  });

  it("resolves the section name from a section-level missing_page_opening message", () => {
    const flowErrors: ArtifactValidationError[] = [
      {
        code: "missing_page_opening",
        message: 'page opening "Failure and recovery" must contain one or more prose paragraphs',
        location: "body",
      },
    ];
    const flowPage = [
      "---",
      "title: Flow",
      "owner: generated",
      "---",
      "",
      "# Flow",
      "",
      "Explains the flow.",
      "",
      "## Purpose",
      "",
      "Prose.",
      "",
      "## Failure and recovery",
      "",
      "- bullets are not prose",
      "",
    ].join("\n");
    const r = buildSurgicalRepairPrompt("flow", flowPage, flowErrors, "", "en");
    expect(r.system).toContain('"Failure and recovery"');
    expect(r.user).toContain('- "Failure and recovery"');
  });
});

// === A/B round-5 re-eval fix (c): branch-precision rule ===

describe("prompts — branch precision rule (round-5 re-eval fix (c))", () => {
  const flowCandidate: FlowCandidate = {
    slug: "cli-to-core",
    titleSeed: "Cli to Core",
    moduleIds: ["cli", "core"],
    seedKeys: ["src/cli.ts#run", "src/core.ts#batch", "src/store.ts#persist"],
    entryKeys: ["src/cli.ts#run"],
    boundaryKeys: ["src/core.ts#batch"],
    sinkKeys: ["src/store.ts#persist"],
    otherProductKeys: [],
    auxiliaryKeys: [],
    signals: { entry: ["cli"], persistence: ["core"], external: [] },
  };
  const topicCandidate: TopicCandidate = {
    title: "Auth lifecycle",
    intent: "Explain how authentication state is created and refreshed",
    modules: ["auth"],
    flows: [],
    groups: { contract: ["src/auth.ts#login"], state: [], output: [], failure: [] },
    planOrder: 1,
    evidenceHash: "abc123",
    slug: "auth-lifecycle",
    seedKeys: ["src/auth.ts#login"],
  };

  it("BRANCH_PRECISION_PROMPT_RULE is present in all five builders that share the factual-precision rules", () => {
    const moduleInitial = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code");
    const moduleRepair = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "sym",
      "code",
      "prior",
      [],
      60_000,
      "en",
    );
    const flowInitial = buildStage5Prompt(
      flowCandidate,
      flowCandidate.seedKeys,
      "openings",
      "symbols",
      "source",
    );
    const flowRepair = buildStage5RepairPrompt(
      flowCandidate,
      flowCandidate.seedKeys,
      "openings",
      "symbols",
      "source",
      "prior",
      [],
      60_000,
    );
    const topicInitial = buildTopicPrompt(topicCandidate, "digest", "sym", "source", "en");
    for (const prompt of [moduleInitial, moduleRepair, flowInitial, flowRepair, topicInitial]) {
      expect(prompt.system).toContain(BRANCH_PRECISION_PROMPT_RULE);
    }
    // The rule names the exact failure mode: one-sided checks inflated into
    // two-sided invariants (clamp-to-range, containment for every input shape).
    expect(BRANCH_PRECISION_PROMPT_RULE).toContain("which side is enforced");
    expect(BRANCH_PRECISION_PROMPT_RULE).toContain("which input shapes each check covers");
    expect(BRANCH_PRECISION_PROMPT_RULE).toContain("Never generalize a one-sided check");
  });
});

describe("FILE_NARRATIVE_PROMPT_RULES — manual-marker ban (2026-08-12)", () => {
  it("bans the literal marker without embedding a copyable one", () => {
    // The rule must name the mechanism so the model avoids it, but it must
    // NOT carry the copyable HTML comment form — the model reconstructs and
    // emits any literal marker it sees (dogfood run-3 evidence).
    const joined = FILE_NARRATIVE_PROMPT_RULES.join(" ");
    expect(joined).toContain("lw:manual");
    expect(joined).not.toContain("<!-- lw:manual -->");
    expect(joined).not.toContain("<!-- /lw:manual -->");
  });
});
