import type { ClaudeTerminalImageFileFormat } from './terminal-image-file.ts'

export interface ClaudeTerminalImagePixels {
  id: number
  image: ClaudeTerminalImageFileFormat
  pixels: Buffer
}

/** Pixels belong to one live terminal, never to a path or a persisted drawing. */
export function createClaudeTerminalImageCache() {
  const images = new Map<number, ClaudeTerminalImagePixels>()
  let bytes = 0, closed = false
  function remove(id: number) {
    const previous = images.get(id)
    if (previous) { bytes -= previous.pixels.length; images.delete(id) }
  }
  return {
    put(value: ClaudeTerminalImagePixels) {
      if (closed) return
      remove(value.id)
      if (!Number.isInteger(value.id) || value.id < 1 || value.id > 0xffffffff || value.pixels.length > 32 * 1024 * 1024) return
      while (images.size && bytes + value.pixels.length > 32 * 1024 * 1024) remove(images.keys().next().value!)
      images.set(value.id, value); bytes += value.pixels.length
    },
    remove,
    project(tree: unknown): unknown {
      let nodes = 0
      const visit = (value: unknown): unknown => {
        if (++nodes > 8192) throw new Error('Terminal image projection exceeds its bound')
        if (Array.isArray(value)) return value.map(visit)
        if (!value || typeof value !== 'object') return value
        const node = value as Record<string, unknown>
        if (node.type === 'NativeImageReference') {
          const props = node.props as Record<string, unknown> | undefined
          const image = !closed && props && typeof props.imageId === 'number' ? images.get(props.imageId) : undefined
          const fallback = (text: string) => ({ type: 'Text', props: { dimColor: true }, children: [text], ...(node.part ? { part: node.part } : {}) })
          if (!image) return fallback('Image pixels are unavailable in this terminal view.')
          const format = image.image.format
          let pixels = image.pixels
          if (format === 'rgb') {
            if (pixels.length * 4 / 3 > 49152) return fallback('Image preview exceeds this view. Open the native interface to inspect it.')
            const rgba = Buffer.alloc(pixels.length / 3 * 4)
            for (let from = 0, to = 0; from < pixels.length; from += 3, to += 4) { pixels.copy(rgba, to, from, from + 3); rgba[to + 3] = 255 }
            pixels = rgba
          }
          const data = pixels.toString('base64')
          if (data.length > 65536) return fallback('Image preview exceeds this view. Open the native interface to inspect it.')
          return { ...node, type: 'NativeImage', props: { columns: props!.columns, rows: props!.rows, alt: props!.alt, format: format === 'png' ? 'png' : 'rgba', data, ...(image.image.format === 'png' ? {} : { width: image.image.width, height: image.image.height }) } }
        }
        return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, visit(item)]))
      }
      return visit(tree)
    },
    close() { closed = true; images.clear(); bytes = 0 },
  }
}
