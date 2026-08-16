# @livewiki/core

The library underneath livewiki: deterministic structural index
(tree-sitter), symbol anchors, the debt ledger, `verify`, and the batch
documentation pipeline.

**Most users want the CLI instead:**
[`@livewiki/cli`](https://www.npmjs.com/package/@livewiki/cli) — see the
[full guide on GitHub](https://github.com/eduardoabreu81/livewiki).

## API sketch

Requires **Node.js 24 or newer**. Subpath exports per module, e.g.:

```ts
import { run as runIndexer } from "@livewiki/core/indexer";
import { run as runLedger } from "@livewiki/core/anchor-ledger";
import { run as runVerify } from "@livewiki/core/verify";
import { runBatch } from "@livewiki/core/batch";
import { loadConfig } from "@livewiki/core/config";
```

**Stability notice:** 0.2.x — the programmatic surface is not yet frozen.
Modules may move between minor versions; pin exact versions and read the
changelog before upgrading. The stable contract is the CLI/MCP behavior
and the on-disk wiki format, not this API.

## License

MIT
