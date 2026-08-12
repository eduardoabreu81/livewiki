# @livewiki/mcp

MCP server exposing a livewiki repository wiki to any MCP client
(Claude Code, Cursor, Codex, Kimi, and more) over stdio.

**Full guide, philosophy, and benchmarks:**
[github.com/eduardoabreu81/livewiki](https://github.com/eduardoabreu81/livewiki)

## Configuration

Requires **Node.js 24 or newer**. Example (Claude Code):

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

If you already use the livewiki CLI, `livewiki install` writes this
configuration for you (and `livewiki serve` starts this same server).

## Tools

| Tool | Purpose |
| --- | --- |
| `livewiki_quickstart` | The wiki's entry-point page |
| `livewiki_read` | Read a wiki page (allowlisted to `livewiki/`) |
| `livewiki_search` | Full-text search (FTS5, identifier-aware) |
| `livewiki_debt` | Open documentation debt (= `livewiki status --json`) |
| `livewiki_write_doc` | Write a page — post-write `verify` with rollback |
| `livewiki_resolve_debt` | Close debts by ID |
| `livewiki_impact` | Per-symbol blast radius (importers, callers, pages) |

Writes are guarded: paths outside `livewiki/` are refused, and content
that fails `verify` is rolled back. Human-owned pages (`owner: human`)
are never overwritten.

## License

MIT
