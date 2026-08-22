import type { Plugin } from "@opencode-ai/plugin"
import { truncateLspDiagnosticsText, type TruncateOptions } from "./truncate.js"

export type { TruncateOptions }

export interface TruncateLspPluginOptions extends TruncateOptions {
  /**
   * Tool ids whose output should be inspected. Defaults to the built-in
   * edit tools that append an LSP diagnostics block after each write.
   */
  tools?: string[]
}

const DEFAULT_TOOLS = ["write", "edit", "patch", "apply_patch"]

export const truncateLspDiagnostics: Plugin = async (_input, rawOptions) => {
  const options = (rawOptions ?? {}) as TruncateLspPluginOptions
  const tools = new Set(options.tools ?? DEFAULT_TOOLS)
  const keep = options.keep ?? 3

  return {
    "tool.execute.after": async (input, output) => {
      if (!tools.has(input.tool)) {
        return
      }
      output.output = truncateLspDiagnosticsText(output.output, { keep })
    },
  }
}

export default { server: truncateLspDiagnostics }
