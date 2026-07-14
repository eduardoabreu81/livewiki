import fs from "node:fs";
import path from "node:path";

const artifactRoot = path.resolve(process.argv[2] || path.dirname(new URL(import.meta.url).pathname));
const auditPath = path.join(artifactRoot, "_qualitative-audit.mjs");
const metricsRoot = path.join(artifactRoot, "metrics");
const source = fs.readFileSync(auditPath, "utf8");

const claimsProcessExit =
  /(?:calls?|uses?|invokes?|exits?\s+(?:directly\s+)?(?:via|with))\s+`?process\.exit\s*\(|`?process\.exit\s*\([^)]*\)`?\s+(?:is|are)\s+(?:called|used|invoked)/i;
const deniesOrContrastsProcessExit =
  /\b(?:(?:never|does not|doesn't|do not|don't)\s+(?:call|use|invoke)s?|(?:rather than|instead of|without)\s+(?:directly\s+)?(?:calling|using|invoking)|(?:avoid|avoids|avoided|avoiding)(?:\s+calling|\s+using)?)[^\r\n]{0,80}`?process\.exit\s*\(|`?process\.exit\s*\([^)]*\)`?[^\r\n]{0,40}\b(?:is\s+)?(?:avoided|not\s+(?:called|used|invoked))/i;
const flags = (line) =>
  claimsProcessExit.test(line) && !deniesOrContrastsProcessExit.test(line);

const fixtures = [
  ["The CLI calls process.exit(1) on failure.", true],
  ["The handler uses process.exit(2).", true],
  ["The CLI exits via process.exit(1).", true],
  ["The CLI uses process.exitCode rather than calling process.exit(1).", false],
  ["The comment notes that process.exit(1) is avoided.", false],
  ["Errors use process.exitCode, avoiding process.exit(1).", false],
  ["The CLI never calls process.exit(1).", false],
  ["The command does not use process.exit(1).", false],
  ["The implementation uses process.exitCode instead of using process.exit(1).", false],
];

const fixtureResults = fixtures.map(([line, expected]) => ({
  line,
  expected,
  actual: flags(line),
}));
const checks = {
  claimRegexIsUsedByAudit: source.includes(claimsProcessExit.source),
  exclusionRegexIsUsedByAudit: source.includes(deniesOrContrastsProcessExit.source),
  noRawProcessExitAlternative: !source.includes("|process\\.exit\\([012]\\)"),
  masksMarkdownCodeForMarkers:
    source.includes("const structural = maskStructuralCode(text)") &&
    source.includes("structural.matchAll(/<!--\\s*lw:anchors"),
  fixtureSemantics: fixtureResults.every((result) => result.actual === result.expected),
};
const output = {
  verifiedBeforeCorrectedAudit: true,
  semantics: "claim_of_contradiction_only",
  checks,
  fixtureResults,
  overallGate: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
};

fs.mkdirSync(metricsRoot, { recursive: true });
fs.writeFileSync(
  path.join(metricsRoot, "audit-rule-verification.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(JSON.stringify(output, null, 2));
if (output.overallGate !== "PASS") process.exitCode = 1;
