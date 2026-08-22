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

  test("does not re-report diagnostics that only shifted line numbers", () => {
    const baseline = makeBaseline()
    processToolOutput(writeOutput, baseline, makeOptions({ cap: 99 }))

    // Same diagnostics, every line number shifted +10 (an edit inserted 10 lines above).
    const shifted = `Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/abs/player-manager.ts">
ERROR [181:32] 'Promise' only refers to a type, but is being used as a value here.
ERROR [207:20] 'Promise' only refers to a type, but is being used as a value here.
ERROR [297:110] 'Promise' only refers to a type, but is being used as a value here.
ERROR [298:23] Parameter 'isLoggedIn' implicitly has an 'any' type.
ERROR [512:27] An async function or method in ES5/ES3 requires the 'Promise' constructor.
</diagnostics>`

    const result = processToolOutput(shifted, baseline, makeOptions({ cap: 99 }))
    expect(result.output).toBe(
      "Wrote file successfully.\n\n(5 previously-seen LSP diagnostics omitted)",
    )
  })

  test("reports a new diagnostic whose message matches a shifted residual", () => {
    const baseline = makeBaseline()
    processToolOutput(writeOutput, baseline, makeOptions({ cap: 99 }))

    // One residual error fixed, its message reused at a new location, plus the rest shifted.
    const next = `Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/abs/player-manager.ts">
ERROR [181:32] 'Promise' only refers to a type, but is being used as a value here.
ERROR [207:20] 'Promise' only refers to a type, but is being used as a value here.
ERROR [297:110] 'Promise' only refers to a type, but is being used as a value here.
ERROR [298:23] Parameter 'isLoggedIn' implicitly has an 'any' type.
ERROR [999:10] Brand new error never seen before.
</diagnostics>`

    const result = processToolOutput(next, baseline, makeOptions({ cap: 99 }))
    expect(result.output).toContain("ERROR [999:10]")
    expect(result.output).not.toContain("ERROR [181:32]")
    expect(result.output).toContain("4 previously-seen LSP diagnostics omitted")
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

  test("reports a new occurrence when a repeated message's count increases", () => {
    const baseline = makeBaseline()
    const three = `Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/abs/player-manager.ts">
ERROR [896:30] Cannot find name 'debugToWecube'.
ERROR [896:31] Cannot find name 'debugToWecube'.
ERROR [896:32] Cannot find name 'debugToWecube'.
</diagnostics>`
    processToolOutput(three, baseline, makeOptions({ cap: 99 }))

    const four = `Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/abs/player-manager.ts">
ERROR [900:30] Cannot find name 'debugToWecube'.
ERROR [900:31] Cannot find name 'debugToWecube'.
ERROR [900:32] Cannot find name 'debugToWecube'.
ERROR [900:40] Cannot find name 'debugToWecube'.
</diagnostics>`

    const result = processToolOutput(four, baseline, makeOptions({ cap: 99 }))
    expect(result.output).toContain("ERROR [900:30]")
    expect(result.output).not.toContain("ERROR [900:32]")
    expect(result.output).toContain("3 previously-seen LSP diagnostics omitted")
  })

  test("does not report when a repeated message's count decreases", () => {
    const baseline = makeBaseline()
    const three = `Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/abs/player-manager.ts">
ERROR [896:30] Cannot find name 'debugToWecube'.
ERROR [896:31] Cannot find name 'debugToWecube'.
ERROR [896:32] Cannot find name 'debugToWecube'.
</diagnostics>`
    processToolOutput(three, baseline, makeOptions({ cap: 99 }))

    const two = `Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/abs/player-manager.ts">
ERROR [900:30] Cannot find name 'debugToWecube'.
ERROR [900:32] Cannot find name 'debugToWecube'.
</diagnostics>`

    const result = processToolOutput(two, baseline, makeOptions({ cap: 99 }))
    expect(result.output).toBe(
      "Wrote file successfully.\n\n(2 previously-seen LSP diagnostics omitted)",
    )
  })
})
