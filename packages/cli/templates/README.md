# Livewiki hook templates (Fase 5)

Templates opt-in. Você escolhe instalar — o livewiki **nunca** modifica
configurações de git/Claude automaticamente.

## Por que dois formatos?

| Formato | Quem dispara | Output vai pra |
|---|---|---|
| `git/post-commit` | Todo `git commit` | stderr do terminal |
| `claude-code/settings.local.json` | Todo `Stop` no Claude Code | transcript do agente |

Mesma semântica em ambos: `livewiki index --quiet` → checa dívida → notifica se
houver. **Nunca bloqueia** (sempre exit 0).

## Instalação — git post-commit

Recomendado: `core.hooksPath` (não conflita com outros hooks do projeto).

```bash
# 1. Crie diretório de hooks customizado e copie o template
mkdir -p .git/hooks-livewiki
cp node_modules/@livewiki/cli/templates/git/post-commit .git/hooks-livewiki/post-commit
chmod +x .git/hooks-livewiki/post-commit

# 2. Configure git pra usar esse diretório
git config core.hooksPath .git/hooks-livewiki

# 3. Verifique
git config core.hooksPath
# → .git/hooks-livewiki
```

Próximo `git commit` vai disparar o hook automaticamente.

### Desinstalar

```bash
git config --unset core.hooksPath
rm -rf .git/hooks-livewiki
```

### Instalação alternativa (sem core.hooksPath)

Se você já tem `.git/hooks/` customizado e não quer mexer:

```bash
cp node_modules/@livewiki/cli/templates/git/post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

Cuidado: isso sobrescreve qualquer `post-commit` existente.

## Instalação — Claude Code Stop hook

O hook vive no `.claude/settings.local.json` (não comita) ou `.claude/settings.json`
(equipe inteira compartilha).

```bash
# Crie .claude/ se não existir
mkdir -p .claude

# Opção A: instalar como settings.local.json (só você)
cp node_modules/@livewiki/cli/templates/claude-code/settings.local.json \
   .claude/settings.local.json

# Opção B: merge com settings.json existente (recomendado pra time)
# Adicione manualmente o bloco "hooks" do template ao seu .claude/settings.json
```

No Claude Code, o hook `Stop` dispara quando a sessão termina. O output aparece
no transcript — o agente vê e pode decidir pagar a dívida antes de parar.

### Desinstalar

```bash
rm .claude/settings.local.json
# ou remova manualmente o bloco "hooks.Stop" do seu settings.json
```

## Como funciona

**Detecção (custo zero de token):** `livewiki index --quiet` re-varre o repo,
compara hashes de símbolos, detecta `changed/moved/deleted`. Sem LLM. Pra um
repo médio (50k LOC): < 2s incremental.

**Notificação (stderr/transcript):** se há dívida nova > 0, imprime 1-2 linhas
avisando. Não bloqueia o commit / não re-inicia o agente.

**Quem paga a dívida:** você (via skill `document-as-you-go`) ou o
`livewiki_write_doc` MCP tool. Os hooks só detectam — não chamam LLM.

## Privacidade

- O hook NÃO lê/envia API keys.
- O hook NÃO chama LLM.
- O hook NÃO escreve em lugar nenhum fora de `.livewiki/` (que é o cache derivado).

## Compatibilidade

- `git/post-commit`: bash script. Funciona em Linux/macOS direto; em Windows
  via Git Bash (que é o ambiente onde `git commit` executa hooks).
- `claude-code/settings.local.json`: JSON; copie/merge no seu settings.

## Debug

Se o hook não dispara:

```bash
# git: ver config
git config --get core.hooksPath
ls -la .git/hooks-livewiki/post-commit  # deve ter +x

# Claude Code: validar JSON
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json', 'utf8'))"
```

Se aparecer "livewiki not found", instale:

```bash
npm install --save-dev @livewiki/cli
# ou global
npm install -g @livewiki/cli
```

## GitHub Actions — "docs-debt on merge" (CI template)

The CI sibling of the hooks above: same deterministic detection, same
zero-token cost, on every push to the default branch. Template at
`templates/github-actions/docs-debt.yml`.

**Install** (repo must already have `livewiki/` — run `livewiki init`
once locally first):

```bash
mkdir -p .github/workflows
cp node_modules/@livewiki/cli/templates/github-actions/docs-debt.yml \
   .github/workflows/docs-debt.yml
# adjust `branches: [main]` if your default branch differs
```

**What it does:** checkout (`fetch-depth: 0`, because the risk/churn
factor reads `git log`) → `livewiki index --quiet` → `livewiki status
--json` → a debt summary in the job's step summary. No secrets, no
GitHub App, `contents: read` only. A no-debt merge costs **zero tokens**
— that is the point: the anchor ledger answers "does this merge need
docs?" deterministically.

**Two modes** (env `LIVEWIKI_DEBT_MODE` at the top of the file):

| Mode | Debt > 0 |
|---|---|
| `enforce` (default) | job FAILS — the red check on the merge is the notification |
| `report` | never fails — the step summary is the only signal |

**v1 never calls an LLM and never writes anywhere.** The paid v2 sketch
(provider pays the debt, then opens a draft PR with the merge author as
reviewer): configure provider secrets, run `livewiki update --llm`,
then `gh pr create --draft --title "docs: pay livewiki debt"` — see
ROADMAP §6. Not implemented in this template.