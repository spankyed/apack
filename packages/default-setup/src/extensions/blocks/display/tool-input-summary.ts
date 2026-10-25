import type { ToolActivityEntry } from '#features/threads/be/types.ts'

/** Print-mode tools lack native drawings; describe their actual operation and location. */
export function toolInputSummary(entry: ToolActivityEntry): string {
  if (entry.tool !== 'LSP') return entry.summary
  const input = entry.details?.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return entry.summary
  const { operation, filePath, line, character } = input as Record<string, unknown>
  if (typeof operation !== 'string' || !operation || typeof filePath !== 'string' || !filePath) return entry.summary
  const label = operation === 'goToDefinition' ? 'Go to definition' : operation === 'hover' ? 'Hover' : operation
  const position = Number.isSafeInteger(line) && (line as number) > 0
    ? ':' + line + (Number.isSafeInteger(character) && (character as number) > 0 ? ':' + character : '') : ''
  return `${label} · ${filePath}${position}`
}
