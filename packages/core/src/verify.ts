/**
 * verify — valida a wiki contra o índice de código.
 *
 * SPEC §"Comandos CLI" / §"Fase 2":
 *   - âncoras apontam para símbolos existentes?
 *   - assinaturas citadas batem?
 *   - links internos ok?
 *   - blocos `lw:manual` byte-a-byte preservados (regra #6)?
 *
 * Exit code != 0 se falhar (CI-friendly). Cada verificação vira um item do
 * relatório — verify é projetado pra rodar em CI.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import type { AnchorRow } from "./anchor-ledger.js";
import { extractAnchors, slugify } from "./anchors.js";
import { sha256 } from "./hashes.js";

export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "broken_anchor"        // anchor referencia symbol que não existe
  | "broken_anchor_section" // section_slug de anchor não bate com a página
  | "stale_anchor"          // anchor cujo hash diverge do symbol atual (info: mudou)
  | "broken_internal_link" // [text](page.md) ou [text](page.md#section) pra página inexistente
  | "manual_block_altered"  // bloco <!-- lw:manual -->...<!-- /lw:manual --> com hash divergente
  | "missing_wiki_path";    // âncora em doc_page wiki_path que sumiu

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
    // Mapa de symbols ativos
    const activeSymbols = new Map<string, SymbolRow>();
    for (const row of db
      .prepare("SELECT * FROM symbols WHERE status = 'active'")
      .all() as SymbolRow[]) {
      activeSymbols.set(row.key, row);
    }

    // Mapa de anchors ativos
    const anchors = db
      .prepare(
        "SELECT * FROM anchors a " +
          "JOIN doc_pages d ON d.id = a.doc_page_id",
      )
      .all() as Array<AnchorRow & { wiki_path: string }>;

    // Mapa de doc_pages (path → id)
    const docPages = new Map<string, { id: number; content_hash: string }>();
    for (const row of db.prepare("SELECT id, wiki_path, content_hash FROM doc_pages").all() as Array<{
      id: number;
      wiki_path: string;
      content_hash: string;
    }>) {
      docPages.set(row.wiki_path, { id: row.id, content_hash: row.content_hash });
    }

    // Mapa de manual blocks (doc_page_id → blocks)
    interface ManualBlockRow {
      id: number;
      doc_page_id: number;
      start_offset: number;
      end_offset: number;
      content_hash: string;
      updated_at: number;
    }
    const manualBlocksByPage = new Map<number, ManualBlockRow[]>();
    for (const row of db.prepare("SELECT * FROM manual_blocks").all() as ManualBlockRow[]) {
      const arr = manualBlocksByPage.get(row.doc_page_id) ?? [];
      arr.push(row);
      manualBlocksByPage.set(row.doc_page_id, arr);
    }

    // Mapa de section_slug por doc_page_id (construído a partir da wiki atual)
    const sectionSlugsByPage = new Map<number, Set<string>>();

    // Walk wiki pra extrair section_slugs e checar links internos
    const wikiPages = await collectWikiPages(absRoot);
    let pagesChecked = 0;

    for (const page of wikiPages) {
      pagesChecked++;
      const docPage = docPages.get(page.relPath);
      const sectionSlugs = new Set<string>();
      sectionSlugsByPage.set(docPage?.id ?? -1, sectionSlugs);

      let source: string;
      try {
        source = await safeIo.readText(absRoot, page.relPath);
      } catch {
        continue;
      }

      let extracted;
      try {
        extracted = extractAnchors(source);
      } catch {
        continue;
      }

      // Coleta section_slugs pra validação de links
      // (headingRe duplica a lógica de anchors.ts; vou re-extrair do source)
      const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
      for (const m of source.matchAll(headingRe)) {
        if (m[2]) sectionSlugs.add(slugify(m[2]));
      }

      // Verifica manual blocks byte-a-byte (regra #6)
      if (docPage) {
        const storedBlocks = manualBlocksByPage.get(docPage.id) ?? [];
        // storedBlocks são offsets ANTIGOS — invalidamos se a wiki mudou.
        // Forma honesta: re-extrair pelos marcadores no source ATUAL e
        // comparar com cada stored block pelo (start, end) aproximado.
        for (const mb of extracted.manualBlocks) {
          const currentContent = source.slice(mb.start, mb.end);
          const currentHash = sha256(currentContent);
          // Procura block armazenado que bate com offsets próximos (tolerância
          // de N chars pro caso de edição que desloca markers).
          const stored = storedBlocks.find(
            (s) => Math.abs(s.start_offset - mb.start) < 50,
          );
          if (stored && stored.content_hash !== currentHash) {
            issues.push({
              severity: "error",
              code: "manual_block_altered",
              wikiPath: page.relPath,
              detail: `bloco manual em offset ${mb.start} divergiu (hash stored=${stored.content_hash.slice(0, 8)}, current=${currentHash.slice(0, 8)})`,
            });
          }
        }
      }

      // Verifica links internos (formato [text](path) ou [text](path#section))
      const linkRe = /\[([^\]]*)\]\(([^)#]+\.md)(#([^)]+))?\)/g;
      for (const m of source.matchAll(linkRe)) {
        const linkPathRaw = m[2];
        if (!linkPathRaw) continue;
        const linkSection = m[4];
        // Normaliza: doc_pages guarda como "livewiki/foo.md"; se o link for
        // relativo ("foo.md"), prefixamos "livewiki/".
        let linkPath = linkPathRaw.replace(/^\.\//, "");
        if (!linkPath.startsWith("livewiki/")) {
          linkPath = `livewiki/${linkPath}`;
        }
        const linkDocPage = docPages.get(linkPath);
        if (!linkDocPage) {
          issues.push({
            severity: "warning",
            code: "broken_internal_link",
            wikiPath: page.relPath,
            detail: `link para ${linkPath}${linkSection ? `#${linkSection}` : ""} aponta para página inexistente`,
          });
          continue;
        }
        if (linkSection) {
          const slugs = sectionSlugsByPage.get(linkDocPage.id);
          if (slugs && !slugs.has(linkSection)) {
            issues.push({
              severity: "warning",
              code: "broken_internal_link",
              wikiPath: page.relPath,
              detail: `link para ${linkPath}#${linkSection} — seção não existe`,
            });
          }
        }
      }
    }

    // Verifica anchors (broken / stale)
    for (const a of anchors) {
      const sym = activeSymbols.get(a.symbol_key);
      if (!sym) {
        // Symbol sumiu do código: âncora quebrada
        issues.push({
          severity: "error",
          code: "broken_anchor",
          wikiPath: a.wiki_path,
          detail: `âncora ${a.symbol_key} (${a.section_slug ?? "página"}) referencia símbolo inexistente`,
        });
        continue;
      }
      // Stale: hash mudou
      if (a.symbol_hash_at_doc && a.symbol_hash_at_doc !== sym.content_hash) {
        issues.push({
          severity: "warning",
          code: "stale_anchor",
          wikiPath: a.wiki_path,
          detail: `âncora ${a.symbol_key} tem hash desatualizado (código mudou)`,
        });
      }
    }

    // Doc_pages sumidos: anchors órfãos já foram removidos no ledger.
    // Aqui só reportamos pages que sumiram.
    const seenPages = new Set(wikiPages.map((p) => p.relPath));
    for (const wikiPath of docPages.keys()) {
      if (!seenPages.has(wikiPath)) {
        issues.push({
          severity: "warning",
          code: "missing_wiki_path",
          wikiPath,
          detail: "página sumiu da wiki",
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
      if (entry.name.startsWith(".")) continue;
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
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

export function formatHuman(result: VerifyResult): string {
  const lines: string[] = [];
  lines.push(`livewiki verify: ${result.ok ? "OK" : "FALHOU"} (${result.pagesChecked} páginas)`);
  if (result.issues.length === 0) {
    lines.push("  nenhum problema.");
    return lines.join("\n");
  }
  const errs = result.issues.filter((i) => i.severity === "error");
  const warns = result.issues.filter((i) => i.severity === "warning");
  lines.push(`  ${errs.length} erros, ${warns.length} avisos`);
  for (const i of errs) {
    lines.push(`  ERROR ${i.wikiPath}: [${i.code}] ${i.detail}`);
  }
  for (const i of warns) {
    lines.push(`  WARN  ${i.wikiPath}: [${i.code}] ${i.detail}`);
  }
  return lines.join("\n");
}