# @livewiki/cli

The `livewiki` command — living repository documentation, anchored to code
and verifiable against hallucination.

**Full guide, philosophy, and benchmarks:**
[github.com/eduardoabreu81/livewiki](https://github.com/eduardoabreu81/livewiki)

## Install

Requires **Node.js 24 or newer**.

```bash
npm install -g @livewiki/cli
```

(or prefix every command with `npx @livewiki/cli`)

## First steps

```bash
livewiki init      # index the repo + create the wiki layout (zero tokens)
livewiki install   # wire your agent (MCP server, hooks, skill) — optional
livewiki status    # open documentation debt, risk-ranked
livewiki verify    # anti-hallucination gate — exits non-zero on any issue
livewiki view      # self-contained offline site with search and Mermaid
```

Writing docs can be done two ways: your own agent in-session (no extra
API key — `livewiki install` sets it up), or an unattended full-repo run
(`livewiki init --batch` with a provider preset in
`.livewiki/config.json` and the key in an env var). Both produce the same
wiki and mix freely.

## Related packages

- [`@livewiki/mcp`](https://www.npmjs.com/package/@livewiki/mcp) — MCP
  server for any MCP client (Claude Code, Cursor, Codex, …)
- [`@livewiki/core`](https://www.npmjs.com/package/@livewiki/core) — the
  library underneath: indexer, anchors, ledger, pipeline

## License

MIT
