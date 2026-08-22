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
  baseline: Map<string, Set<string>>,
  options: ProcessOptions,
): ProcessResult {
  const { head, blocks } = parseBlocks(text)
  if (blocks.length === 0) {
    return { output: text }
  }

  // Baseline-filter each block: keep only lines not seen in the previous round
  // for that file, then replace the baseline with the current line set.
  for (const block of blocks) {
    const previous = baseline.get(block.file) ?? new Set<string>()
    block.newLines = block.lines.filter((line) => !previous.has(line))
    block.omitted = block.lines.length - block.newLines.length
    baseline.set(block.file, new Set(block.lines))
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
