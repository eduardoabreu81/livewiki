/**
 * walker — varre arquivos do repo respeitando `.gitignore`.
 *
 * SPEC §Fase 1: "respeito a `.gitignore`". A lib `ignore` (npm) é o padrão de
 * fato para parsear `.gitignore` em Node — mesma semântica do git.
 *
 * Always ignores (defense in depth, even without .gitignore):
 *   - node_modules/
 *   - .git/
 *   - .livewiki/
 *   - livewiki/            (the generated wiki itself — never indexed)
 *   - dist/
 *   - coverage/
 *
 * File selection is a DENYLIST, not an allowlist (SPEC §"Coverage ladder"):
 * every text file is walked; archives/binaries, media/fonts, source maps,
 * minified bundles, and known lockfiles are skipped. Files without an
 * extension are skipped (no meaningful language name). Extensions without a
 * tree-sitter grammar get `lang` = extension without the dot, lowercased
 * (`.go` → `go`) — tier-2 prose files, indexed with zero symbols.
 *
 * Output: paths RELATIVE to repoRoot with forward slashes (cross-platform).
 *
 * Não seguimos symlinks: SPEC §Fase 1 não fala nisso e symlinks em código
 * fonte são raros. Se aparecer um, vai dar loop ou erro — o que é OK (sinal
 * de configuração estranha que o usuário precisa resolver).
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import ignore from "ignore";

/** Languages with a tree-sitter grammar (tier 1). Extension → lang mapping. */
export const EXTENSION_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "tsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
};

/**
 * Denylist: extensions that are never documentation input (archives,
 * binaries, media, fonts, source maps). Everything else is walked as text.
 */
export const DENIED_EXTENSIONS: ReadonlySet<string> = new Set([
  // archives/binaries
  ".zip", ".gz", ".tar", ".7z", ".rar", ".exe", ".dll", ".so", ".dylib",
  ".bin", ".dat", ".wasm", ".class", ".jar", ".pyc", ".pyo", ".o", ".a",
  // media/fonts
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".mp4", ".mov",
  ".mp3", ".wav", ".pdf", ".ttf", ".otf", ".woff", ".woff2", ".eot",
  // source maps
  ".map",
]);

/**
 * Denylist: lockfiles skipped by exact basename (generated, huge, and never
 * documentation input). Compared case-insensitively.
 */
export const DENIED_BASENAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "cargo.lock",
  "gemfile.lock",
  "poetry.lock",
  "go.sum",
  "composer.lock",
]);

/** Minified bundles are generated artifacts — never documentation input. */
function isMinified(nameLower: string): boolean {
  return nameLower.endsWith(".min.js") || nameLower.endsWith(".min.css");
}

export interface WalkOptions {
  /** Patterns adicionais a ignorar (além do .gitignore + defaults). */
  extraIgnores?: readonly string[];
}

export interface WalkResult {
  /** Path relativo ao repoRoot com forward slashes. */
  path: string;
  /** Linguagem inferida da extensão. */
  lang: string;
}

/**
 * Constrói o filtro de ignore combinando .gitignore + defaults + extras.
 */
async function buildIgnore(repoRoot: string, opts: WalkOptions): Promise<ReturnType<typeof ignore>> {
  const ig = ignore();

  // Defaults — defesa em profundidade caso .gitignore não exista ou não
  // cubra estes paths (e.g. .livewiki/ que é gerado por nós mesmos).
  ig.add([
    ".git/",
    "node_modules/",
    ".livewiki/",
    "livewiki/",
    "dist/",
    "coverage/",
  ]);

  // Tenta carregar .gitignore do repoRoot. Falha silenciosa se não existir.
  try {
    const gitignorePath = nodePath.join(repoRoot, ".gitignore");
    const content = await nodeFs.readFile(gitignorePath, "utf8");
    ig.add(content);
  } catch {
    // Sem .gitignore — só defaults.
  }

  if (opts.extraIgnores) {
    ig.add([...opts.extraIgnores]);
  }

  return ig;
}

/**
 * Varre recursivamente `repoRoot` e retorna arquivos indexáveis.
 *
 * Implementação: stack-based pra não estourar callstack em repos profundos.
 * Usa `readdir({ withFileTypes: true })` — uma única chamada por diretório.
 */
export async function walkRepo(
  repoRoot: string,
  opts: WalkOptions = {},
): Promise<WalkResult[]> {
  const ig = await buildIgnore(repoRoot, opts);
  const out: WalkResult[] = [];

  // Stack de diretórios a visitar. Cada entry é absoluto.
  const stack: string[] = [repoRoot];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await nodeFs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // Permissão negada ou diretório sumido durante varredura. Pula.
      // eslint-disable-next-line no-console
      console.warn(`[livewiki] walker: cannot read ${dir}: ${(err as Error).message}`);
      continue;
    }

    for (const entry of entries) {
      const abs = nodePath.join(dir, entry.name);
      const relFromRoot = nodePath.relative(repoRoot, abs);
      // ignore() opera em paths RELATIVOS com forward slashes (mesmo no Windows).
      const relPosix = relFromRoot.split(nodePath.sep).join("/");

      if (ig.ignores(relPosix)) continue;

      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        const nameLower = entry.name.toLowerCase();
        const ext = nodePath.extname(nameLower);
        if (ext === "") continue; // extensionless file — no meaningful lang
        if (DENIED_EXTENSIONS.has(ext)) continue;
        if (DENIED_BASENAMES.has(nameLower)) continue;
        if (isMinified(nameLower)) continue;
        // Grammar-mapped extensions keep their language name (tier 1);
        // everything else is tier-2 prose, lang = extension without the dot.
        const lang = EXTENSION_LANG[ext] ?? ext.slice(1);
        out.push({ path: relPosix, lang });
      }
      // symlinks e outros: ignorados (isFile/isDirectory=false). Documentado
      // no header do módulo.
    }
  }

  // Ordem estável por path — facilita diff entre runs e legibilidade.
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}