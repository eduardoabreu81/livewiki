---
name: document-as-you-go
description: Quando você termina uma tarefa/commit, pague a dívida de documentação da wiki antes de fechar. Use este skill no Claude Code, OpenCode, Codex CLI ou qualquer agente que tenha a skill MCP do livewiki.
---

# document-as-you-go

Você acabou de fechar uma tarefa, um commit, ou um lote de mudanças. Antes de
parar, pague a dívida de documentação da wiki. **Quem fez a mudança documenta
melhor** — você tem o contexto fresco na cabeça, e isso custa zero tokens de
API.

## Quando usar

Após cada uma destas ações, ANTES de parar a sessão:

- Fechou um commit
- Terminou uma task / subtask
- Fez merge de um branch
- Deixou o trabalho num estado "completo por agora"

**Não use** no meio de uma edição ativa — espere o trabalho estar fechado.

## O que fazer

### 1. Veja a dívida

```bash
livewiki status --json
```

Procure `debt.items` no JSON. Se vazio, **pare aqui** — não tem dívida a pagar.

### 2. Emita o pacote de trabalho

```bash
livewiki update --json
```

Lê o JSON. Ele contém:

- `debt`: lista de itens (changed/moved/deleted) com `symbol_key`, `wiki_path`,
  `assignee`. Você só precisa pagar os de `assignee=agent` (os `human` são
  páginas de negócio que precisam de revisão humana — não toque).
- `snippets`: janelas do source atual em torno de cada âncora. Use como
  contexto — você não precisa reler o arquivo.
- `validAnchors`: as chaves canônicas que você pode ancorar (symbols ativos).
  Distribua essas chaves pelas seções da página — **nunca invente** chave
  fora dessa lista.
- `tokensEstimated`: tamanho do pacote (heurística chars/4). Tese do produto:
  esse número é MENOR que reler o repo inteiro. Mantenha assim.

### 3. Pague cada item — 2 caminhos

#### Caminho A (preferido): MCP `livewiki_write_doc`

Você (agente) tem o tool MCP do livewiki. Para cada dívida:

1. Leia a wiki page correspondente com `livewiki_read`
2. Atualize o conteúdo: adicione a âncora na seção certa, corrija a descrição
   conforme o snippet novo
3. Chame `livewiki_write_doc` com o path completo da wiki page e o conteúdo
   atualizado. Ele roda `verify` antes de aceitar — se anchor quebrar, é
   rejeitado. Corrija e re-tente.

#### Caminho B (manual): edição direta + verify

Se você não tem o MCP (ex.: agente sem MCP configurado), edite o arquivo
`livewiki/<wiki_path>.md` direto no disco, depois:

```bash
livewiki verify
```

Exit code deve ser 0 e **zero issues** (errors E warnings — não só errors).
Se não, corrija até ficar limpo.

### 4. Registre a doc escrita (contabilidade)

Cada write/pay conta pra tese do produto:

```bash
livewiki update --record-write <tokens_estimados>
```

Onde `<tokens_estimados>` é a estimativa do que você escreveu (heurística:
`bytes / 4`). Isso alimenta `efficiencyRatio = write/package` em
`status --json`. A tese é: pacote grande → doc pequena = boa economia.

### 5. Confirme

```bash
livewiki status --json
```

`debt.items` deve estar vazio (ou só com itens `assignee=human`). `metrics`
agrega seus pacotes e writes — você pode ver a si mesmo na economia do
produto.

## Guardrails (regras invioláveis)

1. **Conteúdo humano é intocável**. Se `assignee=human` em uma dívida,
   **não** escreva no markdown — sinalize ao humano no relatório final.
2. **Nenhuma chave inventada**. Use APENAS `validAnchors` do pacote. Doc
   com chave fora do índice é rejeitada pelo `verify`.
3. **Manual blocks preservados byte-a-byte**. Blocos `<!-- lw:manual -->...
   <!-- /lw:manual -->` são propriedade do humano. Se a verificação
   reclamar de `manual_block_altered`, é porque você reescreveu algo que
   não devia — reverta.
4. **Verify limpo é o critério**. Exit 0 não basta — zero issues também.
   `livewiki update` em batch mode (Fase 3) e o E2E do produto usam
   essa regra. Siga o mesmo padrão.

## Quando você NÃO deve pagar a dívida

- **Dívida `assignee=human`**: revisão humana — sinalize, não escreva.
- **Sem âncora correspondente (undocumented)**: o agente não tem contexto
  fresco suficiente; é melhor que o `livewiki init --batch` resolva com LLM.
- **Mudança trivial (typo, formatting)**: avalie se vale a pena pagar;
  dívida trivial pode esperar pela próxima rodada.

## Critério de aceite (SPEC §Fase 5)

> "fluxo de ponta a ponta — agente altera código, hook detecta, agente paga
>  a dívida via MCP, verify passa, manifest atualizado."

Você é o "agente paga a dívida via MCP". Os outros passos são automáticos
(hook Step 3 detecta, manifest atualiza quando verify passa).

## Comandos essenciais (TL;DR)

```bash
livewiki status --json    # ver dívida + métricas
livewiki update --json    # emitir pacote de trabalho
livewiki_write_doc        # MCP — pagar uma página (rodar verify antes)
livewiki verify           # CLI fallback — exit 0 + zero issues
livewiki update --record-write <N>   # contabilizar doc escrita
```

## Privacidade

A skill NÃO toca em API key, NÃO chama LLM diretamente. Se você tem MCP
configurado, o MCP server usa a key do env var. Sem MCP, edite manualmente.
Nunca peça ao humano para colar a key.