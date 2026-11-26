import { createHostControls } from '#features/code/be/services/claude-code/host-controls.ts'

function fixture() {
  const writes: Array<{ request_id: string }> = []
  const channel = createHostControls(value => { writes.push(value as { request_id: string }); return true })
  return { channel, writes, reply(index: number, payload: unknown) {
    channel.receive({ type: 'control_response', response: {
      subtype: 'success', request_id: writes[index]!.request_id, response: payload,
    } })
  } }
}

describe('host control lifecycle', () => {
  afterEach(() => vi.useRealTimers())

  it('correlates out-of-order replies and ignores late duplicate responses', async () => {
    const { channel, writes, reply } = fixture()
    const context = channel.request({ subtype: 'get_context_usage' })
    const settings = channel.request({ subtype: 'get_settings' })
    expect(writes[0]!.request_id).not.toBe(writes[1]!.request_id)
    reply(1, { effective: {} })
    reply(0, { totalTokens: 42 })
    reply(0, { totalTokens: 99 })
    await expect(settings).resolves.toEqual({ effective: {} })
    await expect(context).resolves.toEqual({ totalTokens: 42 })
    channel.close()
  })

  it('rejects provider errors and all outstanding requests on channel close', async () => {
    const { channel, writes } = fixture()
    const rejected = channel.request({ subtype: 'background_tasks' })
    const rejectedAssertion = expect(rejected).rejects.toThrow('Background tasks disabled')
    channel.receive({ response: { subtype: 'error', request_id: writes[0]!.request_id, error: 'Background tasks disabled' } })
    await rejectedAssertion
    const pending = channel.request({ subtype: 'get_settings' })
    const pendingAssertion = expect(pending).rejects.toThrow('process exited')
    channel.close(new Error('process exited'))
    await pendingAssertion
    await expect(channel.request({ subtype: 'get_status' })).rejects.toThrow('process exited')
  })

  it('expires a missing reply without rejecting a subsequent request', async () => {
    vi.useFakeTimers()
    const { channel, reply } = fixture()
    const pending = channel.request({ subtype: 'get_status' }, 100)
    const assertion = expect(pending).rejects.toThrow('timed out after 100ms')
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    const next = channel.request({ subtype: 'get_settings' })
    reply(0, { stale: true })
    reply(1, { effective: {} })
    await expect(next).resolves.toEqual({ effective: {} })
    channel.close()
  })

  it('rejects a failed transport write without leaving a pending timer', async () => {
    vi.useFakeTimers()
    const channel = createHostControls(() => false)
    await expect(channel.request({ subtype: 'initialize' })).rejects.toThrow('could not send')
    expect(vi.getTimerCount()).toBe(0)
    channel.close()
  })
})
