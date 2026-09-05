---
title: Global Credential Store Reader and Atomic Writer
owner: generated
anchors:
- packages/core/src/credentials.ts#CREDENTIALS_DISPLAY_PATH
- packages/core/src/credentials.ts#CREDENTIALS_FILE_MODE
- packages/core/src/credentials.ts#CREDENTIALS_REL_PATH
- packages/core/src/credentials.ts#CredentialStoreError
- packages/core/src/credentials.ts#CredentialStoreError.constructor
- packages/core/src/credentials.ts#credentialStorePath
- packages/core/src/credentials.ts#parseCredentialStore
- packages/core/src/credentials.ts#readCredentialStatusSync
- packages/core/src/credentials.ts#readCredentialStoreSync
- packages/core/src/credentials.ts#readFileMode
- packages/core/src/credentials.ts#renameWithRetry
- packages/core/src/credentials.ts#resolveCredentialSync
- packages/core/src/credentials.ts#resolveLivewikiHome
- packages/core/src/credentials.ts#syncParentDirectory
- packages/core/src/credentials.ts#writeCredentialStoreAtomic
---

# Global Credential Store Reader and Atomic Writer

This page documents the module that reads and writes the global credential store for unattended LLM batches.

## When to use this page

- Understand how API keys are resolved from environment variables or the credential store.
- Learn how the credential store is read, parsed, and validated.
- Discover the atomic write mechanism that ensures data durability and integrity.
- Trace how credentials are reported for status or debugging purposes.

## How it fits

This module lives in `packages/core/src/credentials.ts` and manages a JSON credential store located outside the repository at `~/.livewiki/credentials.json`. It is deliberately separate from the repository's safe-io module because the safe-io allowlist only covers paths within a repository root, and this module must operate on home-directory paths. The module provides a read path for resolving credentials and a write path that is the single production writer for the store. Its consumers are the core batch runner and related credential-dependent features, which rely on it to securely persist and retrieve sensitive API keys.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-credentials.mmd
```

## Path and Location Resolution

<!-- lw:anchors packages/core/src/credentials.ts#CREDENTIALS_REL_PATH packages/core/src/credentials.ts#CREDENTIALS_DISPLAY_PATH packages/core/src/credentials.ts#resolveLivewikiHome packages/core/src/credentials.ts#credentialStorePath -->

This section groups the constants and functions that determine where the credential store lives on disk and how a home directory is resolved. The credential store must live outside the repository to avoid mixing user secrets with project files, so the module resolves a home directory and then appends a relative path to find the store.

`CREDENTIALS_REL_PATH` is a constant that holds the relative path from the home directory to the credential file, constructed as `.livewiki/credentials.json`. `CREDENTIALS_DISPLAY_PATH` is a user-facing constant that shows the same location in a human-readable format, `~/.livewiki/credentials.json`, which is convenient for error messages and documentation.

`resolveLivewikiHome` is a function that determines the base directory for the credential store. It takes an optional environment object, defaulting to `process.env`, and returns the absolute path of the `LIVEWIKI_HOME` environment variable if set, falling back to the operating system's home directory via `nodeOs.homedir()`. This allows users to override the default location without modifying the module.

`credentialStorePath` is a function that constructs the full path to the credential store. It takes the resolved home directory as a string and joins it with `CREDENTIALS_REL_PATH`, returning the absolute path to the JSON file.

## Reading and Parsing the Store

<!-- lw:anchors packages/core/src/credentials.ts#CredentialStoreError packages/core/src/credentials.ts#CredentialStoreError.constructor packages/core/src/credentials.ts#parseCredentialStore packages/core/src/credentials.ts#readCredentialStoreSync -->

This section covers the read and parse stages of the credential store lifecycle. Reading a store that may not exist or contain malformed data must be handled gracefully, and any structural problem must be surfaced with a clear error that identifies the offending file.

`CredentialStoreError` is a class that extends the built-in `Error` to carry additional context about the store path. Its constructor is `constructor(storePath: string, reason: string)`, which takes the store's path and a human-readable reason, then builds a message of the form `Credential store <path> <reason>`, and stores the path in the public `storePath` field. This error type is thrown throughout the module whenever a store cannot be parsed or read.

`parseCredentialStore` is a function that validates and converts raw JSON text into a typed `CredentialStore` object. Its signature is `parseCredentialStore(raw: string, storePath: string): CredentialStore`, taking the raw file content and the store path, and returning a record of credential keys to string values. The function first parses the raw text with `JSON.parse`; any parse failure throws a `CredentialStoreError` saying the file is not valid JSON. It then checks that the parsed result is a non-null, non-array object; otherwise it throws an error stating the store must contain a JSON object. For each entry, it verifies that the value is a non-empty string, throwing an error that names the invalid key if not, and finally assembles and returns a clean object with only validated entries.

`readCredentialStoreSync` is the synchronous entry point for loading the store from disk. Its signature is `readCredentialStoreSync(home: string): CredentialStore | null`, taking the home directory and returning the parsed store or `null` if the file does not exist. The function builds the store path via `credentialStorePath`, attempts a synchronous read with `readFileSync`; if the file is missing—indicated by an `ENOENT` error code—it returns `null` to signal absence, but any other read error throws a `CredentialStoreError` describing the failure. On a successful read it delegates to `parseCredentialStore` for validation.

## Credential Resolution and Status

<!-- lw:anchors packages/core/src/credentials.ts#resolveCredentialSync packages/core/src/credentials.ts#readCredentialStatusSync -->

This section concerns how the module finds a credential value for a requested variable and reports whether that value is present. The resolution follows a precedence order—environment variables win over the store—so that secrets can be overridden without editing the file, and a status helper exposes the same information for inspection.

`resolveCredentialSync` is the primary lookup function. Its signature is `resolveCredentialSync(\n  envVar: string,\n  opts: { home?: string; env?: NodeJS.ProcessEnv } = {},\n): CredentialResolution`, which takes the environment variable name and optional overrides for the home directory and environment, returning a `CredentialResolution` object with the value and its provenance. The function first resolves the home and store path, then checks the environment for a non-empty value of the given variable. If found, it returns that value with `source: "environment"`. Otherwise it reads the store via `readCredentialStoreSync` and looks up the variable as a key; a hit returns the value with `source: "credentials-store"`. When neither source provides a value, it returns `value: null` and `source: null`, allowing callers to distinguish an explicit miss.

`readCredentialStatusSync` is a convenience wrapper for reporting. Its signature is `readCredentialStatusSync(\n  envVar: string,\n  opts: { home?: string; env?: NodeJS.ProcessEnv } = {},\n): CredentialStatus`, taking the same inputs as `resolveCredentialSync` and returning a `CredentialStatus` object. The function calls `resolveCredentialSync` and then projects the resolution into a status record that includes the variable name, a boolean `set` indicating whether a value exists, the source, and the store path. This is useful for diagnostics or CLI output where a summary, rather than the raw value, is required.

## Atomic Write and File Permissions

<!-- lw:anchors packages/core/src/credentials.ts#CREDENTIALS_FILE_MODE packages/core/src/credentials.ts#readFileMode packages/core/src/credentials.ts#renameWithRetry packages/core/src/credentials.ts#writeCredentialStoreAtomic packages/core/src/credentials.ts#syncParentDirectory -->

This section details the core write path that persists credentials safely. Because the store holds cleartext API keys, the module must guarantee that writes are atomic—readers never see partial content—and that permissions are restricted to the owner. The write pipeline involves several private helpers that each handle one concern: reading existing permissions, flushing directory entries, retrying renames, and the top-level orchestration.

`CREDENTIALS_FILE_MODE` is a constant holding the permission bits `0o600`, meaning owner read/write only. This default protects cleartext keys from other users on the system and is applied to newly created stores and temp files during writes.

`readFileMode` is an asynchronous helper that inspects an existing file's permissions. Its signature is `async function readFileMode(absPath: string): Promise<number | null>`, taking an absolute path and returning the permission bits masked to `0o777`, or `null` when the file does not exist. It wraps a `stat` call; if the error code is `ENOENT` it returns `null`, but any other error propagates to the caller.

`writeCredentialStoreAtomic` is the exported asynchronous function that replaces the store with new content. Its signature is `export async function writeCredentialStoreAtomic(\n  storePath: string,\n  content: string,\n  opts: { mode?: number } = {},\n): Promise<void>`, taking the target store path, the serialized content, and an optional mode, and returning a promise that resolves once the replacement is durable. The function begins by resolving the absolute target path and ensuring the parent directory exists via a recursive `mkdir`. It then calls `readFileMode` to capture any existing permissions, choosing either the existing mode, an explicit `opts.mode`, or the default `CREDENTIALS_FILE_MODE`. Next it generates a unique temp filename in the same directory, incorporating the process ID, timestamp, and a sequence counter.

The temp file is opened with the exclusive flag `"wx"` at mode `0o600`, so from the first byte the content is not exposed to other users. The function writes the full content to it, then best-effort flushes it with `handle.sync().catch(() => undefined)` to force data to disk before the swap; this durability step may be unsupported on some filesystems and is treated as optional. After closing the handle, and only when not on Windows and the final mode differs from `0o600`, it calls `chmod` to widen permissions after the content is safely written, which avoids a window where a broader mode applies to empty or partial data. On Windows, `chmod` only toggles the read-only bit, so the real protection comes from the user-profile ACL. The temp file is then moved into place via `renameWithRetry`, and `syncParentDirectory` is invoked to make the directory entry durable.

`renameWithRetry` is a private helper that performs the final swap. Its signature is `async function renameWithRetry(tempAbs: string, targetAbs: string): Promise<void>`, taking the temp and target absolute paths and returning a promise. It loops up to a fixed number of attempts—20—calling `rename` each time. If the rename succeeds it returns; otherwise it inspects the error code, and only retries on `EACCES`, `EBUSY`, or `EPERM`, which can occur when Windows virus scanners or concurrent readers briefly hold the destination open. Between attempts it waits with an exponentially growing delay capped at 25 milliseconds. After the last attempt, any remaining error is thrown because the write cannot complete.

`syncParentDirectory` is a private helper that flushes the directory entry created by the rename. Its signature is `async function syncParentDirectory(dirAbs: string): Promise<void>`, taking the directory's absolute path and returning a promise. On Windows it returns immediately because directories cannot be opened as file handles there. On POSIX systems it opens the directory, calls `sync` on the handle, and closes it in a `finally` block; if `sync` is unsupported by the filesystem, the error is swallowed because the rename itself has already succeeded. This step ensures that after a power loss the rename is not rolled back, even though the write was reported as complete. Finally, the outer function's `finally` block removes the temp file with `force: true`, which is a no-op on the success path because the rename has already moved it away, and any removal error is ignored.

## Tests

Likely also exercised by `packages/core/src/credentials-atomic-write.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/credentials-install.test.ts` (name-prefix match, not verified).
