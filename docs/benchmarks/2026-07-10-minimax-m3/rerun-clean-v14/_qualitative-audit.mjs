/**
 * Static qualitative audit for the clean v14 artifact.
 *
 * This is intentionally independent of the paid pipeline. It reads only the
 * frozen output and records whether the concrete regressions found in clean v7
 * are present. It never edits generated pages.
 *
 * Usage: node _qualitative-audit.mjs <artifactRoot>
 */
import fs from "node:fs";
import path from "node:path";

const artifactRoot = path.resolve(process.argv[2] || path.dirname(new URL(import.meta.url).pathname));
const wikiRoot = path.join(artifactRoot, "livewiki");
const metricsRoot = path.join(artifactRoot, "metrics");

function walk(dir, suffix) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, suffix));
    else if (!suffix || entry.name.endsWith(suffix)) files.push(absolute);
  }
  return files.sort();
}

function maskManualAndCode(text) {
  let masked = text.replace(
    /<!--\s*lw:manual\s*-->[\s\S]*?<!--\s*\/lw:manual\s*-->/g,
    (match) => " ".repeat(match.length),
  );
  const lines = masked.split(/\r?\n/);
  let fence = null;
  masked = lines
    .map((line) => {
      if (!fence) {
        const open = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
        if (!open) return line;
        fence = { char: open[1][0], length: open[1].length };
        return "";
      }
      const close = new RegExp(`^[ \\t]{0,3}${fence.char}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) fence = null;
      return "";
    })
    .join("\n");

  let out = "";
  for (let i = 0; i < masked.length;) {
    if (masked[i] !== "`") {
      out += masked[i++];
      continue;
    }
    let end = i;
    while (masked[end] === "`") end++;
    const width = end - i;
    let cursor = end;
    let closing = -1;
    while (cursor < masked.length) {
      if (masked[cursor] !== "`") {
        cursor++;
        continue;
      }
      let runEnd = cursor;
      while (masked[runEnd] === "`") runEnd++;
      if (runEnd - cursor === width) {
        closing = runEnd;
        break;
      }
      cursor = runEnd;
    }
    if (closing < 0) {
      out += masked.slice(i, end);
      i = end;
    } else {
      out += " ".repeat(closing - i);
      i = closing;
    }
  }
  return { masked: out, unclosedFence: fence !== null };
}

function hasUnclosedInlineCode(text) {
  const { masked, unclosedFence } = maskManualAndCode(text);
  return unclosedFence || /`/.test(masked);
}

function scanModulePage(file) {
  const text = fs.readFileSync(file, "utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fmKeys = [];
  if (frontmatter) {
    const anchors = frontmatter[1].match(/^anchors:\s*\r?\n((?:[ \t]+-\s+.+\r?\n?)*)/m);
    if (anchors) {
      for (const line of anchors[1].split(/\r?\n/)) {
        const key = line.match(/^\s*-\s+(\S+)/)?.[1];
        if (key) fmKeys.push(key);
      }
    }
  }
  const sectionKeys = [];
  const markers = [...text.matchAll(/<!--\s*lw:anchors\s+([^>]*?)\s*-->/g)];
  const emptySections = [];
  const headings = [...text.matchAll(/^#{1,6}\s+.+$/gm)].map((match) => match.index);
  for (const marker of markers) {
    const keys = marker[1].trim().split(/\s+/).filter(Boolean);
    sectionKeys.push(...keys);
    const start = marker.index + marker[0].length;
    const nextMarker = markers.find((candidate) => candidate.index > marker.index)?.index ?? text.length;
    const nextHeading = headings.find((offset) => offset > marker.index) ?? text.length;
    const body = text.slice(start, Math.min(nextMarker, nextHeading));
    const visible = maskManualAndCode(body).masked
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^<!--.*-->$/.test(line));
    if (visible.length === 0) emptySections.push(marker.index);
  }
  const duplicates = (values) => values.filter((value, index) => values.indexOf(value) !== index);
  const fmSet = [...new Set(fmKeys)].sort();
  const sectionSet = [...new Set(sectionKeys)].sort();
  const { masked } = maskManualAndCode(text);
  return {
    file: path.relative(wikiRoot, file).replaceAll(path.sep, "/"),
    frontmatterCount: fmSet.length,
    sectionCount: sectionSet.length,
    independentCoverageEqual: JSON.stringify(fmSet) === JSON.stringify(sectionSet),
    frontmatterDuplicates: [...new Set(duplicates(fmKeys))],
    sectionDuplicates: [...new Set(duplicates(sectionKeys))],
    emptySections,
    unclosedMarkdown: hasUnclosedInlineCode(text),
    visibleSentinel: /\[untrusted\s+\/?lw:[^\]]+control marker omitted\]/i.test(text),
    todoOrTbdProse: /\b(?:TODO|TBD)\b/i.test(masked),
  };
}

const markdownFiles = walk(wikiRoot, ".md");
const layoutPages = new Set(["quickstart.md", "architecture/overview.md"]);
const modulePages = markdownFiles.filter(
  (file) => !layoutPages.has(path.relative(wikiRoot, file).replaceAll(path.sep, "/")),
);
const pageChecks = modulePages.map(scanModulePage);

const missingMmdLinks = [];
const overviewPath = path.join(wikiRoot, "architecture", "overview.md");
if (fs.existsSync(overviewPath)) {
  const overview = fs.readFileSync(overviewPath, "utf8");
  for (const link of overview.matchAll(/\[[^\]]*\]\(([^)#]+\.mmd)(?:#[^)]+)?\)/g)) {
    const target = path.resolve(path.dirname(overviewPath), link[1]);
    if (!fs.existsSync(target)) missingMmdLinks.push(link[1]);
  }
}

let benchmarkHelpersInImportantSymbols = [];
let quickstartUsesImportantSymbols = false;
let quickstartUsesKeyConcepts = false;
const quickstartPath = path.join(wikiRoot, "quickstart.md");
if (fs.existsSync(quickstartPath)) {
  const quickstart = fs.readFileSync(quickstartPath, "utf8");
  quickstartUsesImportantSymbols = /^## Important symbols\s*$/m.test(quickstart);
  quickstartUsesKeyConcepts = /^## Key concepts\s*$/m.test(quickstart);
  const section = quickstart.match(
    /^## Important symbols\s*\r?\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m,
  )?.[1] ?? "";
  benchmarkHelpersInImportantSymbols = section
    .split(/\r?\n/)
    .filter((line) =>
      /docs\/benchmarks|acceptance-analysis|token-proxy|\.test\.ts|test\/fixtures|fase2-repo|sample-ts-repo/i.test(
        line,
      ),
    );
}

// Truncation: page body must not end mid-fence / mid-span, and must have body.
const truncatedEndings = [];
for (const file of modulePages) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(wikiRoot, file).replaceAll(path.sep, "/");
  if (hasUnclosedInlineCode(text)) {
    truncatedEndings.push({ file: rel, reason: "unclosed_markdown" });
    continue;
  }
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    truncatedEndings.push({ file: rel, reason: "empty_body" });
  }
}

const duplicateDiagramDeclarations = [];
for (const file of walk(wikiRoot, ".mmd")) {
  const text = fs.readFileSync(file, "utf8");
  const declarations = [];
  for (const line of text.split(/\r?\n/)) {
    const classId = line.match(/^\s*class\s+([A-Za-z_][\w-]*)(?:\s|\[|\{)/)?.[1];
    const nodeId = line.match(/^\s*([A-Za-z_][\w-]*)\s*\[[^\]]*\]\s*$/)?.[1];
    if (classId) declarations.push(`class:${classId}`);
    else if (nodeId) declarations.push(`node:${nodeId}`);
  }
  const duplicates = [...new Set(declarations.filter((value, index) => declarations.indexOf(value) !== index))];
  if (duplicates.length) {
    duplicateDiagramDeclarations.push({
      file: path.relative(wikiRoot, file).replaceAll(path.sep, "/"),
      declarations: duplicates,
    });
  }
}

let commandsContradiction = [];
const commandsPath = path.join(wikiRoot, "commands.md");
if (fs.existsSync(commandsPath)) {
  const text = fs.readFileSync(commandsPath, "utf8");
  commandsContradiction = text
    .split(/\r?\n/)
    .filter(
      (line) =>
        /(?:calls?|uses?)\s+`?process\.exit\s*\(|process\.exit\([012]\)/i.test(line) &&
        !/\b(?:never|does not|doesn't|without)\b/i.test(line),
    );
}

const failedPageChecks = pageChecks.filter(
  (page) =>
    !page.independentCoverageEqual ||
    page.frontmatterDuplicates.length ||
    page.sectionDuplicates.length ||
    page.emptySections.length ||
    page.unclosedMarkdown ||
    page.visibleSentinel ||
    page.todoOrTbdProse,
);

const checks = {
  modulePageStructure: modulePages.length > 0 && failedPageChecks.length === 0,
  noMissingMmdLinks: missingMmdLinks.length === 0,
  quickstartUsesImportantSymbolsHeading:
    quickstartUsesImportantSymbols && !quickstartUsesKeyConcepts,
  noBenchmarkHelpersInImportantSymbols: benchmarkHelpersInImportantSymbols.length === 0,
  noDuplicateDiagramDeclarations: duplicateDiagramDeclarations.length === 0,
  commandsMatchesProcessExitCodeImplementation: commandsContradiction.length === 0,
  noTruncatedPageEndings: truncatedEndings.length === 0,
};

const output = {
  overallGate: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
  checks,
  modulePagesChecked: modulePages.length,
  failedPageChecks,
  missingMmdLinks,
  quickstartUsesImportantSymbols,
  quickstartUsesKeyConcepts,
  benchmarkHelpersInImportantSymbols,
  duplicateDiagramDeclarations,
  commandsContradiction,
  truncatedEndings,
};

fs.mkdirSync(metricsRoot, { recursive: true });
fs.writeFileSync(
  path.join(metricsRoot, "qualitative-audit.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(JSON.stringify(output, null, 2));
