import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { Plugin } from "@opencode-ai/plugin"
import { processToolOutput } from "./diagnostics.js"

export interface TruncateLspPluginOptions {
  /**
   * Max number of *new* LSP diagnostics to show inline per tool output.
   * Defaults to 3. Set to 0 to spill every new diagnostic to a file.
   */
  cap?: number
  /**
   * Tool ids whose output should be inspected. Defaults to the built-in
   * edit tools that append an LSP diagnostics block after each write.
   */
  tools?: string[]
  /** Directory where spill files are written. Defaults to the OS temp dir. */
  tmpDir?: string
}

const DEFAULT_TOOLS = ["write", "edit", "patch", "apply_patch"]

export const truncateLspDiagnostics: Plugin = async (_input, rawOptions) => {
  const options = (rawOptions ?? {}) as TruncateLspPluginOptions
  const tools = new Set(options.tools ?? DEFAULT_TOOLS)
  const cap = options.cap ?? 3
  const tmpDir = options.tmpDir ?? tmpdir()

  // Session-lifetime baseline: file -> set of diagnostic lines seen in the
  // previous round. Lines that persist across rounds are filtered out so the
  // model only sees newly introduced diagnostics.
  const baseline = new Map<string, Set<string>>()

  return {
    "tool.execute.after": async (input, output) => {
      if (!tools.has(input.tool)) return
      if (!output.output.includes("LSP errors detected")) return

      const result = processToolOutput(output.output, baseline, {
        cap,
        tmpDir,
        sessionID: input.sessionID,
      })

      if (result.spill) {
        try {
          await mkdir(tmpDir, { recursive: true })
          await writeFile(result.spill.path, result.spill.content, "utf8")
        } catch (error) {
          console.error("failed to write LSP diagnostics spill file", error)
          result.output += `\n\n${result.spill.content}`
        }
      }

      output.output = result.output
    },
  }
}

export default { server: truncateLspDiagnostics }
