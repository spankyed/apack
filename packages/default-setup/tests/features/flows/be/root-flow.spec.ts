import { featureSettings } from '#generated/settings.ts';
// The root flow is the flow with the root role, and only that: the flows list view names it, the flows system changes
// it (SET_ROOT_FLOW), imports and content imports bring it with their flows, and no setting records it
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileFlowDSL } from '@apackdev/sdk/build'
import { flowRepository } from '@apackdev/sdk/repositories'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'

/** Where `apack pack build` writes this pack's compiled content */
const DIST = path.resolve(import.meta.dirname, '../../../../dist', 'runtime', 'content')
const importRoot = (label: string) =>
  repository.flowsCommands.importFromDSL(compileFlowDSL({ [label]: { root: true, tracks: [{ event: 'flow.entry', exits: [[]] }] } })).flowIds[0]
type FlowsList = { flows: Array<{ id?: string }>; rootFlowId?: string }
/** The root flow the latest result of a window's flows list names */
const rootOf = (update: { ok: boolean; value?: unknown }) => (update.ok ? (update.value as FlowsList).rootFlowId : 'an error')

describe('the root flow', () => {
  it('is the flow with the root role, which the flows list view names, and no setting', async () => {
    const rootId = importRoot('Main')
    const app = await startApp({ systems: ['flows', 'host/settings'] })
    const list = app.watchView('flows', 'list')

    expect(rootOf(await list.next())).toBe(rootId)
    expect(featureSettings.forFeature('flows').get()).not.toHaveProperty('rootFlowId')
  })

  it('changes with SET_ROOT_FLOW, taking the role from the previous root, and null leaves none', async () => {
    const first = importRoot('First')
    const second = repository.flowsCommands.createFlow({ label: 'Second' }).id
    const app = await startApp({ systems: ['flows', 'host/settings'] })
    const list = app.watchView('flows', 'list')
    expect(rootOf(await list.next())).toBeDefined()

    await app.send('flows', { type: 'SET_ROOT_FLOW', flowId: second })
    expect(flowRepository.rootFlow()).toBe(second)
    expect(rootOf(await list.next())).toBe(second)
    expect(first).not.toBe(second)

    await app.send('flows', { type: 'SET_ROOT_FLOW', flowId: null })
    expect(flowRepository.rootFlow()).toBeUndefined()
    expect(rootOf(await list.next())).toBeUndefined()
  })

  it('reaches the list when a pack content import brought it', async () => {
    const app = await startApp({ systems: ['brain', 'flows', 'host/settings', 'host/packs'] })
    await app.connect()
    const list = app.watchView('flows', 'list')
    expect(rootOf(await list.next())).toBeUndefined()
    await app.send('host/packs', { type: 'IMPORT_PACK_CONTENT', directory: DIST, include: { flows: null, actions: null, prompts: null }, mode: 'replace-on-collision', restartBrain: false })
    await app.nextEmit('host/settings', 'PACK_CONTENT_IMPORTED')

    expect(flowRepository.rootFlow()).toBeDefined()
    await app.settle()
    expect(rootOf(list.updates.at(-1)!)).toBe(flowRepository.rootFlow())
  })
})
