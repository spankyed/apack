import { PassThrough } from 'node:stream'
import { createClaudeConversation, type ClaudeConversationTurn } from '#features/code/be/services/claude-code/conversation.ts'
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts'
import type { StreamLine } from '#features/code/be/services/claude-code/types.ts'

function fixture() {
  const events = new PassThrough({ objectMode: true })
  let sequence = 0
  const native = {
    events: events as AsyncIterable<StreamLine>,
    send: vi.fn(() => `input-${++sequence}`),
    close: vi.fn(async () => { events.end() }),
    kill: vi.fn(() => { events.end() }),
    hasPendingBackgroundTasks: vi.fn(() => false),
  } as unknown as QueryHandle
  return { native, push: (event: unknown) => events.write(event), end: () => events.end() }
}
const started = (id: string) => ({ type: 'command_lifecycle', state: 'started', command_uuid: id })
const result = (cost: number, id?: string) => ({ type: 'result', subtype: 'success', total_cost_usd: cost, session_id: 'native-session', ...(id ? { user_message_uuid: id } : {}) })

describe('persistent Claude conversation owner', () => {
  it('keeps one process across host turns and autonomous output, with independent cost baselines', async () => {
    const f = fixture()
    const turns: ClaudeConversationTurn[] = []
    const seen: StreamLine[][] = []
    const consume = async (turn: ClaudeConversationTurn) => {
      turns.push(turn)
      const lines: StreamLine[] = []
      for await (const event of turn.handle.events) lines.push(event)
      seen.push(lines)
      owner.release(turn.handle)
    }
    const owner = createClaudeConversation(f.native, consume)
    const observing = vi.fn()
    const unsubscribe = owner.subscribe(observing)
    const first = owner.start('first', consume)
    expect(owner.busy).toBe(true)
    expect(turns).toEqual([])
    f.push(started(first)); f.push(result(1, first))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    expect(f.native.close).not.toHaveBeenCalled()
    const second = owner.start('second', consume)
    f.push(started(second)); f.push(result(2, second))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    f.push({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' })
    await vi.waitFor(() => expect(observing).toHaveBeenCalledWith(expect.objectContaining({ subtype: 'ui_invalidate' })))
    expect(turns).toHaveLength(2)
    f.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'autonomous' }] } }); f.push(result(3))
    await vi.waitFor(() => expect(turns).toHaveLength(3))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    expect(turns.map(turn => turn.costBaseline)).toEqual([0, 1, 2])
    expect(turns.map(turn => turn.inputId)).toEqual([first, second, undefined])
    expect(seen.map(lines => lines.filter(line => line.type === 'result').length)).toEqual([1, 1, 1])
    unsubscribe()
    await owner.close()
    expect(f.native.close).toHaveBeenCalledOnce()
  })

  it('does not assign autonomous work to a host input awaiting native acceptance', async () => {
    const f = fixture()
    const ordered: Array<{ id?: string; baseline: number }> = []
    const consume = async (turn: ClaudeConversationTurn) => {
      ordered.push({ id: turn.inputId, baseline: turn.costBaseline })
      for await (const _event of turn.handle.events) { /* drain */ }
      owner.release(turn.handle)
    }
    const owner = createClaudeConversation(f.native, consume)
    const id = owner.start('queued host input', consume)
    f.push({ type: 'assistant', message: { content: [] } }); f.push(result(1))
    await vi.waitFor(() => expect(ordered).toHaveLength(1))
    expect(owner.busy).toBe(true)
    expect(ordered[0]?.id).toBeUndefined()
    f.push(started(id)); f.push(result(2, id))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    expect(ordered).toEqual([{ id: undefined, baseline: 0 }, { id, baseline: 1 }])
    await owner.close()
  })

  it('refuses a second submission while busy and rejects a foreign result before it reaches the consumer', async () => {
    const f = fixture()
    const received: StreamLine[] = []
    const failure = vi.fn()
    const owner = createClaudeConversation(f.native, async () => {})
    const id = owner.start('host input', async turn => {
      try { for await (const event of turn.handle.events) received.push(event) } catch (error) { failure(error) }
    })
    expect(() => owner.start('overlap', async () => {})).toThrow('active input')
    f.push(started(id)); f.push(result(1, 'foreign-input'))
    await expect(owner.done).rejects.toThrow('different input')
    expect(received.some(event => event.type === 'result')).toBe(false)
    expect(failure).toHaveBeenCalledOnce()
    expect(f.native.kill).toHaveBeenCalled()
  })

  it('settles a submitted input when the process exits before native started acknowledgement', async () => {
    const f = fixture()
    const failed = vi.fn()
    const owner = createClaudeConversation(f.native, async () => {})
    owner.start('pending', async turn => {
      await expect(turn.handle.result).rejects.toThrow('exited before')
      try { for await (const _event of turn.handle.events) { /* drain */ } } catch (error) { failed(error) }
    })
    f.end()
    await owner.done
    expect(failed).toHaveBeenCalledOnce()
    expect(() => owner.start('after exit', async () => {})).toThrow('closed')
  })
  it('marks a submitted turn stopped when explicit teardown wins before the consumer starts', async () => {
    const f = fixture()
    const consumed = vi.fn(async (turn: ClaudeConversationTurn) => { expect(turn.stopped).toBe(true) })
    const owner = createClaudeConversation(f.native, async () => {})
    owner.start('pending input', consumed)
    owner.kill()
    await owner.done
    expect(consumed).toHaveBeenCalledOnce()
  })

  it('rejects both scoped events and result when a live turn is released before completion', async () => {
    const f = fixture()
    let turn!: ClaudeConversationTurn
    const failed = vi.fn()
    const owner = createClaudeConversation(f.native, async () => {})
    const id = owner.start('active input', async current => {
      turn = current
      try { for await (const _event of current.handle.events) { /* drain */ } } catch (error) { failed(error) }
    })
    f.push(started(id))
    await vi.waitFor(() => expect(turn).toBeDefined())
    const rejected = expect(turn.handle.result).rejects.toThrow('stopped before completion')
    expect(owner.release(turn.handle)).toBe(true)
    await rejected
    await owner.done
    expect(failed).toHaveBeenCalledOnce()
    expect(turn.stopped).toBe(true)
  })

})
