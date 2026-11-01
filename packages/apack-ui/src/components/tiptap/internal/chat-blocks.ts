const blocks = new Set(['DIV', 'P', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'HR'])

/** Preserve the paragraph-based layout of the existing chat document schema. */
export function normalizeChatBlocks(root: HTMLElement): void {
  for (const list of root.querySelectorAll('ul,ol')) {
    if (!list.querySelector('p')) { list.classList.add('tight'); list.setAttribute('data-tight', 'true') }
  }
  for (const cell of root.querySelectorAll('th,td')) {
    const paragraph = document.createElement('p')
    paragraph.append(...cell.childNodes)
    cell.appendChild(paragraph)
  }
  for (const table of root.querySelectorAll('table')) {
    const wrapper = document.createElement('div')
    wrapper.className = 'tableWrapper'
    table.replaceWith(wrapper)
    wrapper.appendChild(table)
  }
  for (const item of root.querySelectorAll('li')) {
    let paragraph: HTMLParagraphElement | undefined
    // Moving nodes changes the live child list.
    const children = Array.from(item.childNodes)
    for (const child of children) {
      if (child.nodeType === 1 && blocks.has((child as Element).tagName)) { paragraph = undefined; continue }
      if (!paragraph && !child.textContent?.trim()) { child.remove(); continue }
      if (!paragraph) { paragraph = document.createElement('p'); item.insertBefore(paragraph, child) }
      paragraph.appendChild(child)
    }
    if (item.firstElementChild?.tagName !== 'P') item.prepend(document.createElement('p'))
  }
  if (!root.firstElementChild) root.appendChild(document.createElement('p'))
  for (const paragraph of root.querySelectorAll('p')) {
    if (paragraph.childNodes.length) continue
    const line = document.createElement('br')
    line.className = 'ProseMirror-trailingBreak'
    paragraph.appendChild(line)
  }
}
