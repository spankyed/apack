import { createToolActivityWriter } from '../../../../src/content/actions/claude-code/_helpers/tool-activity-writer.ts'
import { createThinkingWriter } from '../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts'
import type { Services, EntityId } from '#generated/services.ts'
import { ROW_INTERVAL_MS } from '../../../../src/content/actions/claude-code/_helpers/row-interval.ts'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => vi.useRealTimers())
function fixture() {
  const update = vi.fn()
  // `streamMessageBlockText` is the block's feed (G1): growth goes out through it and is not stored, so a
  // fixture about what reaches the row records the row's writes and lets the feed go nowhere.
  const services = { chat: { updateMessageState: update, streamMessageBlockText: vi.fn() } } as unknown as Services
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
      chat: {
        updateMessageState: (_id: unknown, updates: unknown) => { writes.push(JSON.stringify(updates)) },
        // The feed costs no write, which is the whole point of it; these cases count writes
        streamMessageBlockText: () => {},
      },
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

  /** A three-minute turn: thinking arriving every quarter second, with fifty tools appearing through it. */
  const TURN_MS = 180_000, DELTA_MS = 250, TOOL_COUNT = 50, GROWTH_PER_DELTA = 50

  async function aThreeMinuteTurn() {
    const fixture = turn()
    const ticks = TURN_MS / DELTA_MS
    const toolEvery = Math.floor(ticks / TOOL_COUNT)

    for (let tick = 0; tick < ticks; tick++) {
      fixture.thinking.push('x'.repeat(GROWTH_PER_DELTA))
      if (tick > 0 && tick % toolEvery === 0 && fixture.tools.entries.length < TOOL_COUNT) {
        const id = `tool-${fixture.tools.entries.length}`
        fixture.appendTool(id)
        fixture.tools.update(id, { status: 'ok' })
      }
      await vi.advanceTimersByTimeAsync(DELTA_MS)
    }
    fixture.thinking.finalise()
    fixture.tools.finalise('done')
    return { ...fixture, ticks }
  }

  it('writes a growing block no more often than its writers\' intervals allow', async () => {
    // The defect this pins: a flush writes the whole block, so writing growth on a quarter-second clock made
    // what reached storage quadratic in the length of the turn — a three-minute turn wrote 14MB to leave
    // 40KiB behind. The bound is derived from the declared interval and the turn's own discrete events
    // rather than chosen to fit: one write per interval per writer that owns a clock, one per tool
    // appearing, and the final one.
    const writersWithAClock = 2
    const { thinking, tools, writes, ticks } = await aThreeMinuteTurn()

    const allowed = writersWithAClock * Math.ceil(TURN_MS / ROW_INTERVAL_MS) + TOOL_COUNT + 2
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.length).toBeLessThanOrEqual(allowed)
    // The row still ends up holding the whole turn, which is what those writes were paying for.
    expect(thinking.buildBlock()?.props.content).toHaveLength(ticks * GROWTH_PER_DELTA)
    expect(tools.entries).toHaveLength(TOOL_COUNT)
  })

  it('writes a bounded multiple of what the turn leaves behind', async () => {
    // **The count above cannot catch the interval moving back**, because it derives its allowance from
    // `ROW_INTERVAL_MS`: lower the constant and `allowed` grows by exactly the factor the writes do, and the
    // case goes on passing while the defect returns. So this is the absolute half, and it is stated as the
    // thing the defect was about rather than as a number of writes — a flush carries the whole block, so
    // what reaches storage is a multiple of what the user is left with, and that multiple grows with the
    // length of the turn.
    //
    // Measured on this fixture: 2.9MB written to leave 36KB behind, which is 81x. At a quarter second it is
    // 15.6MB, so the interval bought 5.3x and this bound catches it going back — the count above does not.
    //
    // The multiple is still large, and the next reduction is not a slower clock: it is a feed and a row,
    // the split `createStreamWriter` already makes for text. Growth would go out as a delta nobody stores
    // and the durable write alone would carry the whole block. This ceiling is on the defect, so it holds
    // whatever the clock is set to.
    const AMPLIFICATION = 100
    const { thinking, writes } = await aThreeMinuteTurn()

    const written = writes.reduce((total, write) => total + write.length, 0)
    const kept = thinking.buildBlock()?.props.content.length ?? 0
    expect(kept).toBeGreaterThan(0)
    expect(written).toBeLessThanOrEqual(kept * AMPLIFICATION)
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
