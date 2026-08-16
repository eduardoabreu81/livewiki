/**
 * verify — valida a wiki contra o índice de código.
 *
 * SPEC §"Comandos CLI" (commit 6183214 — Fix C): "Parseia a wiki fresca do
 * disco — âncora em página nunca indexada TEM que ser pega (é a promessa
 * anti-alucinação: doc recém-escrita por LLM é validável sem rodar `index`
 * antes)".
 *
 * Verificações:
 *   - âncoras (página e seção) apontam para símbolos existentes no índice?
 *   - manual blocks byte-a-byte preservados (regra #6)?
 *   - links internos entre páginas da wiki válidos?
 *
 * Exit code != 0 em error (CI-friendly). O DB é aberto só pra consultar
 * symbols ativos e manual blocks baseline (para o check de regra #6).
 *
 * Walk da wiki é SEMPRE do disco — não dependemos do `doc_pages` do banco
 * pra detectar páginas "fantasma" (criadas após o último index).
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import { extractAnchors, slugify } from "./anchors.js";
import { sha256 } from "./hashes.js";
import { maskCodeSpans } from "./markdown-mask.js";
import { validateMermaidSyntax } from "./mermaid-validator.js";
import {
  BASELINE_REL_PATH,
  collectBaselineDocumentationInventory,
  evaluateBaseline,
  readBaseline,
} from "./baseline.js";

export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "broken_anchor"        // anchor referencia symbol que não existe
  | "broken_internal_link" // [text](page.md) ou [text](page.md#section) pra página inexistente
  | "invalid_mermaid_diagram"
  | "manual_block_altered"  // bloco <!-- lw:manual -->...<!-- /lw:manual --> com hash divergente
  | "missing_wiki_path"     // doc_page do banco sumiu da wiki
  | "unsupported_baseline_algorithm"
  | "invalid_documentation_baseline"
  | "baseline_entry_without_anchor";

export interface VerifyIssue {
  severity: IssueSeverity;
  code: IssueCode;
  wikiPath: string;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  pagesChecked: number;
  issues: VerifyIssue[];
}

export async function run(repoRoot: string): Promise<VerifyResult> {
  const absRoot = nodePath.resolve(repoRoot);
  await safeIo.mkdir(absRoot, ".livewiki");
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);

  const issues: VerifyIssue[] = [];

  try {
    // Mapa de symbols ativos (precisamos pra broken_anchor)
    const activeSymbols = new Map<string, SymbolRow>();
    for (const row of db
      .prepare("SELECT * FROM symbols WHERE status = 'active'")
      .all() as SymbolRow[]) {
      activeSymbols.set(row.key, row);
    }

    // Mapa de manual blocks por wiki_path (regra #6, baseline do banco).
    // wiki_path é o caminho do doc_page (livewiki/foo.md).
    interface ManualBlockRow {
      id: number;
      doc_page_id: number;
      start_offset: number;
      end_offset: number;
      content_hash: string;
      updated_at: number;
    }
    interface DocPageRow {
      id: number;
      wiki_path: string;
    }
    const docPages = new Map<number, string>();
    const manualBlocksByPath = new Map<string, ManualBlockRow[]>();
    for (const row of db
      .prepare("SELECT id, wiki_path FROM doc_pages")
      .all() as DocPageRow[]) {
      docPages.set(row.id, row.wiki_path);
    }
    for (const row of db.prepare("SELECT * FROM manual_blocks").all() as ManualBlockRow[]) {
      const path = docPages.get(row.doc_page_id);
      if (!path) continue;
      const arr = manualBlocksByPath.get(path) ?? [];
      arr.push(row);
      manualBlocksByPath.set(path, arr);
    }

    // Walk wiki do disco (Fix C) — não depende de doc_pages do banco.
    const wikiPages = await collectWikiPages(absRoot);
    // The existence set used for link resolution
    // includes non-.md wiki artifacts (currently `.mmd` diagrams) — a link
    // to a diagram is checkable even though diagrams aren't full "pages"
    // (no anchors/manual-blocks/section-scan of their own).
    const existingArtifactPaths = await collectWikiArtifactPaths(absRoot);

    // Mapa de section_slug por wiki_path (pra links internos)
    const sectionSlugsByPath = new Map<string, Set<string>>();
    for (const page of wikiPages) {
      sectionSlugsByPath.set(page.relPath, await collectSectionSlugs(absRoot, page.relPath));
    }

    let pagesChecked = 0;

    for (const page of wikiPages) {
      pagesChecked++;
      const source = await safeIo.readText(absRoot, page.relPath).catch(() => null);
      if (source === null) continue;

      let extracted;
      try {
        extracted = extractAnchors(source);
      } catch {
        continue;
      }

      // Anchors do disco: cada symbol_key deve existir como symbol ativo
      const allAnchorsFromDisk = [
        ...extracted.pageAnchors.map((sk) => ({ key: sk, sectionSlug: null as string | null })),
        ...extracted.sectionAnchors.flatMap((sa) =>
          sa.symbolKeys.map((sk) => ({ key: sk, sectionSlug: sa.sectionSlug })),
        ),
      ];

      for (const a of allAnchorsFromDisk) {
        if (!activeSymbols.has(a.key)) {
          // SPEC Fix C: âncora fantasma em página nova — erro, mesmo sem
          // index prévio. É a promessa anti-alucinação.
          issues.push({
            severity: "error",
            code: "broken_anchor",
            wikiPath: page.relPath,
            detail: `âncora ${a.key} (${a.sectionSlug ?? "página"}) referencia símbolo inexistente`,
          });
        }
      }

      // Verify stored manual blocks byte-for-byte. Offsets are not identities:
      // regenerated prose and section markers can move a preserved block by
      // any distance. Compare the multiset of hashes so duplicate blocks are
      // counted correctly and a missing/changed stored block is detected.
      const storedBlocks = manualBlocksByPath.get(page.relPath) ?? [];
      const unmatchedCurrentHashes = extracted.manualBlocks.map((block) =>
        sha256(source.slice(block.start, block.end)),
      );
      const unmatchedStored = [...storedBlocks];
      for (let index = unmatchedStored.length - 1; index >= 0; index--) {
        const stored = unmatchedStored[index]!;
        const currentIndex = unmatchedCurrentHashes.indexOf(stored.content_hash);
        if (currentIndex >= 0) {
          unmatchedCurrentHashes.splice(currentIndex, 1);
          unmatchedStored.splice(index, 1);
        }
      }
      for (const stored of unmatchedStored) {
        issues.push({
          severity: "error",
          code: "manual_block_altered",
          wikiPath: page.relPath,
          detail:
            `stored manual block at offset ${stored.start_offset} is missing or changed ` +
            `(expected hash=${stored.content_hash.slice(0, 8)})`,
        });
      }

      // Links internos — entre páginas da wiki (lidos do disco)
      // Links inside fenced code blocks or inline code are NOT navigable —
      // they are syntax examples, not real references. Mask that content
      // BEFORE running the link regex (does not mutate `source`; used only
      // for this scan).
      const sourceForLinks = maskCodeSpans(source);
      // `.md` and `.mmd` are both checkable wiki artifacts:
      // overview links to class diagrams must be caught the same way as
      // broken page links — extension-driven, not path-driven).
      const linkRe = /\[([^\]]*)\]\(([^)#]+\.(?:md|mmd))(#([^)]+))?\)/g;
      for (const m of sourceForLinks.matchAll(linkRe)) {
        const linkPathRaw = m[2];
        if (!linkPathRaw) continue;
        const linkSection = m[4];
        // Resolve o link contra o diretório da página wiki atual.
        // 3 casos (Q — fix):
        //   1. "livewiki/foo.md" ou "livewiki/" prefixo  → absoluto no namespace, usa como está
        //   2. "/foo.md"                                 → absoluto a partir da raiz do repo
        //   3. "./foo.md", "../foo.md", "foo.md"         → relativo ao diretório da página
        //
        // Antes do fix, o caso (3) era tratado como (1) com prepend "livewiki/"
        // — o que quebrava QUALQUER link com "..". Ex.: architecture/overview.md
        // emite "[page](../auth.md)" que virava "livewiki/../auth.md" = fora.
        const resolved = resolveWikiLink(page.relPath, linkPathRaw);
        if (!resolved) {
          // Link malformado (não é wiki-path válido) — pula silenciosamente.
          // Pode ser link externo ou absolute-path falso. Não bloqueia.
          continue;
        }
        if (!isInsideWiki(resolved)) {
          // Resolveu pra fora do namespace livewiki/ (ex.: "../../etc/passwd"
          // → "../etc/passwd"). verify é só leitura — não bloqueia escrita, só
          // reporta (mesma filosofia do teste legado).
          issues.push({
            severity: "warning",
            code: "broken_internal_link",
            wikiPath: page.relPath,
            detail: `link para ${resolved}${linkSection ? `#${linkSection}` : ""} aponta para fora de livewiki/`,
          });
          continue;
        }
        // Check whether the target artifact exists on disk.
        const targetExists = existingArtifactPaths.has(resolved);
        if (!targetExists) {
          issues.push({
            severity: "warning",
            code: "broken_internal_link",
            wikiPath: page.relPath,
            detail: `link para ${resolved}${linkSection ? `#${linkSection}` : ""} aponta para página inexistente`,
          });
          continue;
        }
        if (linkSection) {
          const slugs = sectionSlugsByPath.get(resolved);
          if (slugs && !slugs.has(linkSection)) {
            issues.push({
              severity: "warning",
              code: "broken_internal_link",
              wikiPath: page.relPath,
              detail: `link para ${resolved}#${linkSection} — seção não existe`,
            });
          }
        }
      }
    }

    for (const diagramPath of [...existingArtifactPaths]
      .filter((path) => path.endsWith(".mmd"))
      .sort()) {
      const source = await safeIo.readText(absRoot, diagramPath).catch(() => null);
      if (source === null) continue;
      const diagnostic = await validateMermaidSyntax(source);
      if (diagnostic !== null) {
        issues.push({
          severity: "error",
          code: "invalid_mermaid_diagram",
          wikiPath: diagramPath,
          detail: `Mermaid parser rejected the diagram: ${diagnostic}`,
        });
      }
    }

    // Doc_pages do banco que sumiram da wiki (página deletada).
    const seenPaths = new Set(wikiPages.map((p) => p.relPath));
    for (const [_, wikiPath] of docPages) {
      if (!seenPaths.has(wikiPath)) {
        issues.push({
          severity: "warning",
          code: "missing_wiki_path",
          wikiPath,
          detail: "página sumiu da wiki",
        });
      }
    }

    const baselineLoad = await readBaseline(absRoot);
    if (baselineLoad.state === "incompatible") {
      for (const issue of baselineLoad.issues) {
        issues.push({
          severity: "error",
          code:
            issue.code === "unsupported_schema" || issue.code === "unsupported_extraction"
              ? "unsupported_baseline_algorithm"
              : "invalid_documentation_baseline",
          wikiPath: BASELINE_REL_PATH,
          detail: issue.entryIndex === undefined
            ? issue.detail
            : `entry ${issue.entryIndex}: ${issue.detail}`,
        });
      }
    } else if (baselineLoad.state === "available") {
      const inventory = await collectBaselineDocumentationInventory(absRoot);
      const health = evaluateBaseline(
        baselineLoad.baseline,
        [...activeSymbols.values()],
        inventory,
      );
      for (const entry of health.removedAnchors) {
        issues.push({
          severity: "error",
          code: "baseline_entry_without_anchor",
          wikiPath: entry.wikiPath,
          detail: `baseline entry for ${entry.symbolKey} has no current anchor; use the explicit anchor-removal operation`,
        });
      }
    }

    return {
      ok: issues.filter((i) => i.severity === "error").length === 0,
      pagesChecked,
      issues,
    };
  } finally {
    db.close();
  }
}

async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]> {
  const out: { relPath: string }[] = [];
  const stack = [nodePath.join(absRoot, "livewiki")];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await nodeFs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Never descend hidden dirs. Dot-prefixed PAGES are legit: tier-2
        // modules from hidden source dirs (e.g. .github/) produce pages
        // like livewiki/.github.md (Etapa 3 E2E). .manifest.json stays out
        // via the .md extension check.
        if (entry.name.startsWith(".")) continue;
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push({
          relPath: nodePath.relative(absRoot, abs).split(nodePath.sep).join("/"),
        });
      }
    }
  }
  return out;
}

/**
 * Every wiki-relative artifact path on disk that a link is allowed to
 * target — `.md` pages and `.mmd` diagrams (`verify` must be
 * able to see a broken link to a deterministic diagram the same way it
 * sees a broken link to a page). Extension-driven, not path-driven — a
 * future third artifact type only needs one more suffix here.
 *
 * Exported for the Phase 7 viewer (`view.ts`), which enumerates the same
 * canonical artifact set instead of re-inventing the walker rules
 * (dot-directories skipped, dot-prefixed pages included).
 */
export async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>> {
  const out = new Set<string>();
  const stack = [nodePath.join(absRoot, "livewiki")];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await nodeFs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Never descend hidden dirs (.git and friends). Dot-prefixed FILES
        // are fine: tier-2 modules from hidden source dirs (e.g. .github/)
        // produce legit pages like livewiki/.github.md (Etapa 3 E2E).
        if (entry.name.startsWith(".")) continue;
        stack.push(abs);
      } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mmd"))) {
        out.add(nodePath.relative(absRoot, abs).split(nodePath.sep).join("/"));
      }
    }
  }
  return out;
}

async function collectSectionSlugs(
  absRoot: string,
  relPath: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  const source = await safeIo.readText(absRoot, relPath).catch(() => null);
  if (source === null) return out;
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
  for (const m of source.matchAll(headingRe)) {
    if (m[2]) out.add(slugify(m[2]));
  }
  return out;
}

/**
 * Resolve um link markdown para um wiki-path (relativo a repoRoot) ou
 * retorna null se o link não é wiki-válido (ex.: externo).
 *
 * Três formas aceitas:
 *   1. "livewiki/foo.md" → "livewiki/foo.md" (absoluto no namespace — usa como está)
 *   2. "/foo.md"        → "foo.md" (absoluto a partir da raiz do repo)
 *   3. "foo.md" | "./foo.md" | "../foo.md" → relativo ao diretório de fromRelPath
 *
 * Não valida se o alvo existe — só resolve o path. Use `isInsideWiki()`
 * pra checar se ficou dentro do namespace `livewiki/` (segurança contra
 * `..` malicioso que escapa da wiki).
 *
 * Exported for the Phase 7 viewer (`view.ts`), which rewrites internal
 * links with exactly the same resolution rules.
 */
export function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null {
  // Strip do prefixo "./" (equivalente a nome puro no mesmo dir)
  const cleaned = linkRaw.replace(/^\.\//, "");
  if (cleaned.length === 0) return null;

  // (1) Já é absoluto no namespace livewiki/
  if (cleaned === "livewiki" || cleaned.startsWith("livewiki/")) {
    return cleaned;
  }

  // (2) Absoluto a partir da raiz do repo
  if (cleaned.startsWith("/")) {
    return cleaned.replace(/^\/+/, "");
  }

  // (3) Relativo ao diretório da página wiki atual
  const fromDir = nodePath.posix.dirname(fromRelPath);
  return nodePath.posix.normalize(nodePath.posix.join(fromDir, cleaned));
}

/**
 * True se o wiki-path está dentro do namespace `livewiki/` (a wiki) ou
 * é exatamente `livewiki` (sem trailing). Usado como barreira de segurança
 * após resolver links relativos — evita que `../../etc/passwd` (ou
 * similar) seja interpretado como link válido pra fora.
 *
 * Exported together with `resolveWikiLink` for the Phase 7 viewer.
 */
export function isInsideWiki(wikiPath: string): boolean {
  return wikiPath === "livewiki" || wikiPath.startsWith("livewiki/");
}

export function formatHuman(result: VerifyResult): string {
  const lines: string[] = [];
  lines.push(`livewiki verify: ${result.ok ? "OK" : "FAILED"} (${result.pagesChecked} pages)`);
  if (result.issues.length === 0) {
    lines.push("  no issues.");
    return lines.join("\n");
  }
  const errs = result.issues.filter((i) => i.severity === "error");
  const warns = result.issues.filter((i) => i.severity === "warning");
  lines.push(`  ${errs.length} errors, ${warns.length} warnings`);
  for (const i of errs) {
    lines.push(`  ERROR ${i.wikiPath}: [${i.code}] ${i.detail}`);
  }
  for (const i of warns) {
    lines.push(`  WARN  ${i.wikiPath}: [${i.code}] ${i.detail}`);
  }
  return lines.join("\n");
}
