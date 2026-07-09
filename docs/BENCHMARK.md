# Protocolo de Benchmark — livewiki vs OpenWiki

> Protocolo selado ANTES da execução, para ser reproduzível e à prova de
> "benchmark de marketing". Executar somente após a Fase 3 aprovada na revisão.
> Resultados entram em `docs/benchmark-results/<data>/`.

## Tese a provar

1. **Documentação completa (batch)**: custo em tokens comparável ou menor,
   com qualidade verificável (o que o OpenWiki não tem).
2. **Manutenção incremental (o cenário matador)**: após uma mudança de código,
   o livewiki detecta o que ficou obsoleto de graça (0 tokens) e paga só a
   dívida; o OpenWiki manda o diff + contexto para a LLM decidir. A diferença
   de tokens deve ser de ordem de grandeza.

## Setup (idêntico para os dois)

| Item | Valor |
|---|---|
| Repos-alvo | (a) 1 repo OSS médio real (~20–50k LOC, TS ou Python, a escolher e fixar por commit SHA); (b) o próprio livewiki |
| Modelo | mesmo modelo e mesmo provider para os dois lados (fixar versão exata) |
| Rota | API direta (sem agregador, para usage limpo) |
| Runs | 3 por cenário (mediana reportada; min/max registrados) |
| Versões | fixar versão exata de livewiki e openwiki usadas |

## Cenários

### C1 — Documentação completa do zero
- livewiki: `init --batch` → tokens totais (input/output) do run, por stage.
- OpenWiki: `openwiki --init` (ou equivalente) → tokens totais (via usage da
  API — se a ferramenta não expõe, medir pelo dashboard do provider em janela
  isolada).

### C2 — Incremental: 1 função editada
Editar o corpo de 1 função documentada (mudança semântica real, ~5 linhas),
commitar, e trazer a documentação ao estado atual:
- livewiki: `index` (0 tokens, medir ms) + pagamento da dívida (tokens do
  pacote de trabalho + doc escrita).
- OpenWiki: `--update` → tokens totais.

### C3 — Incremental: refactor (mover função entre arquivos)
Mesmo desenho do C2, com um move — livewiki detecta e reescreve âncora sem LLM;
medir o que cada lado gasta para a doc voltar a ficar correta.

### C4 — Repo já documentado, zero mudanças (guard de custo fixo)
Rodar o update dos dois lados sem nenhuma mudança no código:
- livewiki: `index` → 0 tokens esperado (snapshot hash).
- OpenWiki: `--update` → o que ele gasta para concluir que não há nada a fazer.

## Métricas

**Primária: tokens** (input/output separados — output custa mais caro em
qualquer tabela). USD apenas como anexo estimado.

**Qualidade (onde temos régua e eles não):**
- Taxa de aprovação no `livewiki verify` (páginas geradas sem âncora quebrada)
- Cobertura: % de símbolos ancorados; `undocumented` restante
- **Auditoria cruzada de alucinação**: amostra de N=10 afirmações factuais de
  cada wiki (as duas ferramentas), checadas manualmente contra o código —
  taxa de afirmação falsa. (Manual porque o OpenWiki não tem âncoras; critério
  de "afirmação factual" definido antes da leitura.)
- Tempo de parede por cenário

## Regras de honestidade

1. Protocolo publicado junto com os resultados, incluindo os casos em que o
   OpenWiki ganhar.
2. Nenhum ajuste de prompt/config específico por cenário depois de iniciada a
   medição — config fixada antes.
3. Logs brutos de usage arquivados em `docs/benchmark-results/`.
4. Se alguma medição do lado OpenWiki for aproximada (ferramenta não expõe
   usage), marcar explicitamente como aproximada e descrever o método.

## Pré-requisitos para executar

- [ ] Fase 3 aprovada na revisão empírica
- [ ] API key definida (provider a escolher pelo Eduardo)
- [ ] OpenWiki instalado e funcional na mesma máquina
- [ ] Repo OSS alvo escolhido e fixado por SHA
