---
title: src/frontmatter.ts
owner: generated
anchors:
  - packages/core/src/frontmatter.ts#FrontmatterParseError
  - packages/core/src/frontmatter.ts#FrontmatterParseError.constructor
  - packages/core/src/frontmatter.ts#getAnchors
  - packages/core/src/frontmatter.ts#getOwner
  - packages/core/src/frontmatter.ts#parseFrontmatter
  - packages/core/src/frontmatter.ts#parseYamlBlock
  - packages/core/src/frontmatter.ts#stripComment
---

# `src/frontmatter.ts`

Parser de um subset de YAML usado nos arquivos da wiki. Mantido como parser próprio (em vez de dependência `yaml`) porque o uso é limitado a chaves top-level, listas de strings e comentários.

Limitações intencionais do subset:

- Sem listas aninhadas, mapas aninhados ou strings multi-linha (`|`, `>`).
- Sem booleans/null tipados — valores são sempre strings (`"true"`, `"false"`, `"null"`).
- Sem âncoras/aliases (`&foo`, `*foo`).
- Sem escape `\"` dentro de strings.

## `parseFrontmatter`
<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter -->

Ponto de entrada do módulo. Recebe o `source` completo da página e retorna um `ParseResult` com:

- `frontmatter`: mapa de campos, ou `null` se a página não começa com `---`.
- `body`: conteúdo markdown após o `---` de fechamento.
- `bodyOffset`: byte offset onde o body começa no `source` original.

Comportamento relevante:

- Normaliza line endings (`\r\n` → `\n`) antes de parsear.
- Se a string não começa com `---\n`, devolve `frontmatter: null` (não é erro — páginas sem frontmatter são permitidas).
- Se abre com `---` mas não encontra o `\n---` de fechamento, lança `FrontmatterParseError` na linha 1.
- Delega o parsing do bloco interno para `parseYamlBlock`.

## `parseYamlBlock`
<!-- lw:anchors packages/core/src/frontmatter.ts#parseYamlBlock -->

Função interna (não exportada) que transforma a string YAML do bloco em um `Frontmatter` (`Record<string, string | string[]>`).

Regras de parsing:

- Linhas vazias ou começando com `#` são ignoradas.
- Itens de lista: `  - valor` (indent + dash + espaço). Exigem uma chave anterior; caso contrário lança `FrontmatterParseError` com a linha corrente.
- Linhas `chave: valor` viram `out[chave] = string` e resetam o estado de lista corrente.
- Linhas `chave:` (sem valor) iniciam uma lista: `out[chave] = []` e marcam a chave como `currentListKey`.
- Qualquer linha que não case os formatos acima lança `FrontmatterParseError` com a linha corrente.
- Comentários inline são removidos via `stripComment` antes da interpretação.

## `stripComment`
<!-- lw:anchors packages/core/src/frontmatter.ts#stripComment -->

Helper interno. Remove comentário inline a partir de ` #` (espaço + `#`) até o fim da string. Não reconhece `#` dentro de strings — o subset não suporta aspas escapadas, então a presença de `#` em valores é tratada como comentário.

## `FrontmatterParseError`
<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError -->

Erro lançado por `parseFrontmatter` e `parseYamlBlock` quando o frontmatter está malformado. Estende `Error` e fixa `name` como `"FrontmatterParseError"`. Carrega o número da linha onde o erro foi detectado no campo público `line`.

### Construtor
<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError.constructor -->

Assinatura: `constructor(message: string, line: number)`.

Formata a mensagem como `Frontmatter parse error (line <line>): <message>` e armazena `line` como propriedade readonly. Usado tanto em erros de sintaxe (linha inválida, item de lista sem chave) quanto em erros estruturais (frontmatter aberto sem fechamento).

## `getAnchors`
<!-- lw:anchors packages/core/src/frontmatter.ts#getAnchors -->

Helper exportado. Lê o campo `anchors` do frontmatter e devolve um `string[]`.

- Se `fm` é `null`, retorna `[]`.
- Se `fm["anchors"]` é um array, retorna-o.
- Caso contrário (string, ausente, valor de outro tipo), retorna `[]`.

Útil para consumidores que precisam iterar anchors sem checar forma do valor.

## `getOwner`
<!-- lw:anchors packages/core/src/frontmatter.ts#getOwner -->

Helper exportado. Lê o campo `owner` e normaliza para a união `"generated" | "human" | "mixed"`.

- Se `fm` é `null`, retorna `"generated"` (default).
- Se `fm["owner"]` é exatamente `"human"`, `"mixed"` ou `"generated"`, retorna o valor.
- Qualquer outro valor (string não reconhecida, array, ausente) retorna `"generated"`.

TODO: documentar convenção de quando cada valor deve aparecer (gerador vs. humano vs. misto) — a política de ownership não está descrita neste módulo.