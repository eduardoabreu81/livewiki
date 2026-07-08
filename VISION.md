# livewiki — Visão do Produto

> Documento fundador. Define o que o livewiki é, por que existe e as decisões
> de design já tomadas. A especificação executável do MVP está em [SPEC.md](SPEC.md).
> Idioma de trabalho: PT-BR. Docs públicas do produto serão em inglês na fase de release.

## O que é

**livewiki** é uma ferramenta open source de **documentação viva de repositórios**:
uma wiki em markdown, versionada no próprio repo, que se mantém consistente com o
código através de um índice estrutural — e que serve como memória externa para
qualquer LLM (ou humano) continuar o trabalho de onde a sessão anterior parou.

Elevator pitch: *"documentação ancorada no código, verificável e sempre atual —
gerada por quem fez a mudança, no momento em que fez."*

## O problema

1. **Documentação envelhece.** Toda wiki de repo está desatualizada 3 meses depois.
   Ferramentas existentes regeneram tudo via LLM (caro) ou não detectam o que ficou obsoleto.
2. **Handoff entre LLMs é perda de contexto.** Acabou a cota/sessão de um agente,
   o próximo recomeça do zero ou engole 200KB de contexto.
3. **LLMs alucinam documentação.** Doc gerada por LLM cita funções que não existem
   ou comportamentos que o código não tem, e ninguém verifica.
4. **Custo de token.** Jogar o repo inteiro no contexto para documentar (ou para
   retomar trabalho) é o anti-padrão dominante.

## O quadrante vazio (posicionamento)

| Projeto | Estrutura (AST) | Conteúdo (doc) | Tempo real | Publicação | Handoff |
|---|---|---|---|---|---|
| codegraph | ✅ maduro | ❌ | ✅ watcher | ❌ | parcial |
| OpenWiki (LangChain) | ❌ | ✅ | ❌ (git diff) | opcional | ✅ |
| CodeWiki (Google) | ❌ | ✅ | parcial | ✅ cloud | ❌ |
| DeepWiki (Cognition) | ❌ | ✅ | ❌ | ✅ cloud | ❌ |
| agentmemory | ❌ | ❌ (memória) | ✅ hooks | ❌ | ✅ |
| **livewiki** | **✅ (estreito)** | **✅** | **✅** | **✅ (fase 2)** | **✅** |

O diferencial técnico que nenhum concorrente tem: **staleness detectada em nível de
seção, sem gastar token de LLM** — via âncoras entre doc e símbolos do código.

## Princípios não-negociáveis

1. **Seguro por arquitetura**: o livewiki NUNCA escreve fora de `livewiki/` (a wiki)
   e `.livewiki/` (estado interno). Allowlist de paths enforced em código, não promessa de prompt.
2. **Econômico**: LLM só entra para *escrever* doc, nunca para *descobrir* o que
   está desatualizado. Detecção de dívida é determinística (tree-sitter + hashes).
3. **Tool-agnostic**: markdown plain como fonte da verdade. Qualquer LLM lê,
   qualquer editor abre, `grep` funciona. Nada proprietário.
4. **Local-first**: zero cloud obrigatória. Tudo roda na máquina do usuário.
5. **Reconstruível**: o banco é índice derivado. Deletou `.livewiki/`? `reindex`
   reconstrói tudo a partir do repo + wiki. O banco nunca é fonte de verdade.

## Conceitos-chave

### Âncoras (anchors)
Cada página/seção da wiki declara a quais símbolos do código ela se refere
(ex.: `src/auth/login.ts#validateToken`). O índice grava o hash do símbolo
*no momento em que foi documentado*.

### Dívida de documentação (doc debt)
Quando o código muda, o indexador (determinístico, milissegundos) compara hashes
e produz eventos: `changed`, `moved`, `deleted`, `new`. Toda seção ancorada em
símbolo afetado vira **dívida** registrada num ledger. A dívida é visível
(`livewiki status`), acumulável e paga quando o agente/usuário decidir.

### Verificação anti-alucinação
Quando uma LLM escreve/atualiza doc, `livewiki verify` checa: as âncoras citadas
existem? As assinaturas batem? Doc que referencia código inexistente é rejeitada/flagada.

### Conteúdo humano é primeira classe (ownership)
A wiki não é território exclusivo da ferramenta. O dev cria e edita páginas
livremente — visão de negócio, contexto de produto, decisões. Cada página declara
propriedade (`owner: generated | human | mixed`; blocos `lw:manual` em páginas
mistas), e a regra é dura: **LLM nunca reescreve conteúdo humano** (enforced pelo
`verify`, não por convenção). E doc de negócio também pode ter âncora: uma página
`owner: human` ancorada na função que implementa a regra entra na dívida quando o
código muda — mas em vez de ser reescrita, é **sinalizada para revisão humana**.
Rastreabilidade negócio↔código de graça.

### Handoff
A wiki + o manifest versionado (`livewiki/.manifest.json`) são o estado que viaja
no git. Próxima LLM em qualquer máquina: lê o quickstart (baixo token), consulta a
dívida, reconstrói o índice localmente se preciso, e continua — inclusive retomando
um processo de documentação batch interrompido no meio.

## Arquitetura em 3 camadas

```
repo-do-usuário/
├── livewiki/                  # 1. WIKI — markdown, versionado. A VERDADE.
│   ├── .manifest.json         #    último commit documentado + snapshot hash
│   ├── quickstart.md          #    entry point de baixo token para agentes
│   ├── architecture/          #    overview, módulos, diagramas
│   ├── files/                 #    docs por arquivo/módulo (com âncoras)
│   └── decisions/             #    changelog narrativo (handoff entre sessões)
├── .livewiki/                 # 2. ÍNDICE — SQLite, gitignored. DERIVADO.
│   └── index.db               #    símbolos, hashes, âncoras, dívida, pipeline
└── AGENTS.md / CLAUDE.md      # 3. POINTER — 1 parágrafo apontando para a wiki
                               #    (adicionado SÓ com consentimento explícito)
```

## Modos de operação

### Modo incremental (o coração)
Ao fechar um commit/tarefa, um hook roda o check de staleness (sem LLM). Havendo
dívida, o **agente em sessão** é avisado e documenta ele mesmo o que acabou de fazer —
contexto fresco, custo extra de API zero, qualidade máxima. Opt-in por evento:
o agente/usuário pode adiar; a dívida fica no ledger.

### Modo batch (documentação completa)
`livewiki init` documenta um repo existente num pipeline de 4 etapas com checkpoint:
**varredura → identificação de módulos → priorização → documentação coordenada**.
Cada unidade de doc é uma task resumível: acabou a cota no meio, a próxima LLM
continua da task 24/61. Quem gera a doc neste modo: LLM via API configurável
(Anthropic/OpenAI/compatível) OU o próprio agente em sessão trabalhando a fila.

## Superfícies (um core, quatro faces)

| Superfície | Papel |
|---|---|
| **CLI** | `init`, `index`, `status`, `update`, `verify`, `serve`, `export` |
| **MCP server** | tools de leitura/busca da wiki, consulta de dívida, escrita restrita a `livewiki/` |
| **Skills** | ensinam o agente o fluxo: "terminou tarefa → cheque dívida → documente" |
| **Hooks** | templates prontos: git post-commit + hooks de agentes (Claude Code etc.) |

## Decisões tomadas (com racional)

| Decisão | Escolha | Por quê |
|---|---|---|
| Consumidor primário do MVP | **Agente** (handoff + economia) | quadrante vazio do mercado; export humano é transformação posterior |
| Stack | **TypeScript/Node** | ecossistema MCP first-class; `npx` = atrito zero; um codebase, quatro superfícies |
| Parsing | **web-tree-sitter (WASM)** | multi-linguagem sem compilação nativa; funciona liso em Windows/Mac/Linux |
| Indexador | **próprio, estreito** | precisamos de inventário de símbolos + hashes + âncoras, não call-graph completo; codegraph é referência de design, não dependência |
| Fonte da verdade | **markdown versionado** | tool-agnostic, git-diff friendly, sobrevive a qualquer ferramenta |
| Índice | **SQLite gitignored, derivado** | queryable, rápido, reconstruível; nunca viaja no git |
| Handoff cross-máquina | **manifest JSON versionado** | pequeno, viaja no git; o banco reconstrói localmente |
| Quem gera doc | **agente em sessão (coração) + API (batch)** | quem fez a mudança documenta melhor e de graça; API cobre repo legado |
| Detecção de staleness | **determinística, sem LLM** | economia radical: LLM só escreve, nunca procura |
| Nome | **livewiki** | disponível no npm (verificado 08/07/2026); escopo `@livewiki/` para pacotes |

## Pós-MVP já desenhado (fases 6 e 7 da SPEC)

- **Export para wiki de repositório** (`livewiki export`): GitHub wiki, GitLab wiki
  e qualquer host compatível com o formato (repo git de markdown). Transformação
  com perdas e de mão única: achata namespace, reescreve links, remove marcadores
  de âncora, adiciona aviso "gerado pelo livewiki". A fonte da verdade continua
  sendo `livewiki/` no repo — a wiki publicada é produto gerado.
- **Viewer local com templates** (`livewiki view`): site estático autocontido
  (abre no browser sem servidor nem build), com navegação, busca client-side e
  Mermaid renderizado. Templates são **dados** (layout + CSS + manifest), nunca
  código executável — segurança primeiro. MVP de templates: `agent` (denso,
  técnico) e `docs` (limpo, para humanos). Comunidade contribui com mais.

## Fora do escopo desenhado (avaliar depois)

- Embeddings locais + busca semântica (pluggável)
- Diagramas Mermaid elaborados (sequência, classes); MVP tem só grafo de estrutura
- README gerado a partir da wiki
- Distribuição final (npm público, binário) — decidir na validação

## Decisões em aberto

1. **Licença** (MIT vs Apache-2.0) — decidir antes do release público.
2. **Critério de "validada" para abrir o código** — proposta: rodar bem em 3+ repos
   reais do Eduardo + 1 repo externo grande, com dívida detectada corretamente e
   handoff exercitado de verdade entre 2 LLMs diferentes.
3. **Linguagens suportadas no MVP** — proposta: TS/JS, Python (gramáticas WASM
   carregáveis; adicionar linguagem = adicionar gramática).
4. **Granularidade de âncora por seção vs por página** — MVP implementa ambas
   (frontmatter = página; marcador HTML = seção), avaliar na prática.
