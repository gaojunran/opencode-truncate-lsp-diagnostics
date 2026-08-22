import { describe, expect, test } from "bun:test"
import { truncateLspDiagnosticsText } from "../src/truncate.js"

const wrapped = `Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/Volumes/2tb-ssd/nebula/Work/miniprogram-skit/miniprogram/utils/player-manager.ts">
ERROR [171:32] 'Promise' only refers to a type, but is being used as a value here.
ERROR [197:20] 'Promise' only refers to a type, but is being used as a value here.
ERROR [287:110] 'Promise' only refers to a type, but is being used as a value here.
ERROR [287:119] Parameter 'resolve' implicitly has an 'any' type.
ERROR [287:128] Parameter 'reject' implicitly has an 'any' type.
ERROR [288:23] Parameter 'isLoggedIn' implicitly has an 'any' type.
ERROR [478:94] Property 'MAX_SAFE_INTEGER' does not exist on type 'NumberConstructor'.
ERROR [478:185] Property 'MAX_SAFE_INTEGER' does not exist on type 'NumberConstructor'.
ERROR [502:27] An async function or method in ES5/ES3 requires the 'Promise' constructor.
ERROR [557:42] Property 'findIndex' does not exist on type '...'.
ERROR [557:52] Parameter 'item' implicitly has an 'any' type.
ERROR [896:30] Cannot find name 'debugToWecube'.
ERROR [896:31] Cannot find name 'debugToWecube'.
ERROR [896:32] Cannot find name 'debugToWecube'.
</diagnostics>`

const raw = `Wrote file successfully.

LSP errors detected in this file, please fix:
 
ERROR [171:32] 'Promise' only refers to a type, but is being used as a value here.
ERROR [197:20] 'Promise' only refers to a type, but is being used as a value here.
 
`

describe("truncateLspDiagnosticsText", () => {
  test("truncates a wrapped diagnostics block to keep lines + summary", () => {
    const result = truncateLspDiagnosticsText(wrapped, { keep: 3 })
    expect(result.startsWith("Wrote file successfully.")).toBe(true)
    expect(result).toContain("ERROR [171:32]")
    expect(result).toContain("ERROR [197:20]")
    expect(result).toContain("ERROR [287:110]")
    expect(result).not.toContain("ERROR [288:23]")
    expect(result).not.toContain("<diagnostics")
    expect(result).toContain("... and 11 more LSP diagnostics (14 total)")
  })

  test("truncates a raw (unwrapped) diagnostics block", () => {
    const result = truncateLspDiagnosticsText(raw, { keep: 1 })
    expect(result.startsWith("Wrote file successfully.")).toBe(true)
    expect(result).toContain("ERROR [171:32]")
    expect(result).not.toContain("ERROR [197:20]")
    expect(result).toContain("... and 1 more LSP diagnostic (2 total)")
  })

  test("leaves output unchanged when within the keep limit", () => {
    const result = truncateLspDiagnosticsText(raw, { keep: 5 })
    expect(result).toBe(raw)
  })

  test("strips diagnostics entirely when keep is 0", () => {
    const result = truncateLspDiagnosticsText(wrapped, { keep: 0 })
    expect(result).toBe("Wrote file successfully.\n\n(LSP diagnostics hidden: 14 diagnostics)")
  })

  test("leaves output unchanged when there is no diagnostics block", () => {
    const plain = "Wrote file successfully."
    expect(truncateLspDiagnosticsText(plain)).toBe(plain)
  })
})
