// The GitHub sign-in as it is drawn: the code GitHub gave is said to be copied only once that code is.
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { assign, createActor, createMachine, sendTo, type AnyActorRef, type AnyEventObject } from 'xstate'
import { SurfaceScope } from '@apackdev/sdk/fe'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'

const { default: GitHubAccount } = await import('#features/code/fe/features/github/GitHubAccount.vue')

const CODE_SURFACE = 'default-setup/code'
let app: App | undefined
let code: AnyActorRef | undefined
let stopRuntime: (() => void) | undefined
afterEach(() => {
  app?.unmount()
  code?.stop()
  stopRuntime?.()
  stopFeTestRuntime()
  app = code = stopRuntime = undefined
  delete (window as { electronAPI?: unknown }).electronAPI
  document.body.replaceChildren()
})

const codeOf = (userCode: string) => ({ userCode, verificationUri: 'https://github.com/login/device', expiresAt: 0 })

/** The account form, over a sign-in GitHub has given `userCode` for */
async function account(userCode: string) {
  const github = createMachine({
    types: {} as { context: { account: null; code: ReturnType<typeof codeOf>; failure: null }; events: AnyEventObject },
    context: { account: null, code: codeOf(userCode), failure: null },
    // As the sign-in's own machine is while one is under way
    initial: 'signingIn',
    states: { signingIn: {} },
    on: { 'test.CODE': { actions: assign({ code: ({ event }) => codeOf(event.userCode as string) }) } },
  })
  code = createActor(createMachine({
    types: {} as { events: AnyEventObject },
    id: CODE_SURFACE,
    invoke: { id: 'github', src: github },
    on: { 'test.CODE': { actions: sendTo('github', ({ event }) => event) } },
  }), { id: CODE_SURFACE }).start()
  stopRuntime = startFeTestRuntime({ application: { system: { get: () => code }, subscribe: () => ({ unsubscribe() {} }) } as never })
  ;(window as { electronAPI?: unknown }).electronAPI = { clipboard: { writeText: vi.fn(async () => true) }, shell: { openExternal: vi.fn() } }

  app = createApp({ render: () => h(SurfaceScope, { surface: CODE_SURFACE }, { default: () => h(GitHubAccount) }) })
  app.mount(document.body.appendChild(document.createElement('div')))
  await nextTick()
}

const copyButton = () => [...document.querySelectorAll('button')].find(b => ['Copy', 'Copied'].includes(b.textContent!.trim()))!

it('says Copied for the code copied, and Copy again for the next code GitHub gives', async () => {
  await account('AAAA-1111')
  copyButton().click()
  // The copy is answered by the clipboard's promise, and drawn on the tick after
  await Promise.resolve()
  await nextTick()
  expect(copyButton().textContent!.trim()).toBe('Copied')

  code!.send({ type: 'test.CODE', userCode: 'BBBB-2222' })
  await nextTick()
  await nextTick()

  expect(document.body.textContent).toContain('BBBB-2222')
  expect(copyButton().textContent!.trim()).toBe('Copy')
})
