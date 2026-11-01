import type MarkdownIt from 'markdown-it'
import type { ReadOnlyTextRenderer } from '@apackdev/sdk/fe'
import { createCodeCopyButton } from './code-copy-button.ts'
import { highlightCode } from './code-highlighting.ts'

/** A candidate fragment is fully prepared before publication; every enhancement owns cleanup. */
export function renderChat(parser: MarkdownIt, source: string, adapters: readonly ReadOnlyTextRenderer[]) {
  const root = document.createElement('div')
  const cleanups: Array<() => void> = []
  const dispose = () => {
    const errors: unknown[] = []
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { cleanup() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Read-only message cleanup failed')
  }
  try {
    for (const adapter of adapters) {
      if (!adapter.transformMarkdown) continue
      source = adapter.transformMarkdown(source)
      if (typeof source !== 'string') throw new TypeError('Read-only Markdown transform must return a string')
    }
    root.innerHTML = parser.render(source)
    for (const code of root.querySelectorAll<HTMLElement>('pre > code')) {
      highlightCode(code)
      const pre = code.parentElement!
      const wrapper = document.createElement('div')
      wrapper.className = 'code-block-wrapper'
      pre.replaceWith(wrapper)
      const copy = createCodeCopyButton(code)
      cleanups.push(copy.dispose)
      wrapper.append(copy.button, pre)
    }
    for (const adapter of adapters) {
      const cleanup = adapter.decorate?.(root)
      if (cleanup !== undefined && typeof cleanup !== 'function') throw new TypeError('Read-only decoration must return cleanup or undefined')
      if (cleanup) cleanups.push(cleanup)
    }
    return { root, dispose }
  } catch (error) {
    try { dispose() } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Read-only message construction and cleanup failed') }
    throw error
  }
}
