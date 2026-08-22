import * as path from "node:path"

export interface ProcessOptions {
  /** Max number of new diagnostics to show inline. 0 spills everything to a file. */
  cap: number
  /** Directory where spill files are written. */
  tmpDir: string
  /** Session id, used to namespace spill file names. */
  sessionID: string
}

export interface Spill {
  path: string
  content: string
}

export interface ProcessResult {
  output: string
  spill?: Spill
}

const DIAGNOSTIC_MARKER = "LSP errors detected"

// Matches one `ERROR [line:col] message` entry. opencode only reports ERROR
// severity diagnostics in these blocks, so the alternatives are defensive.
const DIAGNOSTIC_LINE_RE = /^(?:ERROR|WARN|INFO|HINT)\s+\[\d+:\d+\][^\n]*/gm

// Identity of a diagnostic is its content, not its position: `[line:col]`
// shifts whenever an edit above inserts or removes lines, so it must not be
// part of the baseline key. Stripping the location leaves `SEVERITY message`,
// which survives those shifts. Identical messages collapse to a count so a new
// occurrence of an already-seen message is still reported.
function diagnosticKey(line: string): string {
  return line.replace(/\[\d+:\d+\]\s*/, "")
}

// Matches an opencode diagnostics block:
//   LSP errors detected in this file, please fix:\n<diagnostics file="...">\n...\n</diagnostics>
// The label before the colon is captured verbatim so it can be reproduced as-is.
const BLOCK_RE =
  /LSP errors detected ([^:\n]+):\s*\n\s*<diagnostics file="([^"]+)">\s*\n([\s\S]*?)\n?\s*<\/diagnostics>/g

interface Block {
  file: string
  label: string
  isCurrent: boolean
  lines: string[]
  newLines: string[]
  omitted: number
}

function parseBlocks(text: string): { head: string; blocks: Block[] } {
  const markerIndex = text.indexOf(DIAGNOSTIC_MARKER)
  const head = markerIndex === -1 ? text : text.slice(0, markerIndex).trimEnd()

  const blocks: Block[] = []
  for (const match of text.matchAll(BLOCK_RE)) {
    const label = match[1]
    const file = match[2]
    const content = match[3]
    const lines = content.match(DIAGNOSTIC_LINE_RE) ?? []
    if (lines.length === 0) continue
    blocks.push({
      file,
      label,
      isCurrent: label.startsWith("in this file"),
      lines,
      newLines: [],
      omitted: 0,
    })
  }
  return { head, blocks }
}

export function processToolOutput(
  text: string,
  baseline: Map<string, Map<string, number>>,
  options: ProcessOptions,
): ProcessResult {
  const { head, blocks } = parseBlocks(text)
  if (blocks.length === 0) {
    return { output: text }
  }

  // Baseline-filter each block by counting messages: a message that appears
  // more times this round than last round has that many new occurrences. The
  // baseline is replaced with the current counts each round. Which specific
  // occurrence is new is unknowable from content alone, so the first `newCount`
  // occurrences of each message are kept (a deterministic pick; the message is
  // what the model acts on).
  for (const block of blocks) {
    const previousCounts = baseline.get(block.file) ?? new Map<string, number>()
    const currentCounts = new Map<string, number>()
    for (const line of block.lines) {
      const key = diagnosticKey(line)
      currentCounts.set(key, (currentCounts.get(key) ?? 0) + 1)
    }
    const newCounts = new Map<string, number>()
    for (const [key, count] of currentCounts) {
      newCounts.set(key, Math.max(0, count - (previousCounts.get(key) ?? 0)))
    }
    const kept = new Map<string, number>()
    block.newLines = []
    for (const line of block.lines) {
      const key = diagnosticKey(line)
      const limit = newCounts.get(key) ?? 0
      const keptCount = kept.get(key) ?? 0
      if (keptCount < limit) {
        block.newLines.push(line)
        kept.set(key, keptCount + 1)
      }
    }
    block.omitted = block.lines.length - block.newLines.length
    baseline.set(block.file, currentCounts)
  }

  // Current file first, everything else keeps its original relative order.
  const ordered = [
    ...blocks.filter((b) => b.isCurrent),
    ...blocks.filter((b) => !b.isCurrent),
  ]

  const totalNew = ordered.reduce((sum, b) => sum + b.newLines.length, 0)
  const totalOmitted = ordered.reduce((sum, b) => sum + b.omitted, 0)

  if (totalNew === 0) {
    const output =
      totalOmitted > 0
        ? `${head}\n\n(${totalOmitted} previously-seen LSP ${pluralize("diagnostic", totalOmitted)} omitted)`
        : head
    return { output }
  }

  const shownCount = Math.min(options.cap, totalNew)
  const spilled: { file: string; line: string }[] = []
  let shownSoFar = 0
  let output = head

  for (const block of ordered) {
    const remaining = Math.max(0, shownCount - shownSoFar)
    const inline = block.newLines.slice(0, remaining)
    shownSoFar += inline.length

    if (inline.length === 0) {
      spilled.push(...block.newLines.map((line) => ({ file: block.file, line })))
      continue
    }

    output += `\n\nLSP errors detected ${block.label}:\n<diagnostics file="${block.file}">\n${inline.join("\n")}\n</diagnostics>`
    spilled.push(
      ...block.newLines.slice(inline.length).map((line) => ({ file: block.file, line })),
    )
  }

  if (totalOmitted > 0) {
    output += `\n(${totalOmitted} previously-seen LSP ${pluralize("diagnostic", totalOmitted)} omitted)`
  }

  if (spilled.length > 0) {
    const spillPath = path.join(
      options.tmpDir,
      `opencode-lsp-diagnostics-${sanitize(options.sessionID)}-${Date.now()}.txt`,
    )
    output += `\n(${spilled.length} additional new LSP ${pluralize("diagnostic", spilled.length)} written to ${spillPath}; read it for the full list)`
    return { output, spill: { path: spillPath, content: formatSpill(spilled) } }
  }

  return { output }
}

export function formatSpill(spilled: { file: string; line: string }[]): string {
  const byFile = new Map<string, string[]>()
  for (const item of spilled) {
    const list = byFile.get(item.file) ?? []
    list.push(item.line)
    byFile.set(item.file, list)
  }
  return [...byFile.entries()]
    .map(([file, lines]) => `<diagnostics file="${file}">\n${lines.join("\n")}\n</diagnostics>`)
    .join("\n\n")
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-")
}
