import { createToolActivityWriter } from '../../../../src/content/actions/claude-code/_helpers/tool-activity-writer.ts'
import { createThinkingWriter } from '../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts'
import type { Services, EntityId } from '#generated/services.ts'
import { ROW_INTERVAL_MS } from '../../../../src/content/actions/claude-code/_helpers/row-interval.ts'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => vi.useRealTimers())
function fixture() {
  const update = vi.fn()
  const services = { chat: { updateMessageState: update } } as unknown as Services
  return { writer: createThinkingWriter(services, 'message-one' as EntityId), update, services }
}
it('retains thinking from a later model cycle and counts active thinking time rather than tool wait time', async () => {
  const { writer } = fixture()
  writer.push('First summary.'); await vi.advanceTimersByTimeAsync(1000); writer.finalise()
  await vi.advanceTimersByTimeAsync(10000)
  writer.push('Second summary.'); expect(writer.isStreaming).toBe(true)
  await vi.advanceTimersByTimeAsync(1000); writer.finalise()
  expect(writer.buildBlock()?.props).toMatchObject({ content: 'First summary.\n\nSecond summary.', state: 'done', label: 'Thought for 2.0s' })
})
it('publishes later thinking through the tool-activity owner without replacing its blocks', async () => {
  const { writer, update, services } = fixture()
  writer.push('First.'); writer.finalise(); update.mockClear()
  const activity = createToolActivityWriter(services, 'message-one' as EntityId, { getThinkingBlock: () => writer.buildBlock() })
  activity.append({ id: 'native-tool', tool: 'Bash', summary: 'Private fixture', status: 'running' })
  const owned = vi.fn(() => activity.flush())
  writer.stopDirectWrites(owned)
  writer.push('Second.'); await vi.advanceTimersByTimeAsync(ROW_INTERVAL_MS)
  expect(owned).toHaveBeenCalledOnce()
  expect(update).toHaveBeenLastCalledWith('message-one', { blocks: [expect.objectContaining({ props: expect.objectContaining({ content: 'First.\n\nSecond.', state: 'streaming' }) }), expect.objectContaining({ type: 'tool-activity', props: expect.objectContaining({ entries: [expect.objectContaining({ id: 'native-tool', status: 'running' })] }) })] })
  writer.finalise(); activity.finalise('done'); const completed = owned.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000); expect(owned).toHaveBeenCalledTimes(completed)
})

it('captures eligible native summary ranges and heals partial or completed-only text without exposing signatures', () => {
  const { writer } = fixture(), signature = 'Eg0KC0IJbmFycmF0aW9u'
  writer.push('First')
  writer.acceptNativeMessage({ uuid: 'summary-a', sessionId: 'session', apiMessageId: 'reply-a', text: 'First summary.', signature })
  writer.finalise()
  writer.acceptNativeMessage({ uuid: 'ordinary-b', sessionId: 'session', apiMessageId: 'reply-b', text: 'Ordinary thinking.', signature: 'not-a-narration-signature' })
  const block = writer.buildBlock()!
  expect(block.props.content).toBe('First summary.\n\nOrdinary thinking.')
  expect(block.props.nativeMessages).toEqual([
    { uuid: 'summary-a', sessionId: 'session', apiMessageId: 'reply-a', text: 'First summary.', start: 0, end: 14, isSummary: true },
    { uuid: 'ordinary-b', sessionId: 'session', apiMessageId: 'reply-b', text: 'Ordinary thinking.', start: 16, end: 34 },
  ])
  expect(JSON.stringify(block)).not.toContain(signature)
  writer.acceptNativeMessage({ uuid: 'summary-a', sessionId: 'session', text: 'First summary.', signature: 'changed' })
  expect(writer.buildBlock()?.props.nativeMessages?.[0].isSummary).toBe(true)
  writer.finalise()
})

it('does not grant summary identity to whitespace-only thinking or nested activity', () => {
  const { writer, update } = fixture(), signature = 'Eg0KC0IJbmFycmF0aW9u'
  writer.acceptNativeMessage({ uuid: 'child', sessionId: 'session', text: 'Child summary', signature, parentToolUseId: 'agent-tool' })
  expect(writer.buildBlock()).toBeNull(); expect(update).not.toHaveBeenCalled()
  writer.acceptNativeMessage({ uuid: 'empty', sessionId: 'session', text: '  ', signature })
  expect(writer.buildBlock()?.props.nativeMessages?.[0].isSummary).toBeUndefined()
  writer.finalise()
})

describe('what a turn writes to the message row', () => {
  /**
   * Both writers wired the way a turn wires them: the thinking block writes the row itself until tool
   * activity starts, and from then on rides along in the tool-activity writer's writes. That handover is
   * what makes the two payloads one, so a fixture without it measures neither writer's real cost.
   */
  function turn() {
    const writes: string[] = []
    const services = {
      chat: { updateMessageState: (_id: unknown, updates: unknown) => { writes.push(JSON.stringify(updates)) } },
    } as unknown as Services
    const thinking = createThinkingWriter(services, 'message-one' as EntityId)
    const tools = createToolActivityWriter(services, 'message-one' as EntityId, {
      getThinkingBlock: () => thinking.buildBlock(),
    })
    let handedOver = false
    const appendTool = (id: string) => {
      tools.append({ id, tool: 'Bash', summary: 'Fixture', status: 'running' })
      if (!handedOver) { handedOver = true; thinking.stopDirectWrites(() => tools.flush()) }
    }
    return { thinking, tools, writes, appendTool }
  }

  it('writes a growing block no more often than its writers\' intervals allow', async () => {
    // The defect this pins: a flush writes the whole block, so writing growth on a quarter-second clock made
    // what reached storage quadratic in the length of the turn — a three-minute turn wrote 14MB to leave
    // 40KiB behind. The bound is derived from the declared interval and the turn's own discrete events
    // rather than chosen to fit: one write per interval per writer that owns a clock, one per tool
    // appearing, and the final one.
    const turnMs = 180_000, deltaMs = 250, toolCount = 50, writersWithAClock = 2
    const { thinking, tools, writes, appendTool } = turn()
    const ticks = turnMs / deltaMs
    const toolEvery = Math.floor(ticks / toolCount)

    for (let tick = 0; tick < ticks; tick++) {
      thinking.push('x'.repeat(50))
      if (tick > 0 && tick % toolEvery === 0 && tools.entries.length < toolCount) {
        const id = `tool-${tools.entries.length}`
        appendTool(id)
        tools.update(id, { status: 'ok' })
      }
      await vi.advanceTimersByTimeAsync(deltaMs)
    }
    thinking.finalise()
    tools.finalise('done')

    const allowed = writersWithAClock * Math.ceil(turnMs / ROW_INTERVAL_MS) + toolCount + 2
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.length).toBeLessThanOrEqual(allowed)
    // The row still ends up holding the whole turn, which is what those writes were paying for.
    expect(thinking.buildBlock()?.props.content).toHaveLength(ticks * 50)
    expect(tools.entries).toHaveLength(toolCount)
  })

  it('writes a tool appearing straight away, and a patch to one on the row interval', async () => {
    // The discrete half of the split: what the user is waiting to see does not queue behind the interval.
    const { tools, writes, appendTool } = turn()

    appendTool('first')
    expect(writes).toHaveLength(1)

    tools.update('first', { status: 'ok' })
    expect(writes).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(ROW_INTERVAL_MS)
    expect(writes).toHaveLength(2)
  })

  it('writes nothing when the block it would write is the one already in the row', async () => {
    // After the handover both writers' clocks reach the same row, so they can land on identical content —
    // and a patch that moved nothing visible does too. Such a write costs the whole payload for nothing.
    const { thinking, tools, writes, appendTool } = turn()
    thinking.push('Thinking about it.')
    appendTool('first')
    const written = writes.length

    tools.flush()
    tools.flush()
    await vi.advanceTimersByTimeAsync(ROW_INTERVAL_MS * 2)

    expect(writes).toHaveLength(written)
  })

  it('writes the finished block as soon as the turn ends, not on the next interval', async () => {
    // The row a window falls back to when the message is marked complete has to be the finished one, so
    // reaching a final state is a discrete change however long the interval is.
    const { thinking, tools, writes, appendTool } = turn()
    thinking.push('Thinking about it.')
    appendTool('first')
    const written = writes.length

    thinking.finalise()
    tools.finalise('done')

    expect(writes.length).toBeGreaterThan(written)
    expect(writes.at(-1)).toContain('"state":"done"')
  })
})
