import type { ToolActivityEntry } from '#features/threads/be/types.ts'

/**
 * Print-mode tools lack native drawings; describe their actual operation and location.
 *
 * **The details are a parameter because a block's props do not hold them**, so reading them off the entry
 * fell back to the plain summary for every row. They are fetched for a block the user has open, which is
 * also when the header showing this is worth enriching; closed, the fallback is the summary as before.
 */
export function toolInputSummary(entry: Omit<ToolActivityEntry, 'details'>, details: ToolActivityEntry['details']): string {
  if (entry.tool !== 'LSP') return entry.summary
  const input = details?.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return entry.summary
  const { operation, filePath, line, character } = input as Record<string, unknown>
  if (typeof operation !== 'string' || !operation || typeof filePath !== 'string' || !filePath) return entry.summary
  const label = operation === 'goToDefinition' ? 'Go to definition' : operation === 'hover' ? 'Hover' : operation
  const position = Number.isSafeInteger(line) && (line as number) > 0
    ? ':' + line + (Number.isSafeInteger(character) && (character as number) > 0 ? ':' + character : '') : ''
  const fileName = filePath.split(/[\\/]/).at(-1) || filePath
  return `${label} · ${fileName}${position}`
}
