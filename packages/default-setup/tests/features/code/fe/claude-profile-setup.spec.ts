import { createActor, fromTransition } from 'xstate'
import { asksOf, latestAsk, resetAsks } from './_support/asks.ts'

vi.mock('#generated/events.ts', async () => ({
  tell: vi.fn(),
  broadcast: vi.fn(),
  sendToSurface: vi.fn(),
  fromAsk: (await import('./_support/asks.ts')).fromAsk,
}))
vi.mock('#extensions/terminal/pool.ts', () => ({
  terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn(), describe: vi.fn() },
}))
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}))

const { default: codeState } = await import('#features/code/fe/state.ts')
const actors: ReturnType<typeof createActor>[] = []

function windowActor() {
  const events: unknown[] = []
  const empty = fromTransition(state => state, {})
  const terminal = fromTransition((state, event) => {
    events.push(event)
    return state
  }, {})
  const machine = codeState.provide({
    actors: { explorerState: empty, terminalState: terminal, searchState: empty, commitState: empty, pullRequestState: empty, actionsState: empty, promptsState: empty } as never,
    actions: { restorePersistedTabs: () => {} },
  })
  const actor = createActor(machine).start()
  actors.push(actor)
  return { actor, events }
}

afterEach(() => {
  for (const actor of actors.splice(0)) actor.stop()
  resetAsks()
})

it('opens setup only in the window that asked and ignores retired and duplicate work', async () => {
  const first = windowActor()
  const other = windowActor()
  first.actor.send({ type: 'OPEN_CLAUDE_PROFILE_SETUP' })
  first.actor.send({ type: 'OPEN_CLAUDE_PROFILE_SETUP' })
  const name = 'PREPARE_CLAUDE_PROFILE_SETUP'
  expect(asksOf(name)).toHaveLength(1)
  const initial = latestAsk(name)
  await initial.answer({ cwd: '/project', command: 'native-onboarding' })
  expect(other.events).toEqual([])
  expect(first.events).toEqual([{ type: 'terminal.CREATE', target: 'tab', title: 'Claude profile setup', cwd: '/project', command: 'native-onboarding' }])

  first.actor.send({ type: 'OPEN_CLAUDE_PROFILE_SETUP' })
  const pending = latestAsk(name)
  expect(pending).not.toBe(initial)
  first.actor.send({ type: 'BASE_DIRECTORY_CHANGED', baseDirectory: '/another/project' })
  expect(pending.stopped).toBe(true)
  await pending.answer({ cwd: '/project', command: 'stale-onboarding' })
  expect(first.events).toHaveLength(1)
  expect(first.actor.getSnapshot().context.making.claudeProfileSetup).toBe(false)
})

it('shows the asking window a setup refusal without running a terminal command', async () => {
  const { actor, events } = windowActor()
  actor.send({ type: 'OPEN_CLAUDE_PROFILE_SETUP' })
  await latestAsk('PREPARE_CLAUDE_PROFILE_SETUP').refuse('Choose a project first')
  expect(events).toEqual([])
  expect(actor.getSnapshot().context.claudeProfileSetupError).toBe('Choose a project first')
  expect(actor.getSnapshot().context.making.claudeProfileSetup).toBe(false)
  actor.send({ type: 'DISMISS_CLAUDE_PROFILE_SETUP_ERROR' })
  expect(actor.getSnapshot().context.claudeProfileSetupError).toBeUndefined()
})
