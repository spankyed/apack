// The flows views and the answers to the editor's writes, two windows at once. Each window's graph subscription is
// its own, so an edit reaches the windows showing that flow and no other; the flows list reaches every window; and
// every write is answered to the window that made it — what it made, that it landed, or why it was refused — since
// the editor holds its graph behind its own unanswered writes.
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import type { EARS } from '#generated/ears.ts'

const FLOWS = 'default-setup/flows'
type Graph = { nodes: Array<{ id: string; label?: string }>; edges: Array<{ id: string }> }
const labels = (update: { ok: boolean; value?: unknown }) => (update.ok ? (update.value as Graph | null)?.nodes.map(node => node.label) : 'an error')

const flowWithEntry = (label: string) => repository.flowsCommands.createFlowWithEntryNode({ label })

describe('the flows views', () => {
  it("reach each window with its own open flow's edits, and leave the other window's alone", async () => {
    const first = flowWithEntry('First')
    const second = flowWithEntry('Second')
    const app = await startApp({ systems: ['flows'] })
    const one = app.watchView('flows', 'graph', { flowId: first.flow.id })
    const other = app.watchView('flows', 'graph', { flowId: second.flow.id })
    expect(labels(await one.next())).toEqual(['Flow Entry'])
    expect(labels(await other.next())).toEqual(['Flow Entry'])

    await app.send('flows', { type: 'UPDATE_NODE', flowId: second.flow.id, nodeId: second.entryNode.id, nodeData: { label: 'Renamed' } })
    expect(labels(await other.next())).toEqual(['Renamed'])
    await app.settle()
    expect(one.updates, 'the other window heard nothing').toHaveLength(1)
  })

  it('end a deleted flow\'s graph with null, and drop it from every list', async () => {
    const { flow } = flowWithEntry('Doomed')
    const app = await startApp({ systems: ['flows'] })
    const graph = app.watchView('flows', 'graph', { flowId: flow.id })
    const list = app.watchView<{ flows: Array<{ id: string }> }>('flows', 'list')
    await graph.next()
    expect((await list.next()).ok).toBe(true)

    await app.send('flows', { type: 'DELETE_FLOW', flowId: flow.id })
    expect(await graph.next()).toMatchObject({ ok: true, value: null })
    const after = await list.next()
    expect(after.ok && after.value.flows.map(each => each.id)).not.toContain(flow.id)
  })
})

describe('a write to a flow', () => {
  const asked = { sender: FLOWS, client: 'c-main' }

  it('answers the window that created a flow with it, and every list has it', async () => {
    const app = await startApp({ systems: ['flows'] })
    await app.connect()
    const list = app.watchView<{ flows: Array<{ id: string }> }>('flows', 'list')
    await list.next()

    const call = await app.send('flows', { type: 'CREATE_FLOW' }, asked)
    const opened = await app.nextEmit('flows', 'FLOW_OPENED', { answering: call }) as unknown as { flowId: EARS.EntityId }
    const listed = await list.next()
    expect(listed.ok && listed.value.flows.map(each => each.id)).toContain(opened.flowId)
  })

  it('opens nothing when nobody asked, and still lists the flow', async () => {
    const app = await startApp({ systems: ['flows'] })
    await app.connect()
    const list = app.watchView<{ flows: Array<{ id: string }> }>('flows', 'list')
    await list.next()

    await app.send('flows', { type: 'CREATE_FLOW' })
    const listed = await list.next()
    expect(listed.ok && listed.value.flows).toHaveLength(1)
    expect(app.emitted('flows').filter(event => event.type === 'FLOW_OPENED'), 'nobody to answer').toEqual([])
  })

  it('answers each graph write, a landed one and a refused one alike', async () => {
    const { flow, entryNode } = flowWithEntry('Wired')
    const app = await startApp({ systems: ['flows'] })
    await app.connect()

    const created = await app.send('flows', { type: 'CREATE_NODE', flowId: flow.id, tempId: 'temp-1', nodeData: { nodeType: 'transform', label: 'Step' } }, asked)
    const node = await app.nextEmit('flows', 'NODE_CREATED', { answering: created }) as unknown as { tempId: string; nodeId: EARS.EntityId }
    expect(node.tempId).toBe('temp-1')

    const updated = await app.send('flows', { type: 'UPDATE_NODE', flowId: flow.id, nodeId: node.nodeId, nodeData: { label: 'Step, renamed' } }, asked)
    await app.nextEmit('flows', 'FLOW_WRITTEN', { answering: updated })

    // An edge from a node that doesn't exist is refused, and the refusal says why
    const refused = await app.send('flows', { type: 'CREATE_EDGE', flowId: flow.id, sourceId: 'Node-missing', targetId: entryNode.id }, asked)
    expect(await app.nextEmit('flows', 'FLOW_WRITE_FAILED', { answering: refused })).toMatchObject({ error: expect.any(String) })
  })

  it('sends the model catalog when asked to publish, and no rows', async () => {
    flowWithEntry('Any')
    const app = await startApp({ systems: ['flows'] })
    await app.connect()
    const connected = await app.nextEmit('flows', 'FLOWS_CONNECTED') as unknown as { data: Record<string, unknown> }
    expect(Object.keys(connected.data)).toEqual(['models'])
    expect((connected.data.models as unknown[]).length).toBeGreaterThan(0)
  })
})
