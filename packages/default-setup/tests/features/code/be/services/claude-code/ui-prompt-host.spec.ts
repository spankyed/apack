import { type ClaudePromptHostFill, createClaudePromptHosts } from '#features/code/be/services/claude-code/ui-prompt-host.ts'
const read = (id = 'read', client = 'view') => ({ type: 'control_request' as const, request_id: id, request: { subtype: 'ui_prompt_read', surface: 'desktop', client_id: client } })
const fill = (id = 'fill') => ({ ...read(id), request: { ...read().request, subtype: 'ui_prompt_fill', mode: 'insert', text: 'native' } })
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function fixture() {
  const write = vi.fn((_value: unknown) => true), hosts = createClaudePromptHosts(write)
  const host = { read: vi.fn(async (_signal: AbortSignal) => ({ text: 'draft 👋', cursor: 8 })), fill: vi.fn(async (_input: ClaudePromptHostFill, _signal: AbortSignal) => true) }
  const detach = hosts.register('view', host)
  return { write, hosts, host, detach, answer: () => write.mock.calls.at(-1)?.[0] }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('correlates read and fill once, preserving UTF-16 cursor, mode and decoration data', async () => {
  const f = fixture()
  expect(f.hosts.receive(read())).toBe(true); await flush()
  expect(f.answer()).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'read', response: { text: 'draft 👋', cursor: 8 } } })
  const request = fill(); Object.assign(request.request, { decorations: [{ start: 0, end: 6, bold: true }] })
  f.hosts.receive(request); f.hosts.receive(request); await flush()
  expect(f.host.fill).toHaveBeenCalledOnce()
  expect(f.host.fill).toHaveBeenCalledWith({ text: 'native', mode: 'insert', decorations: [{ start: 0, end: 6, bold: true }] }, expect.any(AbortSignal))
  expect(f.answer()).toMatchObject({ response: { request_id: 'fill', response: { filled: true } } })
  expect(f.hosts.receive({ ...read(), request: { subtype: 'can_use_tool' } })).toBe(false)
  f.hosts.close()
})

it('refuses unknown clients and malformed fills without invoking a composer', async () => {
  const f = fixture()
  f.hosts.receive(read('foreign', 'other'))
  f.hosts.receive({ ...fill(), request: { ...fill().request, decorations: [{ start: 0, end: 99 }] } })
  await flush(); expect(f.host.read).not.toHaveBeenCalled(); expect(f.host.fill).not.toHaveBeenCalled()
  expect(f.write).toHaveBeenCalledTimes(2)
  expect(f.answer()).toMatchObject({ response: { response: { filled: false } } }); f.hosts.close()
})

it('validates host reads and falls back when the mounted editor refuses or fails', async () => {
  const f = fixture(); f.host.read.mockResolvedValueOnce({ text: 'x', cursor: 2 })
  f.hosts.receive(read()); await flush(); expect(f.answer()).toMatchObject({ response: { response: { text: '', cursor: 0 } } })
  f.host.fill.mockRejectedValueOnce(Error('unmounted')); f.hosts.receive(fill()); await flush()
  expect(f.answer()).toMatchObject({ response: { response: { filled: false } } }); f.hosts.close()
})

it('aborts timed-out work and ignores its late answer', async () => {
  const f = fixture(); let resolve!: (value: boolean) => void
  f.host.fill.mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
  f.hosts.receive(fill()); await flush()
  await vi.advanceTimersByTimeAsync(4000)
  expect(f.answer()).toMatchObject({ response: { response: { filled: false } } })
  expect(f.host.fill.mock.calls[0]?.[1].aborted).toBe(true)
  resolve(true); await flush(); expect(f.write).toHaveBeenCalledOnce(); f.hosts.close()
})

it('retires host work on detach and suppresses canceled/closed replies', async () => {
  const f = fixture(); f.hosts.receive(fill()); f.detach(); await flush()
  expect(f.host.fill).not.toHaveBeenCalled(); expect(f.answer()).toMatchObject({ response: { response: { filled: false } } })
  const detach = f.hosts.register('view', f.host)
  f.hosts.receive(read()); expect(f.hosts.cancel('read')).toBe(true); await flush()
  expect(f.host.read).not.toHaveBeenCalled(); expect(f.write).toHaveBeenCalledOnce()
  f.hosts.receive(read('closed')); f.hosts.close(); await flush()
  expect(f.host.read).not.toHaveBeenCalled(); expect(f.write).toHaveBeenCalledOnce(); detach()
})
