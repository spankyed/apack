import type { MessageEntity } from '#generated/types.ts'

/** Hide the transport suffix only when the native user row has matching app-owned thumbnails. */
export function claudeUserMessageText(message: Pick<MessageEntity, 'sender' | 'text' | 'context' | 'references'>): string {
  const text = message.text ?? ''
  const images = message.references?.images
  if (message.sender !== 'user' || !images?.length) return text

  const native = message.context?.claudeTerminalMessage as { media?: readonly { type?: string }[] } | undefined
  if (!Array.isArray(native?.media) || native.media.filter(block => block?.type === 'image').length !== images.length) return text

  const labels = images.map(image => {
    const match = /^media:\/\/[^/]+\/(.+)$/.exec(image.url)
    return match ? `[Image: ${image.name || match[1]}]` : undefined
  })
  if (labels.some(label => label === undefined)) return text

  const suffix = labels.join('\n\n')
  const start = text.lastIndexOf(suffix)
  if (start < 0 || (start > 0 && text.slice(start - 2, start) !== '\n\n')) return text
  const placeholders = text.slice(start + suffix.length)
  const markers = placeholders.match(/[ \t]*\[Image #[1-9]\d*\]/g)
  if (markers?.length !== images.length || markers.join('') !== placeholders) return text

  return text.slice(0, Math.max(0, start - 2))
}
