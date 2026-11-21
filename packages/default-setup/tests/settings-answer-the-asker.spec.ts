// A settings write is an ask, answered to whoever asked for it, not to the Settings view of every window.
//
// A drive session's `/set-setting` and a settings form say what happened only from the answer: a write the store
// refused has to reach the sender with the store's reasons, or the sender reports success for a write that stored
// nothing. The data is news for every window, so `SETTINGS_UPDATED` still reaches each one beside the answer.
//
// The harness resolves a `sender` against registered systems, so a driver's ref cannot be named here, and naming the
// Settings surface makes an answer and a broadcast arrive at the same *place*. What tells them apart is
// `Message.answering`, which only an answer carries: `nextEmit`'s `answering` waits for the answer to one ask.
import { describe, expect, it } from 'vitest'
import { getTestSettings, startApp } from '@apackdev/testing/harness'

const SETTINGS = 'host/settings'
/** The connection the ask arrived on, which is what makes an ask a window's rather than the backend's */
const WINDOW = 'c-window'
/** Asked from a window, with the access a window's settings runtime has */
const asked = () => ({ settingsAccess: { kind: 'host' as const, service: getTestSettings() }, sender: SETTINGS, client: WINDOW })

/** A write that the store takes, and one it refuses, so each case says which it is asking for */
const write = (valid = true) => ({
  type: 'UPDATE_SETTINGS' as const,
  target: valid ? { kind: 'app' as const } : { kind: 'pack' as const, packId: 'default-setup', groupId: 'missing' },
  path: ['personal', 'name'],
  value: 'Ada',
})

describe('a settings write from a window', () => {
  it('is answered with the settings it stored', async () => {
    const app = await startApp({ systems: ['host/settings'] })
    await app.connect()

    const call = await app.send(SETTINGS, write(), asked())

    expect(await app.nextEmit(SETTINGS, 'ASK_ANSWERED', { answering: call }))
      .toMatchObject({ asked: 'UPDATE_SETTINGS', answer: { snapshot: { values: { app: { personal: { name: 'Ada' } } } } } })
  })

  /**
   * A refusal reaches whoever asked, with the store's own reasons: `problems` rather than one message, because a
   * document can be wrong in more than one place.
   */
  it('answers a refused write with the reasons, and stores nothing', async () => {
    const app = await startApp({ systems: ['host/settings'] })
    await app.connect()

    const call = await app.send(SETTINGS, write(false), asked())
    const answer = await app.nextEmit(SETTINGS, 'ASK_FAILED', { answering: call }) as unknown as { failure: { kind: string; problems: string[] } }

    expect(answer.failure.kind).toBe('refused')
    expect(answer.failure.problems.join(' ')).toContain('settings definition is unavailable')
    expect(getTestSettings().getOverrides()).toEqual({});
    expect(app.emitted(SETTINGS).filter((event) => event.type === 'ASK_ANSWERED'), 'and not also a save').toEqual([])
  })

  it('answers, and still tells every window the settings changed', async () => {
    const app = await startApp({ systems: ['host/settings'] })
    await app.connect()

    const call = await app.send(SETTINGS, write(), asked())
    await app.nextEmit(SETTINGS, 'ASK_ANSWERED', { answering: call })
    await app.settle()

    const types = app.emitted(SETTINGS).map((event) => event.type)
    expect(types, 'the data is not an answer, so it is still broadcast').toContain('SETTINGS_UPDATED')
  })
})

describe('a settings write with no sender', () => {
  // Code with no delivery in scope writes too: nobody waits on the answer, and every window hears the change
  it('tells every window the settings changed, and answers nobody', async () => {
    const app = await startApp({ systems: ['host/settings'] })
    await app.connect()

    await app.send(SETTINGS, write(), { settingsAccess: { kind: 'host', service: getTestSettings() } })
    await app.settle()

    const types = app.emitted(SETTINGS).map((event) => event.type)
    expect(types).toContain('SETTINGS_UPDATED')
    expect(types, 'nobody asked').not.toContain('ASK_ANSWERED')
  })
})
