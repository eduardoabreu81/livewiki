# AGENTS.md — livewiki

> Para LLMs/agents trabalhando neste repo. **Estado live em
> `status`**: Fase 3 completa (init + batch + LLM client + diagrams +
> contabilidade de tokens + circuit breaker + manifest). Próxima fase
> (4): MCP server.

## TL;DR

livewiki é uma ferramenta de documentação técnica agent-first. O coração é o
**pipeline batch de 4 etapas** (varredura → módulos → priorização → documentação)
que chama LLM pra gerar páginas Markdown âncoradas em símbolos do código,
validando pós-escrita via `verify` (broken_anchor = chave fora do índice).

Estado do projeto:
- **Fase 0** (scaffold + safe-io) ✅
- **Fase 1** (indexador com web-tree-sitter) ✅
- **Fase 2** (âncoras + dívida + verify) ✅
- **Fase 3** (init + batch + LLM client + diagrams + contabilidade) ✅
- **Fase 4** (MCP server) — próxima
- **Fase 5** (skills + hooks + update incremental + pointer) — depois
- **Fase 6** (export pra github-wiki/gitlab-wiki/generic) — pós-MVP
- **Fase 7** (viewer local + templates) — pós-MVP

Critério de aceite da Fase 3 (SPEC): `livewiki init --batch` num repo médio
gera wiki completa; interromper no meio + `batch resume` continua da task certa;
verify pega pelo menos um caso real de alucinação de doc.

## Regras invioláveis (SPEC §"Regras invioláveis")

1. **Escrita restrita**: todo código que escreve em disco passa por
   `safe-io.ts`. Allowlist: `livewiki/` + `.livewiki/`. `AGENTS.md`/`CLAUDE.md`
   só com flag explícita (Fase 5).
2. **Pointer opt-in** (Fase 5).
3. **O banco é derivado**: nenhuma informação importante vive SÓ no SQLite.
   Tudo que importa para handoff vive em markdown/manifest versionados.
4. **Sem telemetria, sem rede** exceto: LLM no batch (opt-in, key do usuário)
   e download único de gramáticas WASM.
5. **Testes**: vitest; cobertura mínima 80% no core. CLI/MCP podem ter
   cobertura menor, mas os fluxos principais têm teste de integração
   (E2E via stub HTTP server).
6. **Conteúdo humano é intocável**: páginas `owner: human` e blocos
   `lw:manual` JAMAIS são modificados por escrita automatizada. `verify`
   compara blocos manuais byte a byte após update.

## Convenções adicionais (Fase 3 + adendos)

- **API key SÓ via env var** (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).
  Nunca em config.json, checkpoint_json, logs ou erros. Coberto por
  `key-leak.test.ts` — **se esse teste falhar, NÃO comite.**
- **Sem modelo default hardcoded** (commit 3894f6e). `batch` sem config
  falha com `MissingProviderConfigError` apontando pro `.livewiki/config.json`
  com `claude-sonnet-5` só como EXEMPLO (não fallback silencioso).
- **Templates de prompt em INGLÊS** (correção da revisão do plano).
  `${language}` controla SÓ o idioma da saída da doc gerada.
- **Diagramas em paths SPEC** (correção #2): `livewiki/architecture/structure.mmd`,
  `livewiki/architecture/modules.mmd`, `livewiki/diagrams/<slug>.classes.mmd`.
  `owner: generated` puros — nunca envelhecem.
- **Manifest com snapshot hash** (correção #3): `livewiki/.manifest.json`,
  `snapshotHash = sha256(livewiki/ excluindo o próprio manifest)`. Só regrava
  se conteúdo mudou (anti-loop CI).
- **Refinamento LLM da etapa 2 é opt-in/degradável** (correção #5):
  `--no-refine` pula; falha de LLM degrada pra heurística (não é falha de task).
- **Checkpoint shape**: `usageHistory: [{ attempt, usage, costUsd, finishedAt }]`
  desde attempt 1. Reporte agrega; "usage atual" = último item.
- **Política de falha** (commit d274dd9): task failed → marca + motivo,
  SEGUE. Circuit breaker: 3 falhas CONSECUTIVAS OU (>50% com ≥3 tasks).
  Status: completed / completed_with_failures / aborted.
- **Exit codes**: 0 = completed, 1 = completed_with_failures, 2 = aborted.

## Layout do repo

```
livewiki/
├── SPEC.md                    # fonte de verdade do comportamento
├── VISION.md                  # racional e fora-de-escopo
├── AGENTS.md                  # ESTE ARQUIVO (convenções + estado live)
├── packages/
│   ├── core/                  # @livewiki/core — toda lógica
│   │   ├── src/
│   │   │   ├── index.ts        # public surface
│   │   │   ├── safe-io.ts      # regra #1: escrita só via allowlist
│   │   │   ├── hashes.ts       # sha256 helper
│   │   │   ├── walker.ts       # varre repo respeitando .gitignore
│   │   │   ├── parser.ts       # tree-sitter init + parse source
│   │   │   ├── symbols.ts      # extract symbols do AST (TS/JS/Python)
│   │   │   ├── db.ts           # SQLite schema v3→v4 + migrations
│   │   │   ├── indexer.ts      # walk → read → hash → parse → upsert
│   │   │   ├── anchors.ts      # extrai anchors de markdown
│   │   │   ├── frontmatter.ts  # parser YAML subset
│   │   │   ├── anchor-ledger.ts# Fase 2: diff vs estado anterior → debt
│   │   │   ├── verify.ts       # Fase 2: walk disco, broken_anchor check
│   │   │   ├── status.ts       # status --json report
│   │   │   ├── pricing.ts      # tabela embutida + lookup
│   │   │   ├── config.ts       # .livewiki/config.json load/save
│   │   │   ├── llm/            # client + adapters Anthropic/openai-compat
│   │   │   ├── imports.ts      # extrai imports via tree-sitter
│   │   │   ├── modules.ts      # heurística + edges + priorização
│   │   │   ├── diagrams.ts     # Mermaid determinístico
│   │   │   ├── prompts.ts      # templates (inglês), ${language} no user
│   │   │   ├── batch-state.ts  # tipos do checkpoint_json
│   │   │   ├── manifest.ts     # .manifest.json + snapshotHash
│   │   │   ├── batch.ts        # orquestrador 4 etapas + circuit breaker
│   │   │   ├── batch-status.ts # buildStatusReport (totals + byStage + byModule)
│   │   │   └── init.ts         # livewiki init (layout determinístico + batch)
│   │   └── package.json        # subpath exports pra cada módulo
│   └── cli/                   # @livewiki/cli — thin wrapper
│       └── src/
│           ├── cli.ts          # commander setup + global flags
│           └── commands/
│               ├── init.ts     # livewiki init [--batch | --plan | --no-refine]
│               ├── index.ts    # livewiki index
│               ├── status.ts   # livewiki status
│               ├── update.ts   # livewiki update (stub Fase 5)
│               ├── verify.ts   # livewiki verify
│               ├── batch.ts    # livewiki batch [status|resume|--only|list]
│               ├── serve.ts    # livewiki serve (stub Fase 4)
│               ├── export.ts   # livewiki export (stub Fase 6)
│               └── view.ts     # livewiki view (stub Fase 7)
└── .livewiki/                 # cache derivado do repo (safe-io allowlist)
    ├── index.db               # SQLite schema v4
    └── config.json            # config local do repo
```

## Entry points (o que agente externo vai tocar)

- **CLI `livewiki init`** — cria layout + indexa + (opcional) roda batch.
  Sempre escrito em `packages/cli/src/commands/init.ts` + lógica em
  `packages/core/src/init.ts`. Flags: `--batch`, `--plan`, `--no-refine`.
- **CLI `livewiki batch`** — gerencia runs de documentação.
  `packages/cli/src/commands/batch.ts` + orquestrador em `batch.ts`.
  Subcomandos: `status [<runId>]` (default), `resume <runId>`,
  `--only <target> <runId>`, `list`.
- **CLI `livewiki verify`** — Fase 2. Lê wiki do disco, valida âncoras.
  SEMPRE parseia do disco (Fix C) — âncora em página nunca indexada
  TEM que ser pega (anti-alucinação).

## Workflow de validação

Antes de commitar qualquer mudança em Fase 2 ou 3:

```bash
pnpm -r build         # core + cli
pnpm -r test          # vitest em todos
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e.test.ts
                     # E2E crítico: init --batch end-to-end com stub server
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
                     # regressão CRÍTICA: key NUNCA pode aparecer em output
```

Cobertura atual: **92.1% stmts / 84.05% branches / 95.45% funcs** (acima
do mínimo 80% da regra #5).

## Onde tocar pra cada tipo de mudança

- **Novo command CLI** → `packages/cli/src/commands/<name>.ts` + register em
  `cli.ts`. Se a lógica é reutilizável, vai em `packages/core/src/<name>.ts`
  e expõe via `index.ts` + `package.json` subpath exports.
- **Nova tabela SQLite** → bump `CURRENT_SCHEMA_VERSION` em `db.ts`,
  atualizar `SCHEMA_SQL` (fresh installs) e adicionar migration function
  em `postV3Migrations()` (idempotente — checa colunas antes de ADD).
- **Novo provider LLM** → adapter em `packages/core/src/llm/<provider>.ts`,
  implementar `LlmClient`, registrar no factory em `llm/index.ts`.
- **Novo prompt** → função em `prompts.ts`, system em inglês,
  `${language}` no user prompt como instrução explícita.
- **Novo diagrama determinístico** → adicionar função em `diagrams.ts`,
  escrever no path SPEC (`livewiki/architecture/...` ou `livewiki/diagrams/...`).
- **Bug no circuit breaker / orchestrator** → `packages/core/src/batch.ts`,
  com testes em `batch.test.ts`. Atualizar `packages/cli/src/commands/batch.ts`
  pra novo exit code.

## Gotchas específicos

- **Migrations pós-v3 são funções JS**, não strings SQL. SQLite não tem
  `ADD COLUMN IF NOT EXISTS`. Função checa `PRAGMA table_info` antes.
- **manifest.ts `manifestsEqual` ignora `updatedAt`** — timestamp, não conteúdo.
  Caso contrário, todo `new Date()` gera updatedAt novo e regrava sempre,
  quebrando o anti-loop de CI.
- **Circuit breaker ratio check exige `totalAttempted >= 3`** — sem isso,
  `1 fail / 0 done = 100%` abortaria qualquer run com 1 task.
- **`safeIo.resolveAndValidate` é async** (usa `realpath` async). Não
  existe versão sync — sempre `await`.
- **Edit tool às vezes falha** com "Could not safely match oldString" em
  arquivos grandes. Workaround: Python one-off patch, rodar, deletar com
  `mavis-trash`. Não retry — gasta tokens.
- **PowerShell no Windows**: NÃO usar `&&`, `ls -la`, `head`, `tail`, `grep`.
  Use `;`, `Get-ChildItem`, `Select-Object`, `Select-String`. Se `bash` produzir
  output WSL garbled, troque pra `node`/`python` imediatamente.
- **Lock do git às vezes persiste** — se `git commit` reclamar de
  `index.lock`, aguardar 2s e retry (geralmente o processo já liberou).
  Se persistir, `mavis-trash .git/index.lock` (NÃO use `rm`/`Remove-Item`).

## Estado live (próxima fase: 4 — MCP server)

```bash
# Última validação:
pnpm -r test  → 283 passed + 8 skipped (15.4s)
pnpm -r build → verde
```

Próximos passos planejados:
1. Fase 4: MCP server (`packages/mcp/`) com 6 tools — `livewiki_quickstart`,
   `livewiki_read`, `livewiki_search` (FTS5), `livewiki_debt`, `livewiki_write_doc`
   (com verify antes de aceitar), `livewiki_resolve_debt`.
2. Fase 5: hooks (`post-commit`, `Stop` do Claude Code), skill
   `document-as-you-go`, `livewiki update` (pacote de trabalho incremental),
   pointer opt-in em AGENTS.md/CLAUDE.md.

> **Lembrete do user**: validar doc/spec nova ANTES de codar. Quando Edu
> adiciona algo à SPEC (via commit), comparar com implementação atual
> antes de mergir — não implementar direto, alinhar primeiro.