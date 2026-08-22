import { describe, expect, test } from "bun:test"
import { processToolOutput } from "../src/diagnostics.js"

const writeOutput = `Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/abs/player-manager.ts">
ERROR [171:32] 'Promise' only refers to a type, but is being used as a value here.
ERROR [197:20] 'Promise' only refers to a type, but is being used as a value here.
ERROR [287:110] 'Promise' only refers to a type, but is being used as a value here.
ERROR [288:23] Parameter 'isLoggedIn' implicitly has an 'any' type.
ERROR [502:27] An async function or method in ES5/ES3 requires the 'Promise' constructor.
</diagnostics>`

function makeOptions(overrides: Partial<{ cap: number; tmpDir: string; sessionID: string }> = {}) {
  return { cap: 3, tmpDir: "/tmp", sessionID: "sess-1", ...overrides }
}

function makeBaseline() {
  return new Map<string, Set<string>>()
}

describe("processToolOutput", () => {
  test("shows all diagnostics on the first round (baseline empty)", () => {
    const result = processToolOutput(writeOutput, makeBaseline(), makeOptions({ cap: 99 }))
    expect(result.output.startsWith("Wrote file successfully.")).toBe(true)
    expect(result.output).toContain("ERROR [171:32]")
    expect(result.output).toContain("ERROR [502:27]")
    expect(result.spill).toBeUndefined()
  })

  test("filters out previously-seen diagnostics on subsequent rounds", () => {
    const baseline = makeBaseline()
    // First round: seed the baseline with all 5.
    processToolOutput(writeOutput, baseline, makeOptions({ cap: 99 }))

    // Second round: one error fixed, one new error introduced.
    const next = `Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/abs/player-manager.ts">
ERROR [171:32] 'Promise' only refers to a type, but is being used as a value here.
ERROR [197:20] 'Promise' only refers to a type, but is being used as a value here.
ERROR [287:110] 'Promise' only refers to a type, but is being used as a value here.
ERROR [288:23] Parameter 'isLoggedIn' implicitly has an 'any' type.
ERROR [600:10] Cannot find name 'newSymbol'.
</diagnostics>`

    const result = processToolOutput(next, baseline, makeOptions({ cap: 99 }))
    expect(result.output).toContain("ERROR [600:10]")
    expect(result.output).not.toContain("ERROR [288:23]")
    expect(result.output).toContain("4 previously-seen LSP diagnostics omitted")
    expect(result.spill).toBeUndefined()
  })

  test("caps new diagnostics and spills the rest to a file", () => {
    const result = processToolOutput(writeOutput, makeBaseline(), makeOptions({ cap: 2 }))
    expect(result.output).toContain("ERROR [171:32]")
    expect(result.output).toContain("ERROR [197:20]")
    expect(result.output).not.toContain("ERROR [287:110]")
    expect(result.spill).toBeDefined()
    expect(result.spill!.content).toContain("ERROR [287:110]")
    expect(result.spill!.content).toContain("ERROR [502:27]")
    expect(result.output).toContain("3 additional new LSP diagnostics written to")
    expect(result.output).toContain("read it for the full list")
  })

  test("shows only an omission hint when nothing is new", () => {
    const baseline = makeBaseline()
    processToolOutput(writeOutput, baseline, makeOptions({ cap: 99 }))

    const result = processToolOutput(writeOutput, baseline, makeOptions({ cap: 99 }))
    expect(result.output).toBe(
      "Wrote file successfully.\n\n(5 previously-seen LSP diagnostics omitted)",
    )
    expect(result.spill).toBeUndefined()
  })

  test("leaves output unchanged when there is no diagnostics block", () => {
    const plain = "Wrote file successfully."
    expect(processToolOutput(plain, makeBaseline(), makeOptions())).toEqual({ output: plain })
  })

  test("prioritizes the current file before other files", () => {
    const multi = `Wrote file successfully.

LSP errors detected in other files:
<diagnostics file="/abs/other.ts">
ERROR [1:1] error in other file A
ERROR [2:1] error in other file B
</diagnostics>
LSP errors detected in this file, please fix:
<diagnostics file="/abs/main.ts">
ERROR [10:1] error in main file
</diagnostics>`

    const result = processToolOutput(multi, makeBaseline(), makeOptions({ cap: 2 }))
    // The current file's error should be shown before any "other files" error.
    expect(result.output.indexOf("error in main file")).toBeLessThan(
      result.output.indexOf("error in other file A"),
    )
    expect(result.spill).toBeDefined()
  })
})
