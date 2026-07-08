/**
 * parser — wrapper sobre web-tree-sitter com cache de Language por arquivo.
 *
 * Carrega `.wasm` de `packages/core/grammars/` (versionado no repo). O caminho
 * é resolvido relativo ao package.json do módulo, então funciona tanto em dev
 * (`src/`) quanto em build (`dist/`).
 *
 * Idiomas suportados no MVP:
 *   - typescript (.ts)
 *   - tsx (.tsx, .jsx)
 *   - javascript (.js, .mjs, .cjs)
 *   - python (.py)
 *
 * `initParser()` é global, idempotente e deve ser chamado uma vez no startup
 * do CLI antes do primeiro `parseFile()`. Mais de uma chamada é segura
 * (Promise resolve imediatamente).
 */

import { Parser, Language, Tree } from "web-tree-sitter";
import { createRequire } from "node:module";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs";

let initPromise: Promise<void> | null = null;

/**
 * Inicializa o runtime WASM do tree-sitter. Idempotente.
 */
export async function initParser(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = Parser.init();
  return initPromise;
}

/** Localiza o diretório `grammars/` a partir do package.json deste módulo.
 *
 * Estratégia robusta: tenta `./package.json` (dev: src/), depois
 * `../package.json` (build: dist/). Lança se nenhum existir.
 *
 * Não usamos `require.resolve("package.json")` porque isso procura no
 * node_modules, não no próprio package.
 */
function grammarsDir(): string {
  const req = createRequire(import.meta.url);
  for (const rel of ["./package.json", "../package.json"]) {
    try {
      const pkgPath = req.resolve(rel);
      return nodePath.join(nodePath.dirname(pkgPath), "grammars");
    } catch {
      // tenta o próximo
    }
  }
  throw new Error(
    "Não foi possível localizar package.json a partir de " + import.meta.url,
  );
}

/** Cache de Language por nome. Carregar é caro (parsing WASM). */
const languageCache = new Map<string, Language>();

async function loadLanguage(name: string): Promise<Language> {
  const cached = languageCache.get(name);
  if (cached) return cached;
  const wasmPath = nodePath.join(grammarsDir(), `tree-sitter-${name}.wasm`);
  if (!nodeFs.existsSync(wasmPath)) {
    throw new Error(
      `Grammar WASM não encontrada em ${wasmPath}. ` +
        `Gramática '${name}' não suportada nesta build do livewiki.`,
    );
  }
  const lang = await Language.load(wasmPath);
  languageCache.set(name, lang);
  return lang;
}

/** Mapeamento extensão → nome da gramática (mesmo arquivo .wasm). */
const EXT_TO_GRAMMAR: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "tsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
};

const GRAMMAR_TO_EXT = new Map<string, string>(
  Object.entries(EXT_TO_GRAMMAR).map(([ext, grammar]) => [grammar, ext]),
);

/** Tipo de linguagem dado uma extensão de arquivo. */
export function grammarForExtension(ext: string): string | undefined {
  return EXT_TO_GRAMMAR[ext.toLowerCase()];
}

/** Parseia source com a linguagem apropriada para a extensão. */
export async function parseSource(
  ext: string,
  source: string,
): Promise<Tree> {
  await initParser();
  const grammar = EXT_TO_GRAMMAR[ext.toLowerCase()];
  if (!grammar) {
    throw new Error(`Sem gramática tree-sitter para extensão ${ext}`);
  }
  const lang = await loadLanguage(grammar);
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  if (!tree) {
    // tree-sitter retorna null só em casos muito excepcionais (input vazio?).
    // Não acontece com source não-vazio; tratamos como erro pra não propagar null.
    throw new Error(`tree-sitter retornou árvore nula para ${ext}`);
  }
  return tree;
}

/** Lista as linguagens suportadas (nomes dos arquivos .wasm disponíveis). */
export function listSupportedGrammars(): string[] {
  const dir = grammarsDir();
  if (!nodeFs.existsSync(dir)) return [];
  return nodeFs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".wasm"))
    .map((f) => f.replace(/^tree-sitter-/, "").replace(/\.wasm$/, ""));
}

/** Usado por testes para garantir que linguagens são referenciáveis. */
export function _grammarToExtensionForTest(grammar: string): string | undefined {
  return GRAMMAR_TO_EXT.get(grammar);
}