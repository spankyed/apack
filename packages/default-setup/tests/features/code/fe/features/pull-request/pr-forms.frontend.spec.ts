// The pull request's forms keep what was typed until GitHub has taken it: a refused save or comment leaves
// the text where it was, and only the answer to that form's own write lets go of it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'
import type { GhPullRequest, GhPRComment, GhReviewThread } from '#generated/types.ts'
import type { WriteAnswer } from '#features/code/fe/features/pull-request/state.ts'

// The editor is a textarea here: what matters is the text the form holds, not how it is edited
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', () => ({
  default: defineComponent({
    props: { modelValue: String, mode: String },
    emits: ['update:modelValue'],
    setup: (props, { emit }) => () => props.mode === 'editor'
      ? h('textarea', { value: props.modelValue, onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value) })
      : h('div', props.modelValue),
  }),
}))
vi.mock('@apackdev/ui/design/ImageLightbox', () => ({ default: defineComponent({ render: () => null }) }))

const { default: PRComments } = await import('#features/code/fe/features/pull-request/PRComments.vue')
const { default: PRInfo } = await import('#features/code/fe/features/pull-request/PRInfo.vue')
const { default: PRActionBar } = await import('#features/code/fe/features/pull-request/PRActionBar.vue')
const { default: PRSelector } = await import('#features/code/fe/features/pull-request/PRSelector.vue')

let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren() })

const mount = (component: unknown, props: Record<string, unknown>) => {
  app = createApp({ render: () => h(component as never, props) })
  app.mount(document.body.appendChild(document.createElement('div')))
}

const typeInto = async (area: HTMLTextAreaElement, text: string) => {
  area.value = text
  area.dispatchEvent(new Event('input'))
  await nextTick()
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label || b.title === label)!
const areas = () => [...document.querySelectorAll('textarea')]

const comment = (id: number, body: string) =>
  ({ id: `IC_${id}`, url: `https://github.com/o/r/pull/1#issuecomment-${id}`, body, author: { login: 'me' }, createdAt: '', viewerDidAuthor: true }) as GhPRComment

describe('a comment form', () => {
  const comments = () => {
    const props = reactive({
      comments: [comment(2, 'first')],
      reviewThreads: [] as GhReviewThread[],
      tab: 'discussion' as const,
      prNumber: 1,
      isOpen: true,
      isSubmitting: false,
      answered: null as WriteAnswer | null,
      'onCreate-comment': vi.fn(),
      'onEdit-comment': vi.fn(),
    })
    mount(PRComments, props)
    return props
  }

  it('keeps a new comment when it is refused, and clears it when it is taken', async () => {
    const props = comments()
    await typeInto(areas()[0]!, 'hello')
    button('Comment').click()
    expect(props['onCreate-comment']).toHaveBeenCalledWith('hello')

    props.answered = { write: 'create-comment', target: 1, ok: false }
    await nextTick()
    expect(areas()[0]!.value, 'refused: what was typed is still there').toBe('hello')

    button('Comment').click()
    props.answered = { write: 'create-comment', target: 1, ok: true }
    await nextTick()
    expect(areas()[0]!.value).toBe('')
  })

  it('stays editing a comment until its own edit is taken', async () => {
    const props = comments()
    button('Edit').click()
    await nextTick()
    await typeInto(areas()[0]!, 'changed')
    button('Save').click()
    expect(props['onEdit-comment']).toHaveBeenCalledWith(2, 'changed')
    await nextTick()
    expect(areas()[0]!.value, 'still editing once sent').toBe('changed')

    props.answered = { write: 'edit-comment', target: 2, ok: false }
    await nextTick()
    expect(areas()[0]!.value, 'refused: still editing').toBe('changed')

    props.answered = { write: 'edit-comment', target: 99, ok: true }
    await nextTick()
    expect(button('Save'), "another comment's edit leaves this one open").toBeDefined()

    props.answered = { write: 'edit-comment', target: 2, ok: true }
    await nextTick()
    expect(button('Save')).toBeUndefined()
  })
})

describe("the pull request's edit form", () => {
  const pr = (number: number) => ({
    number, title: `PR ${number}`, body: 'body', baseRefName: 'main', headRefName: `feature-${number}`,
    state: 'OPEN', isDraft: false, author: { login: 'me' }, createdAt: '', url: '',
  }) as unknown as GhPullRequest

  const info = () => {
    const props = reactive({
      pr: pr(3), comments: [] as GhPRComment[], branches: ['main'], isLoading: false, isUpdating: false,
      answered: null as WriteAnswer | null, onSave: vi.fn(),
    })
    mount(PRInfo, props)
    return props
  }
  const titleInput = () => document.querySelector<HTMLInputElement>('input')

  it('stays editing when the save is refused, and leaves on its success', async () => {
    const props = info()
    button('Edit PR').click()
    await nextTick()
    titleInput()!.value = 'new title'
    titleInput()!.dispatchEvent(new Event('input'))
    button('Save').click()
    expect(props.onSave).toHaveBeenCalledWith({ title: 'new title' })

    props.isUpdating = true
    await nextTick()
    props.isUpdating = false
    props.answered = { write: 'update-pr', target: 3, ok: false }
    await nextTick()
    expect(titleInput()?.value, 'refused: what was typed is still there').toBe('new title')

    props.answered = { write: 'update-pr', target: 3, ok: true }
    await nextTick()
    expect(titleInput()).toBeNull()
  })

  it('leaves an edit when the pull request shown changes, so it cannot be saved onto another', async () => {
    const props = info()
    button('Edit PR').click()
    await nextTick()
    expect(titleInput()?.value).toBe('PR 3')

    props.pr = pr(9)
    await nextTick()
    expect(titleInput()).toBeNull()
  })
})

describe('an edit', () => {
  const signed = 'https://objects.example/signed?expires=1'
  const written = 'https://github.com/user-attachments/assets/0f1e2d3c'

  it("of a comment starts from the comment as written, not from its images' signed addresses", async () => {
    mount(PRComments, {
      comments: [{ ...comment(2, `![shot](${signed})`), rawBody: `![shot](${written})` }],
      reviewThreads: [], tab: 'discussion', prNumber: 1, isOpen: true, isSubmitting: false, answered: null,
    })
    button('Edit').click()
    await nextTick()
    expect(areas()[0]!.value).toBe(`![shot](${written})`)
  })

  it('of the description starts from it as written, and an unchanged one saves no body', async () => {
    const onSave = vi.fn()
    mount(PRInfo, {
      pr: { number: 3, title: 'PR 3', body: `![shot](${signed})`, rawBody: `![shot](${written})`, baseRefName: 'main', headRefName: 'f', state: 'OPEN', isDraft: false, author: { login: 'me' }, createdAt: '', url: '' },
      comments: [], branches: ['main'], isLoading: false, isUpdating: false, answered: null, onSave,
    })
    button('Edit PR').click()
    await nextTick()
    expect(areas().map(area => area.value)).toContain(`![shot](${written})`)
    const title = document.querySelector<HTMLInputElement>('input')!
    title.value = 'retitled'
    title.dispatchEvent(new Event('input'))
    button('Save').click()
    expect(onSave).toHaveBeenCalledWith({ title: 'retitled' })
  })
})

describe("deleting a pull request's branch", () => {
  const merged = { number: 3, title: 'PR 3', body: '', baseRefName: 'main', headRefName: 'feature', isCrossRepository: false, state: 'MERGED', isDraft: false, author: { login: 'me' }, createdAt: '', url: '' }
  const actionBar = (canDeleteBranch: boolean) => {
    const onDelete = vi.fn()
    mount(PRActionBar, { pr: merged, isMerging: false, isClosing: false, isTogglingDraft: false, isDeletingBranch: false, canDeleteBranch, 'onDelete-branch': onDelete })
    return onDelete
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('is asked first, and sent only when the user says yes', () => {
    const asked = vi.fn(() => false)
    vi.stubGlobal('confirm', asked)
    const onDelete = actionBar(true)

    button('Delete Branch').click()
    expect(asked).toHaveBeenCalledWith(expect.stringContaining('feature'))
    expect(onDelete).not.toHaveBeenCalled()

    asked.mockReturnValue(true)
    button('Delete Branch').click()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('is not offered for a branch it may not delete', () => {
    actionBar(false)
    expect(button('Delete Branch')).toBeUndefined()
  })
})

describe("checking out a pull request's branch", () => {
  const open = { number: 3, title: 'PR 3', body: '', baseRefName: 'main', headRefName: 'feature', state: 'OPEN', isDraft: false, author: { login: 'me' }, createdAt: '', url: '' }
  const bar = (props: Record<string, unknown>) => {
    const onCheckout = vi.fn()
    mount(PRActionBar, { pr: open, isMerging: false, isClosing: false, isTogglingDraft: false, isDeletingBranch: false, canDeleteBranch: false, isCheckingOut: false, isCheckedOut: false, onCheckout, ...props })
    return onCheckout
  }
  const checkout = () => document.querySelector<HTMLButtonElement>('[data-testid="pr-checkout"]')

  it('is offered for an open pull request not checked out, and off while one is under way', () => {
    const onCheckout = bar({})
    checkout()!.click()
    expect(onCheckout).toHaveBeenCalledOnce()
    app!.unmount()
    bar({ isCheckingOut: true })
    expect(checkout()!.disabled).toBe(true)
    app!.unmount()
    bar({ isCheckedOut: true })
    expect(checkout(), 'checked out already').toBeNull()
  })
})

describe('the pull request list', () => {
  const list = (extra: Record<string, unknown> = {}) => ({ state: 'open', query: '', prs: [], next: null, read: true, ...extra })
  const pr = (number: number) => ({ number, title: `PR ${number}`, state: 'OPEN', isDraft: false })
  const open = async (props: Record<string, unknown>) => {
    const handlers = { onShown: vi.fn(), 'onSet-state': vi.fn(), 'onSet-query': vi.fn(), 'onLoad-more': vi.fn(), 'onSelect-pr': vi.fn() }
    mount(PRSelector, { selectedPR: null, reading: null, ...handlers, ...props })
    document.querySelector('button')!.click()
    await nextTick()
    return handlers
  }
  const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  afterEach(() => { vi.useRealTimers() })

  it('is read when opened, filtered by its tabs, and paged by Load more', async () => {
    const on = await open({ list: list({ prs: [pr(9), pr(8)], next: 'C1' }) })
    expect(on.onShown).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('#9 PR 9')
    byTestId('pr-list-state-merged')!.click()
    expect(on['onSet-state']).toHaveBeenCalledWith('merged')
    byTestId('pr-list-more')!.click()
    expect(on['onLoad-more']).toHaveBeenCalledOnce()
  })

  it('searches once typing pauses, and says when nothing matches', async () => {
    vi.useFakeTimers()
    const on = await open({ list: list({ query: 'x', read: true }) })
    const box = byTestId('pr-list-search') as HTMLInputElement
    for (const text of ['f', 'fl', 'flaky']) { box.value = text; box.dispatchEvent(new Event('input')); await nextTick() }
    vi.advanceTimersByTime(299)
    expect(on['onSet-query']).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(on['onSet-query']).toHaveBeenCalledExactlyOnceWith('flaky')
    expect(byTestId('pr-list-empty')!.textContent).toContain('No pull requests match')
  })

  it('shows no Load more while the list is being read again, or after its last page', async () => {
    await open({ list: list({ prs: [pr(9)], next: 'C1' }), reading: 'first' })
    expect(byTestId('pr-list-more')).toBeNull()
    expect(document.body.textContent).toContain('Loading')
    app!.unmount()
    await open({ list: list({ prs: [pr(9)], next: null }) })
    expect(byTestId('pr-list-more')).toBeNull()
  })
})
