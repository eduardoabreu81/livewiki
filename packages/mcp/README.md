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
| `livewiki_next_task` | Start or resume a prioritized full-wiki bootstrap task |
| `livewiki_write_doc` | Write a page — post-write `verify` with rollback |
| `livewiki_resolve_debt` | Close debts by ID |
| `livewiki_impact` | Per-symbol blast radius (importers, callers, pages) |

To bootstrap without configuring an API credential, call
`livewiki_next_task`, read the returned source paths with the client's own
file tools, and submit the requested Markdown through `livewiki_write_doc`
with its `taskId`. Repeat until the queue reports `completed`. The response
never embeds source code, but it does include the complete closed list of
allowed symbol keys and the canonical format contract.

Writes are guarded: paths outside `livewiki/` are refused, and content that
fails the task contract or `verify` is rolled back. Attempts are bounded by
the server. Human-owned pages (`owner: human`) are never overwritten, and
`lw:manual` blocks are preserved byte-for-byte.

## License

MIT
