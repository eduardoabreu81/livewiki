/**
 * walker — varre arquivos do repo respeitando `.gitignore`.
 *
 * SPEC §Fase 1: "respeito a `.gitignore`". A lib `ignore` (npm) é o padrão de
 * fato para parsear `.gitignore` em Node — mesma semântica do git.
 *
 * Sempre ignora (defesa em profundidade, mesmo sem .gitignore):
 *   - node_modules/
 *   - .git/
 *   - .livewiki/
 *   - dist/
 *   - coverage/
 *
 * Saída: paths RELATIVOS ao repoRoot com forward slashes (cross-platform).
 *
 * Não seguimos symlinks: SPEC §Fase 1 não fala nisso e symlinks em código
 * fonte são raros. Se aparecer um, vai dar loop ou erro — o que é OK (sinal
 * de configuração estranha que o usuário precisa resolver).
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import ignore from "ignore";

/** Linguagens reconhecidas no MVP. Mapeamento de extensão → lang. */
export const EXTENSION_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "tsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
};

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
        const ext = nodePath.extname(entry.name).toLowerCase();
        const lang = EXTENSION_LANG[ext];
        if (!lang) continue; // extensão desconhecida — pula
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