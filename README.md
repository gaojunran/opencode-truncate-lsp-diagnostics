# opencode-truncate-lsp-diagnostics

An [OpenCode](https://opencode.ai) plugin that keeps the LSP diagnostics block appended after `write`, `edit`, and `apply_patch` from flooding the agent transcript. It does two things:

1. **Session-lifetime baseline** — diagnostics that were already reported in a previous round are filtered out, so the model only sees *newly introduced* errors.
2. **Cap + spill** — if the remaining new diagnostics still exceed a configurable count, only the first few are shown inline and the full list is written to a temp file that the model is told to read.

## Problem

After each file edit, OpenCode appends the current LSP diagnostics to the tool output:

```
Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/path/to/file.ts">
ERROR [171:32] 'Promise' only refers to a type...
ERROR [197:20] 'Promise' only refers to a type...
... 12 more lines ...
</diagnostics>
```

In a codebase with many outstanding errors this block can be huge, and most of it is *residual* errors the model already knows about and did not introduce. This plugin removes the noise so the transcript shows only what changed.

## Install

Add the plugin to your `opencode.json` (or `opencode.jsonc`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-truncate-lsp-diagnostics"]
}
```

Then restart OpenCode.

## Configuration

Pass options as a tuple:

```json
{
  "plugin": [
    [
      "opencode-truncate-lsp-diagnostics",
      { "cap": 3 }
    ]
  ]
}
```

| Option   | Type       | Default                          | Description                                                                 |
| -------- | ---------- | -------------------------------- | --------------------------------------------------------------------------- |
| `cap`    | `number`   | `3`                              | Max *new* diagnostics to show inline. `0` spills every new diagnostic to a file. |
| `tools`  | `string[]` | `["write", "edit", "apply_patch"]`          | Tool ids whose output is inspected.                          |
| `tmpDir` | `string`   | OS temp dir                      | Directory where spill files are written.                                     |

## Example

First edit to a file with 5 pre-existing errors, with `cap: 2`:

```
Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/path/to/file.ts">
ERROR [171:32] 'Promise' only refers to a type...
ERROR [197:20] 'Promise' only refers to a type...
</diagnostics>
(3 additional new LSP diagnostics written to /tmp/opencode-lsp-diagnostics-<session>-<ts>.txt; read it for the full list)
```

Second edit, where the model fixed two errors but introduced one new one:

```
Edit applied successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/path/to/file.ts">
ERROR [600:10] Cannot find name 'newSymbol'.
</diagnostics>
(3 previously-seen LSP diagnostics omitted)
```

## How it works

The plugin registers an OpenCode `tool.execute.after` hook and rewrites `output.output` in place, keeping the edit-result head and replacing the diagnostics tail. A module-level baseline maps each file to the number of occurrences of each diagnostic identity seen in the previous round. Identity is content-based rather than position-based: the `[line:col]` location is ignored, so a diagnostic that only shifted lines (an edit inserted or removed lines above it) is still recognized as seen and filtered out. Identical messages are counted, so a new occurrence of an already-seen message is still reported, while a fixed error that reappears is reported again.

> Note: OpenCode's `tool.execute.after` hook signature returns `Promise<void>`, so the plugin mutates `output.output` rather than returning a replacement string. This relies on OpenCode passing the same output object through to the model, which is the current behavior (verified against OpenCode 1.18.21) but is not part of the documented contract.

The tool list defaults to `write`, `edit`, and `apply_patch` because GPT-family models hide `write`/`edit` in favor of `apply_patch`, and all three append the same diagnostics block.

## Development

```sh
bun install
bun run build    # compile to dist/
bun test         # run unit tests
```

## License

MIT
