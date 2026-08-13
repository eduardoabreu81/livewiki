# @livewiki/cli

The `livewiki` command builds a Markdown wiki beside your code, detects when
documentation becomes stale, and validates its references.

**Full guide and dated benchmark archive:**
[github.com/eduardoabreu81/livewiki](https://github.com/eduardoabreu81/livewiki)

## Install

Requires **Node.js 24 or newer**.

```bash
npm install -g @livewiki/cli
```

You can also prefix commands with `npx @livewiki/cli`.

## Lifecycle

### 1. Initialize

```bash
livewiki init
```

This indexes the repository and creates the wiki skeleton without calling an
LLM.

### 2. Bootstrap once

The unattended full-repository pass currently connects directly to an LLM
API. Run the interactive wizard:

```bash
livewiki config
```

It writes provider settings to `.livewiki/config.json` and stores the API key
separately at `~/.livewiki/credentials.json`, without echoing the key during
input. On POSIX the credentials file uses mode `0600`; on Windows it inherits
the user profile's ACL. Check presence and origin without printing the value:

```bash
livewiki config show
```

Environment variables take precedence and remain available for CI and other
headless environments:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
livewiki init --batch
```

In PowerShell, set the key with
`$env:ANTHROPIC_API_KEY = "sk-ant-..."`. For `ollama` and `lmstudio` the
credential is optional: leave it empty for a local server, or supply one with a
custom base URL to reach an authenticated remote endpoint.

### 3. Maintain incrementally

After the bootstrap, connect livewiki to the coding agent you already use:

```bash
livewiki install
```

The installer can wire the MCP server, git hooks, and document-as-you-go skill.
The active agent then uses its existing session to inspect debt and update
affected pages as code changes.

```bash
livewiki index     # detect changed, moved, and deleted symbols
livewiki status    # show open documentation debt
```

### 4. Verify and browse

```bash
livewiki verify    # validate references and wiki artifacts
livewiki view      # build the self-contained offline site
```

Bootstrap and maintenance are consecutive phases: create the initial corpus
once, then keep it current incrementally.

## Related packages

- [`@livewiki/mcp`](https://www.npmjs.com/package/@livewiki/mcp) — MCP
  server for stdio-capable clients
- [`@livewiki/core`](https://www.npmjs.com/package/@livewiki/core) — the
  indexer, anchor ledger, batch pipeline, and verification library

## License

MIT
