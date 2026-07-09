# livewiki — Especificação do MVP

> Especificação executável, fase a fase. Cada fase é funcional sozinha e tem
> critério de aceite. A visão e o racional das decisões estão em [VISION.md](VISION.md).
>
> **Para a LLM executora**: siga as fases em ordem. Não implemente nada de fases
> futuras antecipadamente. Não invente features fora desta spec — dúvida de design
> é pergunta para o Eduardo, não decisão sua. Respeite as [Regras invioláveis](#regras-invioláveis).

## Regras invioláveis

1. **Escrita restrita**: todo código que escreve em disco passa por um módulo único
   de I/O (`src/core/safe-io.ts`) que valida o path contra a allowlist:
   `livewiki/` e `.livewiki/` do repo-alvo (mais a exceção do pointer, regra 2).
   Escrever fora disso = lançar erro. Sem exceções, nem em testes.
2. **Pointer em AGENTS.md/CLAUDE.md**: só com flag explícita (`--write-pointer`)
   ou confirmação interativa. Nunca automático. Modificação é append de bloco
   delimitado (`<!-- livewiki:start -->` ... `<!-- livewiki:end -->`), idempotente.
3. **O banco é derivado**: nenhuma informação pode existir SÓ no SQLite.
   Tudo que importa para handoff vive em markdown/manifest versionados.
4. **Sem telemetria, sem rede** exceto: chamadas de LLM no modo batch (opt-in,
   key do usuário) e download único de gramáticas WASM no primeiro uso.
5. **Testes**: vitest; cobertura mínima 80% no core (indexador, âncoras, dívida,
   safe-io). CLI/MCP podem ter cobertura menor, mas os fluxos principais têm teste
   de integração.
6. **Conteúdo humano é intocável**: páginas `owner: human` e blocos `lw:manual`
   nunca são modificados por escrita automatizada (LLM ou tool). `verify` compara
   blocos manuais byte a byte após cada update; alteração = write rejeitado.
   Dívida em âncora de conteúdo humano não gera reescrita — gera item
   "revisão humana" no `status`.

## Stack

- **Runtime**: Node ≥ 20, TypeScript estrito, ESM
- **Monorepo**: pnpm workspaces — `packages/core`, `packages/cli`, `packages/mcp`
  (se simplificar, começar single-package e extrair depois é aceitável; documentar a escolha)
- **Parsing**: `web-tree-sitter` (WASM). Gramáticas MVP: TypeScript/JavaScript (tsx incluso), Python
- **Banco**: `better-sqlite3` (síncrono, rápido; WAL mode)
- **MCP**: `@modelcontextprotocol/sdk`
- **CLI**: `commander` (ou similar minimalista); saída legível por humano E parseável (`--json` em todo comando)
- **LLM (modo batch)**: cliente HTTP fino próprio, providers: Anthropic + OpenAI-compatível
  (base URL configurável cobre OpenRouter/LiteLLM/Ollama). Sem framework de agentes.
  **Sem modelo default hardcoded**: batch sem config falha com mensagem clara
  pedindo provider/modelo (ou pergunta interativamente). API key SÓ via env var
  (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`); nunca em config.json, checkpoint_json,
  logs ou erros — com teste garantindo.

## Layout gerado no repo-alvo

```
repo-alvo/
├── livewiki/
│   ├── .manifest.json
│   ├── quickstart.md
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── structure.mmd          # organograma Mermaid de diretórios/módulos
│   │   └── modules.mmd            # grafo Mermaid de dependências (imports)
│   ├── diagrams/
│   │   └── <modulo>.classes.mmd   # classDiagram por módulo (quando há classes)
│   ├── files/<slug-do-path>.md    # ex.: src-auth-login.md
│   └── decisions/<data>-<slug>.md
└── .livewiki/
    ├── index.db
    └── config.json                # config local (provider, linguagens, ignores,
                                   # language: idioma da doc gerada — 1 por repo,
                                   # default "en"; afeta só prompts/skills, nunca
                                   # chaves/âncoras/diagramas)
```

### `.manifest.json` (versionado — é o que faz handoff cross-máquina)

```json
{
  "version": 1,
  "lastDocumentedCommit": "<sha>",
  "snapshotHash": "<sha256 do conteúdo de livewiki/ excluindo o próprio manifest>",
  "updatedAt": "<ISO 8601>",
  "pendingBatch": { "runId": "...", "stage": 4, "done": 23, "total": 61 } // ou null
}
```

`snapshotHash` segue o padrão OpenWiki: só regravar manifest se o conteúdo mudou
(evita loop em CI).

### Frontmatter das páginas de doc

```markdown
---
title: Auth — login e sessão
owner: generated                 # generated | human | mixed (default: generated)
anchors:
  - src/auth/login.ts            # âncora de arquivo (página inteira)
  - src/auth/login.ts#validateToken
updated: 2026-07-08
---

## Fluxo de validação
<!-- lw:anchors src/auth/login.ts#validateToken src/auth/session.ts#refresh -->
O token é validado por `validateToken(...)`, que ...
```

- Âncora de **página**: frontmatter. Âncora de **seção**: comentário HTML
  `<!-- lw:anchors ... -->` logo após o heading.
- Formato da chave de símbolo: `caminho/relativo.ext#NomeDoSimbolo`
  (arquivo sem `#símbolo` = âncora no arquivo inteiro).
  Ambiguidade (overloads, símbolos aninhados) resolve com caminho qualificado:
  `#Classe.metodo`.

## Schema do SQLite (`.livewiki/index.db`)

```sql
files(id, path UNIQUE, lang, content_hash, size, mtime, indexed_at)
symbols(id, file_id→files, key UNIQUE, name, kind, signature,
        start_line, end_line, content_hash, status)         -- status: active|deleted
doc_pages(id, wiki_path UNIQUE, owner,                        -- generated|human|mixed
          content_hash, updated_at)
anchors(id, doc_page_id→doc_pages, section_slug NULL,        -- NULL = página
        symbol_key, symbol_hash_at_doc, in_manual_block, created_at)
debt(id, anchor_id→anchors, event,                           -- changed|moved|deleted
     assignee,                                                -- agent|human (derivado do owner/manual)
     detail, detected_at, resolved_at NULL)
undocumented(id, symbol_key, detected_at, dismissed)          -- símbolos novos sem doc
batch_runs(id, started_at, stage, config_json, status)
batch_tasks(id, run_id→batch_runs, stage, target, status,    -- pending|done|failed
            checkpoint_json, updated_at)
meta(key PRIMARY KEY, value)                                  -- schema_version etc.
```

Detecção de **moved**: símbolo some do arquivo A e aparece no arquivo B com o mesmo
`content_hash` (ou nome+assinatura iguais) → evento `moved`, âncoras são atualizadas
automaticamente para a nova chave e a dívida registra `detail` com o de/para.
**Pré-requisito**: símbolos que somem de um arquivo *atualizado* também viram
`status='deleted'` (nunca hard-delete) — sem a row antiga não há hash para casar
o moved. Vale para update de arquivo, não só deleção de arquivo.
**Supersessão ≠ moved**: par com `oldKey === newKey` é re-index do mesmo símbolo,
nunca gera evento. Após o ledger, rows `deleted` cuja key tem row `active` são
expurgadas (senão a tabela cresce uma row morta por símbolo a cada edit).
**Onde a âncora é atualizada**: no **markdown** (frontmatter + marcadores), via
safe-io — o banco é derivado (regra 3), atualizar só o DB se perde no rebuild.
Ordem: rewrite markdown → update DB → criar dívida. Exceção (regra 6): âncora em
bloco `lw:manual` ou página `owner: human` NÃO é reescrita — vira dívida `moved`
com assignee=`human`.

**Dedup de dívida**: não criar dívida nova se já existe dívida ABERTA
(`resolved_at IS NULL`) para a mesma âncora + mesmo evento — senão cada
`index` re-flagra os mesmos itens e o ledger vira ruído. Dívida também deve
carregar o `symbol_key` (em coluna ou `detail`), para não ficar órfã se a
âncora for removida depois.

## Comandos CLI

| Comando | Comportamento |
|---|---|
| `livewiki init` | cria `livewiki/` + `.livewiki/`, indexa o repo, gera `quickstart.md` + `structure.mmd` mínimos (sem LLM). Com `--batch` dispara o pipeline de documentação completa |
| `livewiki index` | (re)indexa: varre arquivos (respeita `.gitignore` + ignores do config), extrai símbolos, atualiza hashes, gera eventos de dívida. Idempotente. `.livewiki/` ausente é auto-criado **sem aviso** (é cache derivado; reconstruí-lo é o fluxo normal pós-clone/handoff — nunca exigir `init`). Se a wiki `livewiki/` também não existe, indexa mesmo assim e emite nota informativa sugerindo `init` (exit 0) |
| `livewiki status` | mostra: dívida aberta (por página/seção/evento), símbolos novos sem doc, batch pendente. `--json` para consumo por agente |
| `livewiki update` | modo incremental: dado o diff desde `lastDocumentedCommit`, lista a dívida e (a) emite o "pacote de trabalho" para o agente em sessão documentar, ou (b) com `--llm` chama a API configurada para pagar a dívida |
| `livewiki verify` | valida a wiki: âncoras apontam para símbolos existentes? assinaturas citadas batem? links internos ok? Sai com código ≠ 0 se falhar (CI-friendly). **Parseia a wiki fresca do disco** — âncora em página nunca indexada TEM que ser pega (é a promessa anti-alucinação: doc recém-escrita por LLM é validável sem rodar `index` antes) |
| `livewiki serve` | sobe o MCP server (stdio) |
| `livewiki batch <run>` | continua/inspeciona um run de documentação completa (resume por task). `--only <task-id\|módulo>` re-roda 1 task (mesma interface que o modo em-sessão usa para trabalhar a fila); regeneração preserva blocos `lw:manual` byte a byte, recusa página `owner: human`, e soma o novo `usage` no checkpoint (retry custa token e aparece no reporte) |
| `livewiki export <target>` | (fase 6) exporta a wiki para formato de wiki de repositório: `github-wiki`, `gitlab-wiki`, `generic` (diretório de md achatado). `--push <remote>` opcional |
| `livewiki view` | (fase 7) gera site estático autocontido em `.livewiki/site/` e abre no browser. `--template <agent\|docs>`, `--out <dir>` para publicar |

Todos os comandos: `--json`, `--repo <path>` (default cwd), exit codes consistentes.

## MCP tools (fase 4)

| Tool | Ação |
|---|---|
| `livewiki_quickstart` | retorna quickstart.md (entry point de baixo token) |
| `livewiki_read` | lê página da wiki por path |
| `livewiki_search` | busca full-text na wiki (SQLite FTS5) |
| `livewiki_debt` | dívida aberta (equivale a `status --json`) |
| `livewiki_write_doc` | escreve/atualiza página (path validado pela allowlist; roda `verify` no conteúdo antes de aceitar) |
| `livewiki_resolve_debt` | marca dívida como paga (vinculada a um write) |

## Pipeline batch (4 etapas, resumível)

1. **Varredura**: `index` completo; snapshot dos símbolos.
2. **Identificação de módulos**: agrupamento por diretório + grafo de imports
   (heurística determinística; LLM pode refinar nomes/limites dos módulos — 1 chamada).
3. **Priorização**: ordena módulos por centralidade (quantos outros dependem) e
   tamanho; usuário pode reordenar/excluir (`--plan` mostra o plano antes de rodar).
4. **Documentação coordenada**: para cada módulo (task): contexto = símbolos + código
   relevante (limitado por orçamento de tokens configurável) → LLM gera página com
   âncoras → `verify` → grava → checkpoint. Falhou/interrompeu? task fica `pending`,
   resume depois.

**Política de falha do run**: task que falha no verify pós-escrita → marca `failed`
com motivo no checkpoint e SEGUE para a próxima (falha isolada não custa o run;
retry cirúrgico via `--only`). **Circuit breaker**: 3 falhas consecutivas ou >50%
de falha no run → aborta com diagnóstico (falha em série = problema sistêmico;
continuar queima token). Run terminado com falhas: status `completed_with_failures`,
exit ≠ 0, reporte lista cada task falha com motivo + comando de retry pronto.

Ao final: gera/atualiza `quickstart.md` e `architecture/overview.md`, grava manifest.

### Contabilidade de tokens (Fase 3)

Economia é tese central do produto — então é medida, não estimada:
- **Batch**: cada task grava no checkpoint o `usage` real da API (input/output
  tokens + modelo). `livewiki batch <run>` reporta por módulo e acumulado, com
  custo estimado em USD. Objetivo: comparação reproduzível com OpenWiki e afins.
- **Incremental**: o `update` registra o tamanho (tokens estimados por tokenizer)
  do pacote de trabalho emitido ao agente e da doc escrita de volta. Métricas em
  tabela própria no `.livewiki/`, expostas via `status --json`.
- A instrução de âncoras no prompt do batch é fechada: a LLM recebe a lista de
  chaves canônicas do módulo (vindas do índice) e **distribui** essas chaves
  pelas seções — nunca inventa chave. `verify` rejeita chave fora do índice.

## Skills e hooks (fase 5)

- **Skill "document-as-you-go"** (markdown, formato Claude Code skills): instrui o
  agente a rodar `livewiki status --json` ao fechar tarefa/commit e pagar a dívida
  via `livewiki_write_doc` (MCP) ou edição direta + `verify`.
- **Hook git post-commit** (template, instalação opt-in via `core.hooksPath`):
  roda `livewiki index --quiet`; se dívida nova, imprime resumo no terminal
  (não bloqueia o commit).
- **Hook Claude Code Stop** (template em `templates/`): idem, formato JSON de hooks.

## Fases de implementação

### Fase 0 — Scaffold ✅ critério: `pnpm build && pnpm exec livewiki --help` funciona no root do workspace
(Nota: `npx livewiki` de atrito zero refere-se ao pacote publicado no npm, na
fase de distribuição — não ao repo de desenvolvimento.)
Estrutura do repo, TS/ESM/pnpm, vitest, CI local (`pnpm test && pnpm build`),
CLI skeleton com todos os comandos registrados (stubs), `safe-io` implementado
**primeiro e com testes** (é a regra 1).

### Fase 1 — Indexador ✅ critério: `livewiki index && livewiki status` num repo TS real lista arquivos/símbolos corretos
web-tree-sitter + gramáticas TS/JS/Python, extração de símbolos (funções, classes,
métodos, exports), hashes, SQLite schema, respeito a `.gitignore`.
Performance alvo: repo de 50k LOC indexado em < 30s no primeiro run, < 2s incremental.

### Fase 2 — Âncoras e dívida ✅ critério: editar uma função ancorada gera dívida `changed`; mover gera `moved`; rodar `verify` pega âncora quebrada
Parser de frontmatter + marcadores `lw:anchors`, tabelas anchors/debt/undocumented,
diff de índice → eventos, `livewiki status` completo, `livewiki verify`.
**Esta fase é o produto.** Testes exaustivos aqui.

### Fase 3 — Init e batch ✅ critério: `livewiki init --batch` num repo médio gera wiki completa; interromper no meio e rodar `batch resume` continua da task certa
Estrutura da wiki, quickstart/structure.mmd sem LLM, cliente LLM (Anthropic +
OpenAI-compat), pipeline 4 etapas com checkpoints, manifest + snapshot hash.

**Diagramas determinísticos (sem LLM, regenerados a cada `index`/`init`)**:
`structure.mmd` (organograma de diretórios/módulos), `modules.mmd` (grafo de
dependências por imports — subproduto da etapa 2 do pipeline) e
`diagrams/<modulo>.classes.mmd` (classDiagram Mermaid: classes/métodos/herança,
direto da tabela `symbols`). São `owner: generated` puros: nunca envelhecem,
nunca entram em dívida — quem muda é o gerador. Grafos grandes: diagrama por
módulo, nunca um mega-diagrama do repo inteiro. Call-graph de funções e
diagramas de sequência estão FORA (ver "Fora do escopo desenhado" na VISION).

### Fase 4 — MCP server ✅ critério: conectado ao Claude Code, as 6 tools funcionam; `livewiki_write_doc` rejeita path fora de `livewiki/` e conteúdo que não passa no verify
FTS5 para search, server stdio, testes de integração com MCP inspector.

### Fase 5 — Skills, hooks e modo incremental completo ✅ critério: fluxo de ponta a ponta — agente altera código, hook detecta, agente paga a dívida via MCP, `verify` passa, manifest atualizado
Templates de hooks, skill document-as-you-go, `livewiki update`, pointer opt-in
em AGENTS.md/CLAUDE.md.

---

*As fases 6 e 7 são pós-MVP: só começam depois da validação do loop agent-first
(fases 0–5). Estão especificadas aqui para não redesenhar depois.*

### Fase 6 — Export para wikis de repositório ✅ critério: `livewiki export github-wiki --push` publica uma wiki navegável no GitHub com links funcionando; re-export é idempotente
Transformação de mão única, com perdas, `livewiki/` → formato wiki de repo:
- **Achatamento de namespace**: `architecture/overview.md` → `architecture-overview.md`;
  `quickstart.md` → `Home.md` (GitHub) / página inicial equivalente (GitLab)
- **Reescrita de links** internos para o formato do alvo; **remoção** de
  frontmatter de âncoras e marcadores `lw:anchors`
- **Aviso em cada página**: "gerada pelo livewiki a partir de `livewiki/` — não
  edite aqui" + link para a fonte
- **Guarda de sobrescrita**: se a página no alvo não tem o marcador do livewiki
  (foi editada à mão ou criada por terceiro), avisa e exige `--force`
- Targets MVP: `github-wiki`, `gitlab-wiki`, `generic`. Push via git (o wiki repo
  é um clone git normal); sem chamadas de API proprietárias

### Fase 7 — Viewer local + templates ✅ critério: `livewiki view` abre no browser um site navegável com busca funcionando offline; trocar `--template` muda o visual sem regenerar conteúdo
Site estático autocontido gerado em `.livewiki/site/` (gitignored; `--out` para
publicar onde quiser, ex.: GitHub Pages):
- **Zero build step, zero servidor**: HTML+CSS+JS estáticos, funciona via `file://`
- **Busca client-side**: índice JSON pré-construído na geração (título, headings,
  corpo); sem rede
- **Mermaid renderizado** (lib embutida no site gerado, não CDN)
- **Templates como dados**: layout HTML + CSS + `template.json` (nome, versão,
  slots). NUNCA JS de template executado no gerador — o JS do site é o do
  livewiki, o template só estiliza. Templates MVP: `agent` e `docs`
- Template resolvível de `.livewiki/templates/<nome>/` (custom local) ou embutido

## Validação (critério de "pronto para considerar open source")

1. Rodar em 3+ repos reais do Eduardo + 1 repo externo grande sem crash.
2. Dívida detectada corretamente em cenários: edit, move, delete, rename de arquivo.
3. Handoff real exercitado: LLM A documenta parcialmente (batch interrompido),
   LLM B (outra ferramenta/vendor) retoma e conclui usando só wiki + manifest.
4. `verify` pega pelo menos um caso real de alucinação de doc.
5. Custo medido: modo incremental com custo de API zero; batch com custo por
   módulo previsível e reportado.
