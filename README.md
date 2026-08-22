# opencode-truncate-lsp-diagnostics

An [OpenCode](https://opencode.ai) plugin that shortens the LSP diagnostics block that the built-in `write`, `edit`, `patch`, and `apply_patch` tools append after every edit.

## Problem

After each file edit, OpenCode appends the current LSP diagnostics to the tool output, for example:

```
Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/path/to/file.ts">
ERROR [171:32] 'Promise' only refers to a type...
ERROR [197:20] 'Promise' only refers to a type...
... 12 more lines ...
</diagnostics>
```

In a codebase with many outstanding errors this block can be huge, drowning the actual edit result in the agent transcript and hurting the UX. This plugin truncates that block to a bounded number of lines plus a compact summary.

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
      { "keep": 5 }
    ]
  ]
}
```

| Option  | Type       | Default                          | Description                                                            |
| ------- | ---------- | -------------------------------- | ---------------------------------------------------------------------- |
| `keep`  | `number`   | `3`                              | Max diagnostic lines to keep per output. `0` strips them entirely.      |
| `tools` | `string[]` | `["write", "edit", "patch", "apply_patch"]` | Tool ids whose output is inspected.                     |

With the default `keep: 3`, the example above becomes:

```
Wrote file successfully.

ERROR [171:32] 'Promise' only refers to a type...
ERROR [197:20] 'Promise' only refers to a type...
ERROR [287:110] 'Promise' only refers to a type...
... and 11 more LSP diagnostics (14 total)
```

## How it works

The plugin registers an OpenCode `tool.execute.after` hook. This hook fires for every tool, built-in or custom. For the targeted edit tools it rewrites `output.output` in place, keeping the "Wrote file successfully." / edit-result head and truncating the LSP diagnostics tail.

> Note: OpenCode's `tool.execute.after` hook signature returns `Promise<void>`, so the plugin mutates `output.output` rather than returning a replacement string. This relies on OpenCode passing the same output object through to the model, which is the current behavior (verified against OpenCode 1.18.21) but is not part of the documented contract.

The tool list defaults to `write`, `edit`, `patch`, and `apply_patch` because GPT-family models hide `write`/`edit` in favor of `apply_patch`, and all four append the same diagnostics block.

## Development

```sh
bun install
bun run build    # compile to dist/
bun test         # run unit tests
```

## License

MIT
