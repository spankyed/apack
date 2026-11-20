// Two things follow from a change in what a terminal's programs say they are doing (OSC 7501), neither of which
// is telling a window: the repository is checked when a turn ends, and a flow hears each state a record enters.
//
// Neither answers the program. A record naming a program other than the one in front is drawn as such and
// tells no flow, since a flow acts on what it hears.
import { describe, expect, it } from 'vitest'
import { importFlows, takeSystemErrors } from '@apackdev/testing/harness'
import { settles } from '@apackdev/sdk/testing'
import { fire, on } from '#generated/flow-helpers.ts'
import { aTerminal, record, running, sentToSystems, stopsAfterEach } from './_support/terminal-statuses.ts'

stopsAfterEach()

describe('what follows from a change', () => {
  const checks = (sent: Array<{ type: string }>) => sent.filter(event => event.type === 'CHECK_FOR_EXTERNAL_CHANGES').length
  const flowEvents = (sent: Array<{ type: string } & Record<string, unknown>>) =>
    sent.filter(event => event.type === 'TRIGGER_BRAIN_EVENT' && event.eventType === 'terminal.status').map(event => event.payload)

  it('checks the repository when a record leaves working, as a finished command does', async () => {
    const { broker, session } = await aTerminal()
    const starting = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [record()] })
    })
    expect(checks(starting), 'nothing has ended').toBe(0)

    const ending = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'done', changed: 2 })] })
    })
    expect(checks(ending)).toBe(1)

    // And when the record goes while it was working: the program exited
    broker.happens(session, { kind: 'programStatus', statuses: [record({ changed: 3 })] })
    const gone = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [] })
    })
    expect(checks(gone)).toBe(1)
  })

  it('tells a flow each state a record enters, with the state it left', async () => {
    const { broker, terminalId, session } = await aTerminal()
    const sent = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [record()] })
      broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'blocked', kind: 'permission', changed: 2 })] })
      // The same state again, with another figure, is not a state entered
      broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'blocked', kind: 'permission', progress: 50, changed: 3 })] })
    })
    expect(flowEvents(sent)).toEqual([
      { terminalId, id: '', app: 'codex', state: 'working', kind: null, previous: null },
      { terminalId, id: '', app: 'codex', state: 'blocked', kind: 'permission', previous: 'working' },
    ])
  })

  it('tells a flow nothing of a record naming a program other than the one in front', async () => {
    const { broker, session } = await aTerminal()
    const sent = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [
        record({ id: 'forged', state: 'blocked', kind: 'permission', confirmed: 'mismatched' }),
        record({ id: 'windows', state: 'blocked', kind: 'question', confirmed: 'unknown', changed: 2 }),
      ] })
    })
    expect(flowEvents(sent).map(payload => (payload as { id: string }).id), 'where nothing could be compared, it is told').toEqual(['windows'])
  })

  it('runs a flow that listens, and is no error where none does', async () => {
    importFlows({ Listens: { root: true, tracks: [on('terminal.status', [[fire('terminal.status.heard', { label: 'heard' })]])] } })
    const { broker, session } = await aTerminal(['code', 'brain'])
    broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'done' })] })
    await settles(() => expect(running.app!.flowSteps('Listens')).toContainEqual(expect.objectContaining({ label: 'heard', status: 'completed' })))
    expect(takeSystemErrors()).toEqual([])
  })

  it('is no error with no flow listening', async () => {
    importFlows({ Deaf: { root: true, tracks: [on('something.else', [[fire('never', { label: 'never' })]])] } })
    const { broker, session } = await aTerminal(['code', 'brain'])
    broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'done' })] })
    await running.app!.settle()
    expect(takeSystemErrors()).toEqual([])
    expect(running.app!.flowSteps('Deaf')).toEqual([])
  })
})
