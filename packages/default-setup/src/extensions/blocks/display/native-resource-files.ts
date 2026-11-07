import type { ToolActivityEntry } from '#features/threads/be/types.ts'

export interface NativeResourceFile {
  path: string
  uri: string
  label: string
}

/** Only original completed resource results identify files in their own native session. */
export function nativeResourceFiles(entry: ToolActivityEntry): NativeResourceFile[] {
  const session = entry.nativeResult?.sessionId
  const text = entry.details?.output
  if (entry.tool !== 'ReadMcpResourceTool' || entry.status !== 'ok' || !session || !/^[a-f0-9-]{36}$/i.test(session) || typeof text !== 'string' || text.length > 65536) return []
  let result: unknown
  try { result = JSON.parse(text) } catch { return [] }
  if (!result || typeof result !== 'object' || !('contents' in result) || !Array.isArray(result.contents)) return []
  const files = new Map<string, NativeResourceFile>()
  for (const value of result.contents) {
    if (!value || typeof value !== 'object') continue
    const { blobSavedTo: path, uri } = value as Record<string, unknown>
    if (typeof path !== 'string' || typeof uri !== 'string' || !uri || uri.length > 4096 || path.length > 4096 || !path.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(path)) continue
    const segments = path.split('/')
    if (segments.some(part => part === '.' || part === '..')) continue
    const filename = segments.at(-1)!
    if (!/^[A-Za-z0-9._-]+$/.test(filename) || !filename.startsWith('mcp-resource-') || segments.at(-2) !== 'tool-results' || segments.at(-3) !== session || !segments.includes('projects')) continue
    const label = uri.split('/').filter(Boolean).at(-1) ?? 'resource'
    files.set(path, { path, uri, label })
  }
  return [...files.values()]
}
