import { openEntity } from '@apackdev/sdk/fe'
import type { EARS } from '@apackdev/sdk'
import { getReferenceTypeDeclaration, onReferenceDeclarationsChanged } from '@apackdev/sdk/fe/references'

function createIconSvg(type: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')

  for (const [tag, attrs] of getReferenceTypeDeclaration(type)?.svgElements ?? []) {
    const el = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v)
    }
    svg.appendChild(el)
  }

  return svg
}

export interface ReferencePillTarget { type: string; id: string; label: string }

export function createReferencePill(initial: ReferencePillTarget, editable = () => false) {
  let target = initial
  const dom = document.createElement('span')
  dom.className = 'reference-pill'
  dom.contentEditable = 'false'
  const icon = document.createElement('span')
  icon.className = 'reference-pill-icon'
  const label = document.createElement('span')
  label.className = 'reference-pill-label'
  dom.append(icon, label)
  const update = (next: ReferencePillTarget) => {
    target = next
    dom.dataset.refType = target.type
    icon.replaceChildren(createIconSvg(target.type))
    label.textContent = target.label
  }
  update(initial)
  const stop = onReferenceDeclarationsChanged(() => { icon.replaceChildren(createIconSvg(target.type)) })
  const click = (event: MouseEvent) => {
    if (editable() && !event.metaKey && !event.ctrlKey) return
    if (typeof target.id === 'string' && target.id.includes('-')) openEntity(target.id as EARS.EntityId)
  }
  dom.addEventListener('click', click)
  return { dom, update, dispose() { stop(); dom.removeEventListener('click', click) } }
}
