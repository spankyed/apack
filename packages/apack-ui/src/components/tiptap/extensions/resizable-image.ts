import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'

export function getWidthFromSrc(src: string | null | undefined): number | null {
  if (!src) return null
  const url = URL.parse(src)
  const w = url?.searchParams.get('w')
  if (!w) return null
  const n = Number(w)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null
}

export function setSrcWidth(src: string, pct: number): string {
  const url = URL.parse(src)
  if (!url) return src
  if (pct >= 100) url.searchParams.delete('w')
  else url.searchParams.set('w', String(pct))
  return url.toString()
}

export const ResizableImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const width = getWidthFromSrc(HTMLAttributes.src)
    const attrs = { ...HTMLAttributes }
    if (width) attrs.style = `width: ${width}%`
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)]
  },
})
