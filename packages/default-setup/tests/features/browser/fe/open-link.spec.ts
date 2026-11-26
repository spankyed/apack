// A link handed to the browser surface goes where this feature's own settings say: a tab of its own, or the
// system's browser. Both branches are the setting being read — the thing that broke when a feature's
// settings stopped reaching its surface — so the assertion is which of the two the surface reached for.
import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { system, type EventsOf } from '@apackdev/state'
import { defectGuard } from '@apackdev/state/testing'
import { startFeTestRuntime } from '@apackdev/sdk/testing'
import browserState from '#features/browser/fe/state.ts'

vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {} })

/** What the surface asked the shell to do, which is where `openSurface` sends */
let asked: unknown[]
/** What it handed the system's browser instead */
let external: string[]

afterAll(startFeTestRuntime({
  client: { send() {} },
  application: {
    getSnapshot: () => ({ context: {}, hasTag: () => false }),
    send: (event: unknown) => asked.push(event),
    system: { get: () => undefined },
    subscribe: () => ({ unsubscribe() {} }),
  } as never,
}))

beforeEach(() => {
  asked = []
  external = []
  ;(globalThis as { window?: unknown }).window ??= globalThis
  ;(globalThis as unknown as { electronAPI: unknown }).electronAPI =
    { shell: { openExternal: (url: string) => external.push(url) } }
})

function startBrowser(settings?: Record<string, unknown>) {
  const guard = defectGuard()
  const sys = system({ side: 'window', onDefect: guard.onDefect })
  sys.attach({
    tell: () => {},
    ask: () => () => {},
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' })
      return { stop: () => {} }
    },
  })
  const handle = sys.start('default-setup/browser', browserState)
  const send = (event: EventsOf<typeof browserState>) => sys.send(handle, event)
  if (settings) send({ type: 'FEATURE_SETTINGS_UPDATED', settings } as never)
  return {
    send,
    cleanup: () => {
      guard.assertNone()
      sys.stop()
      guard[Symbol.dispose]()
    },
  }
}

it('opens a link in its own tab by default, which is what no setting means', () => {
  const ctx = startBrowser()
  try {
    ctx.send({ type: 'LINK.OPEN', url: 'https://example.test/a' })

    expect(asked).toEqual([{
      type: 'OPEN_SURFACE',
      surface: 'default-setup/browser',
      events: [{ type: 'TAB.CREATE', url: 'https://example.test/a' }],
    }])
    expect(external).toEqual([])
  } finally {
    ctx.cleanup()
  }
})

it("hands it to the system's browser when the setting says so, asking the shell for nothing", () => {
  const ctx = startBrowser({ openLinksInApp: false })
  try {
    ctx.send({ type: 'LINK.OPEN', url: 'https://example.test/b' })

    expect(external).toEqual(['https://example.test/b'])
    expect(asked).toEqual([])
  } finally {
    ctx.cleanup()
  }
})
