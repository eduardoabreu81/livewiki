# AGENTS.md — livewiki

> Para LLMs/agents trabalhando neste repo. **Estado live em
> `status`**: Fase 4 completa (MCP server + 6 tools + FTS5 + tests com
> InMemoryTransport) + Fase 3 rev2 empírica + correções (O, P).
> Próxima fase (5): skills, hooks, update incremental.

## TL;DR

livewiki é uma ferramenta de documentação técnica agent-first. O coração é o
**pipeline batch de 4 etapas** (varredura → módulos → priorização → documentação)
que chama LLM pra gerar páginas Markdown âncoradas em símbolos do código,
validando pós-escrita via `verify` (broken_anchor = chave fora do índice).
O **MCP server (Fase 4)** expõe a wiki via 6 tools pra qualquer client MCP
(Claude Code, Cursor, Codex, etc.) — busca FTS5, leitura, escrita
validada e gestão de dívida.

Estado do projeto:
- **Fase 0** (scaffold + safe-io) ✅
- **Fase 1** (indexador com web-tree-sitter) ✅
- **Fase 2** (âncoras + dívida + verify) ✅
- **Fase 3** (init + batch + LLM client + diagrams + contabilidade) ✅
- **Fase 3 rev2** (correções empíricas H–M) ✅
- **Fase 4** (MCP server: 6 tools + FTS5 + stdio) ✅
- **Fase 5** (skills + hooks + update incremental + pointer) — próxima
- **Fase 6** (export pra github-wiki/gitlab-wiki/generic) — pós-MVP
- **Fase 7** (viewer local + templates) — pós-MVP

Critério de aceite da Fase 3 (SPEC): `livewiki init --batch` num repo médio
gera wiki completa; interromper no meio + `batch resume` continua da task certa;
verify pega pelo menos um caso real de alucinação de doc. Rev2 empírica
(commit ad87319) adiciona cenário de subdiretórios + NodeNext + openai-compat
(coberto por `cli-batch-e2e-subdirs.test.ts` na CLI).

Critério de aceite da Fase 4 (SPEC): conectado a um client MCP real;
`livewiki_write_doc` rejeita path fora de `livewiki/` e conteúdo que não passa
no verify. Coberto por `packages/mcp/src/server.test.ts` (12 cenários E2E com
InMemoryTransport — não precisa de stdio real).

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
   (E2E via stub HTTP server / InMemoryTransport).
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
  se conteúdo mudou (anti-loop CI). `init.ts` NUNCA lista em `filesWritten`
  um manifest que não foi regravado (FIX M rev2).
- **Refinamento LLM da etapa 2 é opt-in/degradável** (correção #5):
  `--no-refine` pula; falha de LLM degrada pra heurística (não é falha de task).
  Validação do refined (FIX I rev2): rejeita `{"modules": []}`, JSON malformado,
  módulos duplicados/sem id, ou cobertura < 80% dos arquivos heurísticos.
  Em qualquer rejeição, heurística vence e erro vai pro checkpoint do stage 2.
- **Checkpoint shape**: `usageHistory: [{ attempt, usage, costUsd, finishedAt }]`
  desde attempt 1. Reporte agrega; "usage atual" = último item.
- **Política de falha** (commit d274dd9): task failed → marca + motivo,
  SEGUE. Circuit breaker: 3 falhas CONSECUTIVAS OU (>50% com ≥3 tasks).
  Status: completed / completed_with_failures / aborted.
- **Exit codes**: 0 = completed, 1 = completed_with_failures, 2 = aborted.
  Fonte única de verdade: `core/batch.ts:statusToExitCode()`. CLI usa
  `process.exitCode = N` (nunca `process.exit(N)`) pra preservar FIX L.
- **Token-first no reporte** (ad87319): tokens são a métrica primária em
  `livewiki batch status` (humano e JSON); USD aparece como linha secundária
  marcada "estimado, tabela de <data>", omitida sem drama quando não há
  pricing. `formatStatusHuman` e `formatResultHuman` em
  `packages/cli/src/commands/batch.ts` lideram com tokens; USD só aparece
  se `costUsd !== null` em algum stage.
- **Checkpoint shape** (FIX J rev2): `batch_tasks.checkpoint_json` é JSON
  puro. Módulos refinados vivem em `batch_runs.summary_json` (campo
  `modulesRefined`), NUNCA concatenados no JSON da task (isso corrompia o
  parse e zerava o usage do stage 2 no status). `BatchRunSummary` ganhou
  `modulesRefined: Array<{id, paths}> | null`; `buildStatusReport` expõe
  via `run.summary`.
- **Guard de pipeline vazio** (FIX H rev2): se `ordered.length > 0` E
  `tasksToRun.length === 0` (heurística achou módulos, batch tem 0 tasks),
  `runBatch` joga `EmptyPipelineError` → status vira `completed_with_failures`
  (exit 1), nunca `completed` (exit 0). Também: run com `cb.done === 0` E
  `ordered.length > 0` é forçado a `completed_with_failures`.
- **Imports NodeNext** (FIX K rev2): `modules.ts:resolveRelativeImport`
  strip da extensão `.js`/`.jsx`/`.mjs`/`.cjs` antes de tentar candidatos.
  `import x from "../utils/crypto.js"` agora resolve pra `crypto.ts` (ou
  `.tsx`, `.js`, etc) e `index.js` é tratado como barrel.
- **Cleanup de processo** (FIX L rev2): CLI usa `process.exitCode = N; return`
  em vez de `process.exit(N)` nos catch de init/batch. Evita libuv assert
  (STATUS_STACK_BUFFER_OVERRUN = exit -1073740791) quando há handles async
  abertos (fetch, WAL do SQLite, watcher). Node drena o event loop antes
  de sair.
- **Exit code propagation init --batch** (O): `livewiki init --batch`
  propaga o status do batch via `InitResult.batchExitCode` (calculado por
  `statusToExitCode()`). Sem isso, abort/completed_with_failures saíam com
  exit 0 e mascaravam falha sistêmica. `--json` sempre exit 0 (output
  estruturado, convenção batch CLI). Testado em `cli-batch-e2e.test.ts`
  (4 cenários novos: aborted/completed_with_failures/completed/--json).
- **`architecture/overview.md` no init** (P): SPEC §"Pipeline batch" pede
  "gera/atualiza quickstart.md e architecture/overview.md". Antes do fix,
  quickstart linkava pra `#<m.id>` mas overview não existia — verify
  emitia WARNs. Agora init gera `livewiki/architecture/overview.md` no
  fluxo base (com módulos heurísticos) — batch re-gera com pages linkadas.
  Anchors `<a id="...">` HTML inline garantem match exato com o link do
  quickstart, independente do renderer markdown. Testado em
  `cli-batch-e2e.test.ts` (3 cenários novos: init base, init --batch,
  cross-check links↔anchors).
- **FTS5 em DB separado** (Fase 4): `livewiki_search` usa `.livewiki/search.db`
  (NÃO o `index.db` — evita mexer em schema v4/migrations). Rebuild
  completo no startup do MCP server (rápido, idempotente); update
  incremental via `indexPage()` no `write_doc`. Tokenizer porter (default
  FTS5). Decisão em `packages/mcp/src/search.ts:doc`.
- **MCP write_doc = 2 fases** (Fase 4): (1) `safe-io.writeText` (allowlist)
  (2) `verify.run` no repo. Se verify reporta `error` issue na página,
  rollback (apaga arquivo) + retorna `isError=true` com detalhe. `skipVerify`
  é escape documentado pra páginas sem anchor (quickstart). Mesma
  allowlist do regra #1 + mesma checagem do verify pós-batch.
- **Windows + search.db**: better-sqlite3 abre o search.db com WAL
  (search.db-shm / search.db-wal). Testes E2E MCP precisam fechar o
  server (via `server.close()`) antes do afterEach rodar `rm` recursivo —
  caso contrário EBUSY em Windows.

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
│   ├── cli/                   # @livewiki/cli — thin wrapper
│   │   └── src/
│   │       ├── cli.ts          # commander setup + global flags
│   │       └── commands/
│   │           ├── init.ts     # livewiki init [--batch | --plan | --no-refine]
│   │           ├── index.ts    # livewiki index
│   │           ├── status.ts   # livewiki status
│   │           ├── update.ts   # livewiki update (stub Fase 5)
│   │           ├── verify.ts   # livewiki verify
│   │           ├── batch.ts    # livewiki batch [status|resume|--only|list]
│   │           ├── serve.ts    # livewiki serve (Fase 4 — agora redireciona pro mcp)
│   │           ├── export.ts   # livewiki export (stub Fase 6)
│   │           └── view.ts     # livewiki view (stub Fase 7)
│   └── mcp/                   # @livewiki/mcp — Fase 4: MCP server
│       └── src/
│           ├── server.ts       # McpServer + 6 tools
│           ├── search.ts       # FTS5 (.livewiki/search.db)
│           └── index.ts        # entry point stdio (npx livewiki-mcp --repo)
└── .livewiki/                 # cache derivado do repo (safe-io allowlist)
    ├── index.db               # SQLite schema v4
    ├── search.db              # SQLite FTS5 (MCP, Fase 4)
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
- **E2E rev2** — `packages/cli/src/cli-batch-e2e-subdirs.test.ts` captura
  o cenário empírico do revisor: 3 subdiretórios + imports NodeNext +
  openai-compat. Cobre H (3 páginas geradas, não 0), I (refine
  modules:[] rejeitado), K (edges com NodeNext), M (filesWritten sem
  manifest idempotente), L (erro de config com exit limpo).
- **MCP server (Fase 4)** — `packages/mcp/src/server.ts` define McpServer
  com 6 tools; `packages/mcp/src/index.ts` é o entry point stdio
  (`npx livewiki-mcp --repo <path>`). Configuração típica em Claude Code:
  ```json
  {
    "mcpServers": {
      "livewiki": {
        "command": "npx",
        "args": ["-y", "@livewiki/mcp", "--repo", "/path/to/repo"]
      }
    }
  }
  ```
  Tools (todas documentadas no docstring do server.ts):
  - `livewiki_quickstart` — retorna `livewiki/quickstart.md`
  - `livewiki_read` — lê página da wiki (allowlist livewiki/)
  - `livewiki_search` — busca full-text FTS5 (rebuilt no startup)
  - `livewiki_debt` — dívida aberta (= `livewiki status --json`)
  - `livewiki_write_doc` — escreve página (allowlist + verify pós-escrita)
  - `livewiki_resolve_debt` — fecha dívidas por ID
- **MCP E2E** — `packages/mcp/src/server.test.ts` cobre todos os 6 tools
  + 6 cenários de erro/rejeição (12 testes). Usa `InMemoryTransport` do
  SDK MCP — não precisa de stdio real nem de subprocess.

## Workflow de validação

Antes de commitar qualquer mudança em Fase 2, 3 ou 4:

```bash
pnpm -r build         # core + cli + mcp
pnpm -r test          # vitest em todos
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e.test.ts
                     # E2E crítico: init --batch end-to-end com stub server (anthropic)
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e-subdirs.test.ts
                     # E2E rev2: subdiretórios + NodeNext + openai-compat (achados H–M)
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
                     # regressão CRÍTICA: key NUNCA pode aparecer em output
pnpm --filter @livewiki/mcp test
                     # Fase 4: 6 tools E2E (InMemoryTransport)
```

Cobertura atual: **80.09% stmts / 80.1% branches / 93.1% funcs** (acima
do mínimo 80% da regra #5; queda vs 92.1% da rev1 porque `init.ts` e
`batch.ts` são cobertos via E2E/subprocess, não unit — esses arquivos
explicitamente fora do `vitest` unit suite).

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
- **Nova tool MCP** → adicionar `server.tool(name, desc, schema, handler)`
  em `packages/mcp/src/server.ts`. Schema com `zod`. Se precisa de nova
  operação no core, adicionar lá e importar aqui (não duplicar lógica).
  Atualizar `server.test.ts` com cenário E2E.

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
- **MCP write_doc rollback** — se verify rejeitar após write, apaga o
  arquivo que acabou de ser escrito (best-effort). Garante que estado
  inconsistente não persiste (regra #3: disco é a verdade).
- **MCP FTS5 rebuild no startup** — `openAndIndex` reindexa todas as
  páginas markdown. Se você só adicionou uma página via `write_doc`,
  ele já atualiza incrementalmente; não precisa reiniciar o server.
- **Edit tool às vezes falha** com "Could not safely match oldString" em
  arquivos grandes. Workaround: Python one-off patch, rodar, deletar com
  `mavis-trash`. Não retry — gasta tokens.
- **PowerShell no Windows**: NÃO usar `&&`, `ls -la`, `head`, `tail`, `grep`.
  Use `;`, `Get-ChildItem`, `Select-Object`, `Select-String`. Se `bash` produzir
  output WSL garbled, troque pra `node`/`python` imediatamente.
- **Lock do git às vezes persiste** — se `git commit` reclamar de
  `index.lock`, aguardar 2s e retry (geralmente o processo já liberou).
  Se persistir, `mavis-trash .git/index.lock` (NÃO use `rm`/`Remove-Item`).

## Estado live (próxima fase: 5 — skills + hooks + update)

```bash
# Última validação (Fase 3 + Fase 4 + fixes O/P):
pnpm -r test  → 307 passed + 8 skipped (core 265 + cli 30 + mcp 12)
pnpm -r build → verde (core + cli + mcp)
```

Próximos passos planejados:
1. Fase 5: hooks (`post-commit`, `Stop` do Claude Code), skill
   `document-as-you-go`, `livewiki update` (pacote de trabalho incremental),
   pointer opt-in em AGENTS.md/CLAUDE.md.
2. **Presets de provider** (ad87319 — docs já na SPEC, código pra próximo
   ciclo): tabela embutida de anthropic/openai/openrouter/deepseek/kimi/
   minimax/gemini/nvidia/ollama/lmstudio com baseUrl + adapter + env var +
   pricing default. `config.json` referencia o preset e sobrescreve.
3. Fase 6: export pra github-wiki/gitlab-wiki/generic.
4. Fase 7: viewer local + templates.

> **Lembrete do user**: validar doc/spec nova ANTES de codar. Quando Edu
> adiciona algo à SPEC (via commit), comparar com implementação atual
> antes de mergir — não implementar direto, alinhar primeiro.