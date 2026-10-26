import { featureSettings } from '#generated/settings.ts';
// Flows on the brain through @apackdev/testing, run as the app runs them: the brain starts the root flow (root: true)
// and the subflows it spawns, runFlow sends an event and waits for one flow's tracks. Also waiting steps, schedule
// ticks through the scheduler service, the steps a flow ran, and how the brain starts.
import { describe, expect, it, vi } from 'vitest'
import { importFlows, mockService, startApp, takeSystemErrors, type TestApp } from '@apackdev/testing/harness'
import { action, entry, on, keepAlive, schedule, subflow, transform } from '#generated/flow-helpers.ts'
import { repository } from '#generated/repository.ts'
import { services, type Services } from '#generated/services.ts'
import { isBrainPaused } from '#features/brain/be/utils/brain-pause.ts'

const step = (label: string) => transform('return true', { label })
const startBrain = () => startApp({ systems: ['brain'] })

describe('runFlow', () => {
  it("returns the root flow's entry tracks, finishing a track whose other step waits by design (keep-alive)", async () => {
    importFlows({ 'Long Running': { root: true, tracks: [entry([step('setup'), step('ready')], [keepAlive('stay')])] } })
    const app = await startBrain()

    const run = await app.runFlow('Long Running')

    expect(run.steps.map((s) => [s.label, s.status])).toEqual([['setup', 'completed'], ['stay', 'active'], ['ready', 'completed']])
  })

  it('runs every step of the track an event triggers, in order', async () => {
    importFlows({ Chain: { root: true, tracks: [on('go', [[step('first'), step('second'), step('third')]])] } })
    const app = await startBrain()

    const run = await app.runFlow('Chain', { event: 'go' })

    expect(run.steps.map((s) => [s.label, s.status])).toEqual([['first', 'completed'], ['second', 'completed'], ['third', 'completed']])
    expect(app.flowSteps('Chain').map((s) => s.label)).toEqual(['first', 'second', 'third'])
  })

  it('runs an event through a subflow the root flow spawned, as the app runs its work modes', async () => {
    importFlows({
      'Root Flow': { root: true, tracks: [entry([subflow('Listener')], [keepAlive()])] },
      Listener: { tracks: [entry([keepAlive('listening')]), on('ping', [[step('pong')]])] },
    })
    const app = await startBrain()

    expect((await app.runFlow('Listener')).steps.map((s) => [s.label, s.status])).toEqual([['listening', 'active']])
    const run = await app.runFlow('Listener', { event: 'ping' })

    expect(run.steps.map((s) => [s.label, s.status])).toEqual([['pong', 'completed']])
    expect(app.flowSteps('Listener').map((s) => s.label)).toEqual(['listening', 'pong'])
  })

  it('runs a flow imported earlier as a subflow of a root flow imported after it, as a pack test hosts its flows', async () => {
    importFlows({ Listener: { tracks: [entry([keepAlive()]), on('ping', [[step('pong')]])] } })
    importFlows({ 'Root Flow': { root: true, tracks: [entry([subflow('Listener')], [keepAlive()])] } })
    const app = await startBrain()

    expect((await app.runFlow('Listener', { event: 'ping' })).steps.map((s) => [s.label, s.status])).toEqual([['pong', 'completed']])
  })

  it("lists a subflow's steps under the flow's label, not the subflow step's", async () => {
    importFlows({
      Outer: { root: true, tracks: [on('go', [[subflow('Inner', { label: 'run inner' })]])] },
      Inner: [entry([step('i1'), step('i2')])],
    })
    const app = await startBrain()

    await app.runFlow('Outer', { event: 'go' })

    expect(app.flowSteps('Inner').map((s) => s.label)).toEqual(['i1', 'i2'])
    expect(app.flowSteps('run inner')).toEqual([])
    await expect(app.runFlow('Inner', { event: 'go' })).rejects.toThrow(/Flow "Inner" isn't running/)
  })

  it('waits for steps an action step starts after it completes, however long they take', async () => {
    // A step with a runtime handler reports completion before its flow starts the next step
    repository.actionCommands.create({ label: 'Fast', actionFn: 'return { fast: true }' })
    repository.actionCommands.create({ label: 'Slow', actionFn: 'await new Promise((resolve) => setTimeout(resolve, 30)); return { slow: true }' })
    importFlows({ Chain: { root: true, tracks: [on('go', [[action('Fast', { label: 'fast' }), action('Slow', { label: 'slow' }), step('last')]])] } })
    const app = await startBrain()

    const run = await app.runFlow('Chain', { event: 'go' })

    expect(run.steps.map((s) => [s.label, s.status])).toEqual([['fast', 'completed'], ['slow', 'completed'], ['last', 'completed']])
  })

  it('waits for slow steps beside a step that waits by design', async () => {
    repository.actionCommands.create({ label: 'Slow', actionFn: 'await new Promise((resolve) => setTimeout(resolve, 30)); return { slow: true }' })
    importFlows({ 'Long Running': { root: true, tracks: [entry([keepAlive('stay')], [action('Slow', { label: 'first' }), action('Slow', { label: 'second' })])] } })
    const app = await startBrain()

    const run = await app.runFlow('Long Running')

    expect(run.steps.map((s) => [s.label, s.status]).sort()).toEqual([['first', 'completed'], ['second', 'completed'], ['stay', 'active']])
  })

  it('keeps to its timeout while the systems stay busy', async () => {
    importFlows({ Chain: { root: true, tracks: [on('go', [[step('first')]])] } })
    const app = await startBrain()
    await app.connect()
    const busy = setInterval(() => app.system('brain').send({ type: 'TOGGLE_INSPECT' }), 1)
    const started = Date.now()
    try {
      await expect(app.runFlow('Chain', { event: 'go', timeoutMs: 100 })).rejects.toThrow('didn\'t finish "go" within 100ms')
    } finally {
      clearInterval(busy)
    }
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('fails naming what it needs: the flow, a running flow, a track for the event, the brain', async () => {
    importFlows({
      Chain: { root: true, tracks: [on('go', [[step('first')]])] },
      Unhosted: [on('go', [[step('never')]])],
    })
    const app = await startBrain()

    await expect(app.runFlow('Missing')).rejects.toThrow(/No flow "Missing"/)
    await expect(app.runFlow('Unhosted', { event: 'go' })).rejects.toThrow(
      'Flow "Unhosted" isn\'t running: the brain runs the root flow (root: true) and the subflows running flows spawn: make it one of those, and import flows before startApp. Running: Chain',
    )
    await expect(app.runFlow('Chain', { event: 'stop' })).rejects.toThrow('Flow "Chain" has no track for "stop"')
    const withoutBrain = await startApp({ systems: [] })
    await expect(withoutBrain.runFlow('Chain', { event: 'go' })).rejects.toThrow('start the app with the brain system')
  })
})

describe('brain start', () => {
  const brainState = (app: TestApp) => {
    const snapshot = app.system('brain').getSnapshot() as { matches(state: string): boolean; context: { brainActor?: unknown } }
    return { running: snapshot.matches('running'), hasActor: snapshot.context.brainActor !== undefined }
  }
  /** A root flow's tracks that keep it running, as the app's root flow does */
  const staysRunning = [entry([keepAlive()])]

  it('runs the root flow when it starts', async () => {
    importFlows({ 'Root Flow': { root: true, tracks: staysRunning } })
    const app = await startBrain()

    expect(brainState(app)).toEqual({ running: true, hasActor: true })
    expect((await app.runFlow('Root Flow')).steps.map((s) => s.status)).toEqual(['active'])
  })

  // The brain answers this itself; it used to be told, by the database feature reaching across to kill a
  // system it does not own — so the kill was missing from every other way the data could be replaced
  it('stops when the rows its flow is running over are replaced', async () => {
    importFlows({ 'Root Flow': { root: true, tracks: staysRunning } })
    const app = await startBrain()
    expect(brainState(app)).toEqual({ running: true, hasActor: true })

    await app.send('brain', { type: 'DATA_REPLACED' })

    expect(brainState(app), 'it stops, and does not restart itself').toEqual({ running: false, hasActor: false })
  })

  it('stops with no flow to run, and starts from START_BRAIN once a root flow exists', async () => {
    const app = await startBrain()
    expect(brainState(app)).toEqual({ running: false, hasActor: false })
    await app.connect()
    expect(app.emitted('brain').filter((e) => e.type === 'BRAIN_STATE').at(-1), 'a stopped brain names no root flow').not.toHaveProperty('rootFlowId')

    importFlows({ 'Root Flow': { root: true, tracks: staysRunning } })
    await app.send('brain', { type: 'START_BRAIN' })

    expect(brainState(app)).toEqual({ running: true, hasActor: true })
  })

  it('reports an error and stays stopped when flows exist but none is the root flow, rather than running one', async () => {
    importFlows({ 'Root Flow': { tracks: staysRunning } })

    const app = await startBrain()
    // Nothing receives a report before a client connects
    expect(takeSystemErrors()).toEqual([])
    await app.connect()

    expect(takeSystemErrors()).toEqual([expect.objectContaining({ source: 'brain', title: 'Could not start the brain', message: expect.stringContaining('No flow has the root role (1 flows exist)') })])
    expect(repository.flowsQueries.rootFlow()).toBeUndefined()
    expect(brainState(app)).toEqual({ running: false, hasActor: false })
  })

  it("reports why it could not start once, and sends it in each client's startup data while it stays stopped, until a root flow exists", async () => {
    const couldNotStart = [expect.objectContaining({ source: 'brain', title: 'Could not start the brain', message: expect.stringContaining('No flow has the root role') })]
    const startErrors = () => app.emitted('brain').flatMap((e) => (e.type === 'BRAIN_STATE' ? [e.startError] : []))
    importFlows({ 'Root Flow': { tracks: staysRunning } })
    const app = await startBrain()

    await app.connect()
    await app.connect()
    await app.connect()
    expect(takeSystemErrors()).toEqual(couldNotStart)
    expect(startErrors()).toEqual(Array(3).fill(expect.stringContaining('No flow has the root role')))

    // A failed start while a client is connected is reported right away, once
    await app.send('brain', { type: 'START_BRAIN' })
    expect(takeSystemErrors()).toEqual(couldNotStart)
    await app.connect()
    expect(takeSystemErrors()).toEqual([])

    const [flow] = repository.flowsQueries.list().flows
    repository.flowsCommands.grantRootFlowRole(flow.id!)
    await app.connect()
    expect(takeSystemErrors()).toEqual([])
    expect(startErrors().at(-1)).toBeUndefined()
  })

  it('stops, clearing the running root flow, when restarted after the root role is revoked', async () => {
    importFlows({ 'Root Flow': { root: true, tracks: staysRunning } })
    const app = await startBrain()
    const rootFlowId = repository.flowsQueries.rootFlow()!
    const runningRootFlow = () => (app.system('brain').getSnapshot().context as { runningRootFlowId?: string }).runningRootFlowId
    expect(runningRootFlow()).toBe(rootFlowId)

    await app.connect()
    // The surface learns which root flow the brain runs from the brain, not from the settings
    expect(await app.nextEmit('brain', 'BRAIN_STATE')).toMatchObject({ rootFlowId })
    expect(featureSettings.forFeature('brain').get()).not.toHaveProperty('runningRootFlowId')
    repository.flowsCommands.revokeRootFlowRole(rootFlowId)
    await app.send('brain', { type: 'RESTART_BRAIN' })

    expect(takeSystemErrors()).toEqual([expect.objectContaining({ source: 'brain', title: 'Could not start the brain' })])
    expect(brainState(app)).toEqual({ running: false, hasActor: false })
    expect(runningRootFlow()).toBeUndefined()
  })

  it("doesn't carry a pause into a later start", async () => {
    importFlows({ 'Root Flow': { root: true, tracks: staysRunning } })
    const paused = await startBrain()
    await paused.connect()
    await paused.send('brain', { type: 'PAUSE_BRAIN' })
    expect(isBrainPaused()).toBe(true)
    paused.stop()

    await startBrain()

    expect(isBrainPaused()).toBe(false)
  })
})

describe('schedule triggers', () => {
  it('run on the ticks the scheduler service fires', async () => {
    const ticks = new Map<string, () => void>()
    // The schedule trigger loads its runtime before registering: resolved when the scheduler gets the job
    let registered!: () => void
    const scheduled = new Promise<void>((resolve) => { registered = resolve })
    mockService<Services, 'scheduler'>('scheduler', {
      registerSchedule: vi.fn((key: string, _cron: string, tick: () => void) => { ticks.set(key, tick); registered() }),
      unregisterByPrefix: vi.fn(),
      clearAllSchedules: vi.fn(),
    })
    importFlows({ Nightly: { root: true, tracks: [schedule('0 3 * * *', [[step('cleanup')]])] } })
    const app = await startBrain()
    // A tick reaches the brain through the bus, which routes events once a client is connected
    await app.connect()
    await scheduled

    // Keyed by the flow run that registered it: the session's root run
    const root = services.runHistory.findRuns().find((run) => run.parentId === undefined && run.status === 'active')
    expect(root).toBeDefined()
    expect([...ticks.keys()]).toEqual([expect.stringMatching(new RegExp(`^${root!.id}:`))])
    expect(app.flowSteps('Nightly')).toEqual([])

    for (const tick of ticks.values()) tick()
    await app.settle()
    expect(app.flowSteps('Nightly').map((s) => [s.label, s.status])).toEqual([['cleanup', 'completed']])
  })
})
