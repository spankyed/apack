/** Parse as inert XML; the resulting SVG is only used in an image or opaque, scriptless frame. */
export function prepareClaudeSvg(source: string): { source: string; ratio?: number } | undefined {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = doc.documentElement
  if (doc.querySelector('parsererror') || root.localName !== 'svg' || (root.namespaceURI !== null && root.namespaceURI !== 'http://www.w3.org/2000/svg')) return
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (['script', 'iframe', 'object', 'embed', 'meta', 'base', 'link'].includes(element.localName.toLowerCase())) { element.remove(); continue }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.localName.toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && !attr.value.startsWith('#') && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(attr.value))) element.removeAttributeNode(attr)
    }
  }
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const ratio = viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0 ? viewBox[2]! / viewBox[3]! : undefined
  return { source: new XMLSerializer().serializeToString(root), ...(ratio ? { ratio } : {}) }
}
