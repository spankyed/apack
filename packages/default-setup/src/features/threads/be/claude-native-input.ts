import type { MessageReferences } from './types.ts'
import type { ClaudeNativeImage } from '#features/code/be/services/claude-code/terminal-session.ts'

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Keep app reference resolution shared with print turns; native owns image decoding and file policy. */
export async function prepareClaudeNativeInput(text: string, references: MessageReferences | undefined,
  resolve: (references: MessageReferences | undefined) => Promise<{ textPrefix: string; imageBlocks: unknown[]; addDirs: string[] }>,
): Promise<{ text: string; images: ClaudeNativeImage[] }> {
  const resolved = await resolve(references), images: ClaudeNativeImage[] = [], labels: string[] = []
  for (const value of resolved.imageBlocks) {
    const block = object(value)
    if (block?.type === 'text' && typeof block.text === 'string') labels.push(block.text)
    if (block?.type !== 'image') continue
    const source = object(block.source)
    if (source?.type !== 'base64' || typeof source.data !== 'string' || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(String(source.media_type))) throw new Error('An attached image could not be prepared for Claude')
    images.push({ mediaType: source.media_type as ClaudeNativeImage['mediaType'], data: source.data })
  }
  if (images.length !== (references?.images?.length ?? 0)) throw new Error('An attached image is unavailable; your draft was retained')
  return { text: [resolved.textPrefix, text, ...labels].filter(Boolean).join('\n\n'), images }
}
