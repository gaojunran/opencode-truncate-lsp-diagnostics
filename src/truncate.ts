export interface TruncateOptions {
  /**
   * Maximum number of diagnostic lines to keep per tool output.
   * Defaults to 3. Set to 0 to strip diagnostics entirely.
   */
  keep?: number
}

const DIAGNOSTIC_MARKER = "LSP errors detected"

// A diagnostic entry is a line like `ERROR [171:32] 'Promise' only refers to ...`.
// Matching the full line (location + message) preserves enough signal for the model
// while still dropping everything past the truncation point.
const DIAGNOSTIC_LINE_RE = /^(?:ERROR|WARN|INFO|HINT)\s+\[\d+:\d+\][^\n]*/gm

export function truncateLspDiagnosticsText(text: string, options: TruncateOptions = {}): string {
  const keep = options.keep ?? 3

  if (!text.includes(DIAGNOSTIC_MARKER)) {
    return text
  }

  const markerIndex = text.indexOf(DIAGNOSTIC_MARKER)
  const head = text.slice(0, markerIndex).trimEnd()

  const diagnosticLines = text.match(DIAGNOSTIC_LINE_RE) ?? []
  const total = diagnosticLines.length

  if (total === 0) {
    return text
  }

  if (keep <= 0) {
    return `${head}\n\n(LSP diagnostics hidden: ${total} ${pluralize("diagnostic", total)})`
  }

  if (total <= keep) {
    return text
  }

  const shown = diagnosticLines.slice(0, keep)
  const omitted = total - keep
  const summary = `... and ${omitted} more LSP ${pluralize("diagnostic", omitted)} (${total} total)`

  return `${head}\n\n${shown.join("\n")}\n${summary}`
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`
}
