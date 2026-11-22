// The commit panel as it is drawn over its machine: the buttons it shows for the repository it holds, what each
// one asks for, and what it says when an ask is answered.
//
// The panel runs inside the code surface's scope with the real commit machine as the surface's `commit` child, so
// a case gives that machine what the backend would answer and reads back what is drawn and what was sent.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createActor, createMachine, sendTo, type AnyActorRef, type AnyEventObject } from 'xstate'
import { asksOf, latestAsk, made, resetAsks } from '../../_support/asks.ts'

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), broadcast: vi.fn(), sendToSurface: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }))

const { SurfaceScope } = await import('@apackdev/sdk/fe')
const { fakeSettings, startFeTestRuntime, stopFeTestRuntime } = await import('@apackdev/sdk/testing')
const { bindSettings } = await import('#generated/settings-fe.ts')
const { commitState } = await import('#features/code/fe/features/commit/state.ts')
const { default: CommitPanel } = await import('#features/code/fe/features/commit/CommitPanel.vue')

const CODE_SURFACE = 'default-setup/code'
type File = { path: string; status: string; staged: boolean; nameNotText?: true; submodule?: { commit: boolean; modified: boolean; untracked: boolean } }

let app: App | undefined
let code: AnyActorRef | undefined
let stopRuntime: (() => void) | undefined
let settings: { dispose(): void } | undefined
beforeEach(resetAsks)
afterEach(() => {
  app?.unmount()
  code?.stop()
  settings?.dispose()
  stopRuntime?.()
  stopFeTestRuntime()
  app = code = stopRuntime = settings = undefined
  document.body.replaceChildren()
})

const settle = async () => { await nextTick(); await nextTick() }

/** The panel, over a commit machine that has read `status` from the repository, with the code settings `codeSettings` */
async function panel(status: { files?: File[]; commitsAhead?: number; hasUpstream?: boolean; operation?: unknown } = {}, codeSettings: Record<string, unknown> = {}) {
  const codeMachine = createMachine({
    types: {} as { context: { baseDirectory: string; openFiles: unknown[]; settings: Record<string, unknown> }; events: AnyEventObject },
    id: CODE_SURFACE,
    invoke: { id: 'commit', src: commitState },
    context: { baseDirectory: '/work/repo', openFiles: [], settings: { showStashes: true, showCommits: true, ...codeSettings } },
    on: { 'commit.*': { actions: sendTo('commit', ({ event }) => event) } },
  })
  code = createActor(codeMachine, { id: CODE_SURFACE }).start()
  const commit = code.getSnapshot().children.commit as AnyActorRef
  const shell = {
    getSnapshot: () => ({ context: { surfaces: [], activeSurface: null, surfaceVisibility: {}, commands: [], panelSizes: {} }, hasTag: () => false }),
    subscribe: () => ({ unsubscribe() {} }),
    send() {},
    system: { get: () => code },
  }
  stopRuntime = startFeTestRuntime({ application: shell as never })
  const bound = bindSettings(fakeSettings({ features: { [CODE_SURFACE]: { showStashes: true, showCommits: true } } }))
  bound.activate()
  settings = bound

  commit.send({ type: 'commit.REFRESH_STATUS' })
  await latestAsk('commit.GET_GIT_STATUS').answer({
    files: status.files ?? [], truncated: false, branch: 'main', hasUpstream: status.hasUpstream ?? true,
    commitsAhead: status.commitsAhead ?? 0, commitsBehind: 0, watching: true, ...(status.operation ? { operation: status.operation } : {}),
  })

  app = createApp({ render: () => h(SurfaceScope, { surface: CODE_SURFACE }, { default: () => h(CommitPanel) }) })
  app.mount(document.body.appendChild(document.createElement('div')))
  await settle()
  return commit
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const buttonNamed = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
const sent = () => made.map(ask => ask.event.type)
const staged: File = { path: 'a.ts', status: 'modified', staged: true }
const unstaged: File = { path: 'b.ts', status: 'modified', staged: false }

async function typeMessage(text: string) {
  const box = byTestId('commit-message') as HTMLTextAreaElement
  box.value = text
  box.dispatchEvent(new Event('input'))
  await settle()
}

it('lists the trailers git read under the message, marks those the settings leave out of a commit, and takes one out when asked', async () => {
  await panel({ files: [staged] }, { trailersRemovedOnCommit: ['co-authored-by'] })
  await typeMessage('feat\n\nCo-authored-by: A\nSigned-off-by: B')
  await latestAsk('commit.READ_TRAILERS').answer({ message: 'feat\n\nCo-authored-by: A\nSigned-off-by: B', trailers: [{ key: 'Co-authored-by', value: 'A' }, { key: 'Signed-off-by', value: 'B' }] })
  await settle()

  const chips = [...document.querySelectorAll<HTMLElement>('[data-commit-trailer]')]
  expect(chips.map(chip => chip.textContent?.includes('removed on commit'))).toEqual([true, false])

  chips[1]!.querySelector('button')!.click()
  expect(asksOf('commit.REMOVE_TRAILER').map(ask => ask.event))
    .toEqual([{ type: 'commit.REMOVE_TRAILER', message: 'feat\n\nCo-authored-by: A\nSigned-off-by: B', trailer: { key: 'Signed-off-by', value: 'B' } }])
})

it('offers to update a submodule on another commit, one at a time, saying how far along it is, until it is answered', async () => {
  const moved: File = { path: 'lib', status: 'modified', staged: false, submodule: { commit: true, modified: false, untracked: false } }
  const edited: File = { path: 'vendor', status: 'modified', staged: false, submodule: { commit: false, modified: true, untracked: false } }
  await panel({ files: [moved, edited, unstaged] })
  const updates = () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="update-submodule"]')]
  expect(updates()).toHaveLength(1)

  updates()[0]!.click()
  await settle()
  updates()[0]!.click()
  latestAsk('commit.UPDATE_SUBMODULE').tell({ during: 'submodule', stage: 'Receiving objects', percent: 40 })
  await settle()
  expect(asksOf('commit.UPDATE_SUBMODULE').map(ask => ask.event)).toEqual([{ type: 'commit.UPDATE_SUBMODULE', path: 'lib' }])
  expect(updates()[0]!.disabled).toBe(true)
  expect(updates()[0]!.title).toBe('Updating submodule Receiving objects 40%')

  await latestAsk('commit.UPDATE_SUBMODULE').refuse('lib has local changes', { kind: 'git', code: 'local-changes' })
  await settle()
  expect(updates()[0]!.disabled, 'a failed update lets go of the button').toBe(false)
  expect(document.body.textContent).toContain('lib has local changes')

  updates()[0]!.click()
  await settle()
  await latestAsk('commit.UPDATE_SUBMODULE').answer({ path: 'lib' })
  await settle()
  expect(updates()[0]!.disabled, 'an update answered lets go of the button').toBe(false)
})

it('says a push the user stopped was stopped, not pushed', async () => {
  const commit = await panel({ commitsAhead: 2 })
  buttonNamed('Push (2 commits)')!.click()
  await settle()

  commit.send({ type: 'commit.STOP_PUSH' })
  expect(latestAsk('commit.PUBLISH_BRANCH').stopped).toBe(true)
  await settle()

  expect(document.body.textContent).toContain('Push stopped')
  expect(document.body.textContent).not.toContain('Pushed')
})

it('shows Push without a Commit beside it when nothing is staged and there are commits to push', async () => {
  await panel({ commitsAhead: 1 })

  expect(buttonNamed('Push (1 commit)')).toBeDefined()
  expect(byTestId('commit-button'), 'nothing staged: nothing to commit').toBeNull()
})

it('shows an untrusted repository the trust request alone, not the error again beneath it', async () => {
  const commit = await panel()
  commit.send({ type: 'commit.REFRESH_STATUS' })
  await latestAsk('commit.GET_GIT_STATUS').refuse('This repository has hooks that make git run programs.', {
    kind: 'git', code: 'untrusted', trust: { repository: '/work/repo/.git', asks: [{ kind: 'hook', name: 'pre-commit', file: '/work/repo/.git/hooks/pre-commit' }] },
  })
  await settle()

  expect(document.body.textContent!.split('This repository has hooks that make git run programs.').length - 1).toBeLessThanOrEqual(1)
  expect(document.querySelector('.border-red-800'), 'the error box').toBeNull()
})

it('takes one commit at a time: Commit is off from the click until its answer', async () => {
  await panel({ files: [staged] })
  await typeMessage('Fix it')
  const button = byTestId('commit-button') as HTMLButtonElement
  expect(button.disabled).toBe(false)

  button.click()
  await settle()
  expect(button.disabled, 'asked and unanswered').toBe(true)
  button.click()
  expect(sent().filter(type => type === 'commit.COMMIT')).toHaveLength(1)

  await latestAsk('commit.COMMIT').refuse('The hook refused it', { kind: 'git' })
  await settle()
  expect(button.disabled, 'refused: it can be asked again').toBe(false)
})

it('keeps the message box closed to typing while a message is being generated', async () => {
  const commit = await panel({ files: [staged] })
  commit.send({ type: 'commit.GENERATING_MESSAGE' })
  await settle()

  expect((byTestId('commit-message') as HTMLTextAreaElement).readOnly).toBe(true)

  commit.send({ type: 'commit.MESSAGE_GENERATED', data: { message: 'Generated' } })
  await settle()
  expect((byTestId('commit-message') as HTMLTextAreaElement).readOnly).toBe(false)
})

it('warns Discard All of a file too large to keep when a row of the list cannot be named', async () => {
  await panel({ files: [unstaged, { path: 'b\\377d', status: 'untracked', staged: false, nameNotText: true }] })
  ;(document.querySelector('[title="Discard All Changes"]') as HTMLElement).click()
  await settle()
  expect(sent()).toContain('commit.PREVIEW_DISCARD')

  await latestAsk('commit.PREVIEW_DISCARD').answer({ paths: ['b.ts'], notKept: ['b.ts'] })
  await settle()

  expect(byTestId('discard-not-kept')?.textContent).toContain('b.ts')
})

it('keeps Commit off during a conflict, as its title says', async () => {
  await panel({ files: [staged, { path: 'c.ts', status: 'unmerged', staged: false }] })
  await typeMessage('Merge')

  const button = byTestId('commit-button') as HTMLButtonElement
  expect(button.title).toBe('Settle the conflicts first.')
  expect(button.disabled).toBe(true)
})

it('pushes a tag only once the push is confirmed, shows it busy, and says when it is pushed', async () => {
  const commit = await panel()
  commit.send({ type: 'commit.GET_ALL_BRANCHES' })
  await latestAsk('commit.GET_ALL_BRANCHES').answer({ branches: ['main'], tags: [{ name: 'v1', commit: 'abcdef1234' }] })
  document.querySelector<HTMLInputElement>('input[placeholder="main"]')!.dispatchEvent(new FocusEvent('focus'))
  await settle()
  const pushTag = byTestId('push-tag')
  if (!pushTag) throw new Error(`no tag row drawn: ${document.body.innerHTML.slice(0, 400)}`)

  pushTag.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await settle()
  expect(sent(), 'asked first').not.toContain('commit.PUSH_TAG')
  expect(document.body.textContent).toContain('Push the tag v1 to the remote')

  buttonNamed('Confirm')!.click()
  await settle()
  expect(sent()).toContain('commit.PUSH_TAG')
  expect(byTestId('tag-busy')).not.toBeNull()

  await latestAsk('commit.PUSH_TAG').answer({ name: 'v1' })
  await settle()
  expect(byTestId('tag-busy')).toBeNull()
  expect(document.body.textContent).toContain('v1 is on the remote')
})

it('opens a stash row to its files on a click, and applies it only from its own button', async () => {
  const commit = await panel()
  commit.send({ type: 'commit.STASH_LIST' })
  await latestAsk('commit.STASH_LIST').answer({ stashes: [{ index: 0, ref: 'stash@{0}', message: 'On main: wip', date: '2026-11-14T00:00:00Z' }] })
  await settle()
  const stashes = [...document.querySelectorAll<HTMLElement>('div.cursor-pointer')].find(d => d.textContent?.includes('STASHES'))
  stashes?.click()
  await settle()

  byTestId('stash-row')!.click()
  await settle()
  expect(sent()).not.toContain('commit.STASH_APPLY')

  byTestId('stash-apply')!.click()
  expect(sent()).toContain('commit.STASH_APPLY')
})

it('resets to a commit only once that is confirmed, shows it busy, and says a revert can be taken back', async () => {
  const commit = await panel()
  commit.send({ type: 'commit.LOG_LIST' })
  const entry = (hash: string, parents: string[]) => ({ hash, parents, subject: `commit ${hash}`, authorName: 'A', authorEmail: 'a@example.com', date: '2026-11-14T00:00:00Z', refs: [] })
  await latestAsk('commit.LOG_LIST').answer({ commits: [entry('bbbbbbb2', ['aaaaaaa1']), entry('aaaaaaa1', [])] })
  await settle()
  ;[...document.querySelectorAll<HTMLElement>('div.cursor-pointer')].find(d => d.textContent?.includes('COMMITS'))!.click()
  await settle()

  ;(document.querySelector('[title="Revert this commit"]') as HTMLElement).click()
  await settle()
  expect(byTestId('dialog-reversible')?.textContent).toContain('Reverting the new commit')
  expect(byTestId('dialog-irreversible'), 'a revert adds a commit, which can be taken back').toBeNull()
  buttonNamed('Cancel')!.click()
  await settle()

  document.querySelectorAll<HTMLElement>('[data-testid="reset-to-commit"]')[1]!.click()
  await settle()
  expect(sent(), 'asked first').not.toContain('commit.RESET_TO_COMMIT')
  buttonNamed('Confirm')!.click()
  await settle()
  expect(latestAsk('commit.RESET_TO_COMMIT').event).toEqual({ type: 'commit.RESET_TO_COMMIT', hash: 'aaaaaaa1' })
  expect(byTestId('reset-busy')).not.toBeNull()

  await latestAsk('commit.RESET_TO_COMMIT').refuse('refused', { kind: 'git' })
  await settle()
  expect(byTestId('reset-busy'), 'refused: no longer busy').toBeNull()
})

it('commits on Cmd+Enter or Ctrl+Enter in the message box, only where Commit could be pressed', async () => {
  await panel({ files: [staged] })
  const press = async (init: KeyboardEventInit) => {
    byTestId('commit-message')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }))
    await settle()
  }
  const commits = () => sent().filter(type => type === 'commit.COMMIT').length

  await press({ metaKey: true })
  expect(commits(), 'no message: Commit could not be pressed').toBe(0)
  await typeMessage('Fix it')
  await press({})
  await press({ shiftKey: true, metaKey: true })
  expect(commits(), 'Enter alone is a new line').toBe(0)
  await press({ ctrlKey: true, isComposing: true })
  expect(commits(), 'an input method is composing').toBe(0)
  await press({ ctrlKey: true })
  expect(commits()).toBe(1)
  await press({ metaKey: true })
  expect(commits(), 'one commit at a time').toBe(1)
})
