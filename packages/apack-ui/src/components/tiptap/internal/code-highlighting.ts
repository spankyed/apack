import { common, createLowlight } from 'lowlight'

export const lowlight = createLowlight(common)

/** Build syntax markup as DOM; highlighted source is always text, never HTML. */
export function highlightCode(code: HTMLElement): void {
  const language = [...code.classList].find(value => value.startsWith('language-'))?.slice(9)
  if (language && !lowlight.registered(language)) return
  const source = code.textContent ?? ''
  const tree = language ? lowlight.highlight(language, source) : lowlight.highlightAuto(source)
  type HighlightNode = (typeof tree.children)[number]
  const render = (node: HighlightNode): Node => {
    if (node.type === 'text') return document.createTextNode(node.value)
    if (node.type !== 'element') return document.createTextNode('')
    const span = document.createElement('span')
    const classes = node.properties.className
    if (Array.isArray(classes)) span.className = classes.join(' ')
    span.append(...node.children.map(render))
    return span
  }
  code.classList.add('hljs')
  code.replaceChildren(...tree.children.map(render))
}
