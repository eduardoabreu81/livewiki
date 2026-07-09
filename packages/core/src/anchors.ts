/**
 * anchors — extrai anchors e manual blocks de uma página markdown da wiki.
 *
 * Formato reconhecido (SPEC §"Frontmatter das páginas de doc"):
 *
 *   ---
 *   title: Auth — login e sessão
 *   owner: generated
 *   anchors:
 *     - src/auth/login.ts            # âncora de PÁGINA
 *     - src/auth/login.ts#validateToken
 *   ---
 *
 *   ## Fluxo de validação
 *   <!-- lw:anchors src/auth/login.ts#validateToken src/auth/session.ts#refresh -->
 *   O token é validado por `validateToken(...)`, que ...
 *
 *   ## Notas manuais
 *   <!-- lw:manual -->
 *   Bloco que o agente NUNCA pode reescrever (regra inviolável #6).
 *   <!-- /lw:manual -->
 *
 * Saída: anchors de página (frontmatter) + anchors de seção (marcadores) +
 * ranges de manual blocks (para verify byte-a-byte).
 *
 * `inManualBlock` é derivado: anchor que cai dentro de um manualBlock é
 * flagada — verify usa pra distinguir "âncora inválida por código mudou"
 * vs "âncora em zona protegida por humano".
 */

import { parseFrontmatter, getAnchors, getOwner, type Frontmatter } from "./frontmatter.js";

export type Owner = "generated" | "human" | "mixed";

export interface SectionAnchor {
  /** Slug gerado do heading anterior (ex: "fluxo-de-validacao"). */
  sectionSlug: string;
  /** Texto do heading (ex: "Fluxo de validação"). */
  headingText: string;
  /** Símbolos ancorados por esta seção. */
  symbolKeys: string[];
  /** Byte offset do <!-- lw:anchors ... --> no source. */
  anchorMarkerOffset: number;
  /** Se a anchor cai dentro de um bloco <!-- lw:manual -->...<!-- /lw:manual -->. */
  inManualBlock: boolean;
}

export interface ManualBlock {
  /** Byte offset do <!-- lw:manual --> (inclusive). */
  start: number;
  /** Byte offset do <!-- /lw:manual --> (exclusive). */
  end: number;
}

export interface ExtractedAnchors {
  /** Anchors do frontmatter (cobre a página inteira). */
  pageAnchors: string[];
  /** Anchors de marcadores `<!-- lw:anchors ... -->` em seções. */
  sectionAnchors: SectionAnchor[];
  /** Ranges dos blocos `<!-- lw:manual -->...<!-- /lw:manual -->`. */
  manualBlocks: ManualBlock[];
  /** Frontmatter parseado (null se ausente). */
  frontmatter: Frontmatter | null;
  /** Owner declarado (default: generated). */
  owner: Owner;
  /** Body markdown (sem o frontmatter). */
  body: string;
}

/** Marcador de início de anchor de seção. */
const LW_ANCHORS_RE = /<!--\s*lw:anchors\s+([^\s>][^>]*?)\s*-->/g;
/** Marcador de início de bloco manual. */
const LW_MANUAL_START_RE = /<!--\s*lw:manual\s*-->/g;
/** Marcador de fim de bloco manual. */
const LW_MANUAL_END_RE = /<!--\s*\/lw:manual\s*-->/g;

export function extractAnchors(source: string): ExtractedAnchors {
  const fm = parseFrontmatter(source);
  const body = fm.body;

  // Comprimento do frontmatter no source original (incluindo --- de fechamento
  // + newline) — usamos pra mapear offsets do body pro source original.
  const bodyStartInOriginal = fm.bodyOffset;

  const sectionAnchors: SectionAnchor[] = [];
  const manualBlocks: ManualBlock[] = [];

  // 1. Coleta ranges de manual blocks no body
  //    Estado simples: toggle por start/end. Não suporta nested (não precisamos).
  let cursor = 0;
  const events: Array<{ offset: number; kind: "start" | "end" }> = [];
  for (const m of body.matchAll(LW_MANUAL_START_RE)) {
    if (m.index === undefined) continue;
    events.push({ offset: m.index, kind: "start" });
  }
  for (const m of body.matchAll(LW_MANUAL_END_RE)) {
    if (m.index === undefined) continue;
    events.push({ offset: m.index, kind: "end" });
  }
  events.sort((a, b) => a.offset - b.offset);

  let openAt: number | null = null;
  for (const ev of events) {
    if (ev.kind === "start") {
      if (openAt !== null) {
        // nested start sem end — ignora silenciosamente (não geramos erro;
        // verify depois aponta como "bloco manual malformado" se for grave)
        continue;
      }
      openAt = ev.offset;
    } else {
      if (openAt === null) continue;
      manualBlocks.push({ start: openAt, end: ev.offset });
      openAt = null;
    }
  }

  // 2. Encontra marcadores lw:anchors e associa ao heading anterior
  let lastHeading: { text: string; slug: string; offset: number } | null = null;
  // Regex pra heading markdown (## ou ### — Fase 2 só precisa dos 2 níveis)
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;

  // Caminha o body em ordem, identificando headings e anchors intercalados.
  // Para simplicidade, varrar duas vezes: headings primeiro, depois anchors.
  const headingMatches: Array<{ text: string; slug: string; offset: number }> = [];
  for (const m of body.matchAll(headingRe)) {
    if (m.index === undefined) continue;
    headingMatches.push({
      text: m[2] ?? "",
      slug: slugify(m[2] ?? ""),
      offset: m.index,
    });
  }

  for (const m of body.matchAll(LW_ANCHORS_RE)) {
    if (m.index === undefined || m[1] === undefined) continue;
    const anchorOffset = m.index;
    const anchorEnd = m.index + m[0].length;

    // Heading anterior: o último heading com offset < anchorOffset
    let preceding: { text: string; slug: string; offset: number } | null = null;
    for (const h of headingMatches) {
      if (h.offset < anchorOffset) preceding = h;
      else break;
    }
    if (!preceding) {
      // anchor sem heading anterior — pula (página malformada)
      continue;
    }

    const symbolKeys = m[1].trim().split(/\s+/).filter(Boolean);
    sectionAnchors.push({
      sectionSlug: preceding.slug,
      headingText: preceding.text,
      symbolKeys,
      anchorMarkerOffset: anchorOffset + bodyStartInOriginal,
      inManualBlock: isInsideAny(anchorOffset, anchorEnd, manualBlocks),
    });
  }

  return {
    pageAnchors: getAnchors(fm.frontmatter),
    sectionAnchors,
    manualBlocks: manualBlocks.map((b) => ({
      start: b.start + bodyStartInOriginal,
      end: b.end + bodyStartInOriginal,
    })),
    frontmatter: fm.frontmatter,
    owner: getOwner(fm.frontmatter),
    body,
  };
}

/**
 * Slug de heading: lowercase, remove não-alfanumérico (mantém acentos pra PT),
 * hífens entre palavras. "Fluxo de validação" → "fluxo-de-validacao".
 */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .normalize("NFD") // separa diacríticos
    .replace(/[\u0300-\u036f]/g, "") // remove diacríticos
    .replace(/[^\w\s-]/g, "") // remove pontuação
    .trim()
    .replace(/\s+/g, "-");
}

function isInsideAny(start: number, end: number, blocks: ManualBlock[]): boolean {
  return blocks.some((b) => start >= b.start && end <= b.end);
}