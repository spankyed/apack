// The bar over a diff that offers the pieces of the change one at a time
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import DiffHunkBar from '#features/code/fe/canvas/DiffHunkBar.vue'

const HEADER = 'diff --git a/a.txt b/a.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/a.txt\n'
const TOP = { id: 'top', oldStart: 1, oldLines: 6, newStart: 1, newLines: 6, patch: `${HEADER}@@ -1,6 +1,6 @@\n a\n b\n-old\n+new\n c\n d\n e\n` }
const BOTTOM = { id: 'bottom', oldStart: 32, oldLines: 7, newStart: 32, newLines: 7, patch: `${HEADER}@@ -32,7 +32,7 @@\n a\n b\n c\n-old\n+new\n d\n e\n f\n` }

let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren() })

function bar(given: { staged?: boolean; unsaved?: boolean; busy?: boolean } = {}) {
  const props = reactive({ hunks: [TOP, BOTTOM], staged: false, unsaved: false, busy: false, ...given })
  const onApply = vi.fn()
  const onReveal = vi.fn()
  app = createApp({ render: () => h(DiffHunkBar, { ...props, onApply, onReveal }) })
  app.mount(document.body.appendChild(document.createElement('div')))
  const button = (title: string) => document.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!
  const apply = () => document.querySelector<HTMLButtonElement>('[data-testid="apply-hunk"]')
  return { props, onApply, onReveal, button, apply, text: () => document.body.textContent ?? '' }
}

it('names the piece it is on and stages that one', async () => {
  const { text, apply, onApply } = bar()
  expect(text()).toContain('Change 1 of 2 · lines 1–6')
  expect(apply()!.textContent).toBe('Stage this change')

  apply()!.click()

  expect(onApply).toHaveBeenCalledWith(TOP)
})

it('moves to the next piece, goes to where it changed, and comes round to the first again', async () => {
  const { text, button, onReveal, apply, onApply } = bar()

  button('Next change').click()
  await nextTick()
  expect(text()).toContain('Change 2 of 2 · lines 32–38')
  expect(onReveal).toHaveBeenLastCalledWith(35)
  apply()!.click()
  expect(onApply).toHaveBeenCalledWith(BOTTOM)

  button('Next change').click()
  await nextTick()
  expect(text()).toContain('Change 1 of 2')
})

it('offers to take a piece back when the pieces are of what is staged', () => {
  expect(bar({ staged: true }).apply()!.textContent).toBe('Unstage this change')
})

// The pieces are of the file as it was saved, and an edit not yet saved is in none of them
it('offers nothing to stage while the tab holds edits that are not saved, and says why', () => {
  const { apply, text } = bar({ unsaved: true })
  expect(apply()).toBeNull()
  expect(text()).toContain('Save the file')
})

it('stays on a piece that exists when the one it was on is staged', async () => {
  const { props, button, text } = bar()
  button('Next change').click()
  await nextTick()

  props.hunks = [TOP]
  await nextTick()

  expect(text()).toContain('Change 1 of 1 · lines 1–6')
})
