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
  expect(f.host.fill).toHaveBeenCalledWith({ text: 'native', mode: 'insert', decorations: [{ start: 0, end: 6, bold: true }] }, expect.any(AbortSignal), expect.any(Number))
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


it('advertises suggestions only for an answering host and correlates shown/refused outcomes', async () => {
  const f = fixture(), suggesting = { ...read('suggest'), request: { ...read().request, subtype: 'ui_prompt_suggest', text: 'ghost' } }
  expect(f.hosts.answers('view')).toEqual(['ui_prompt_read', 'ui_prompt_fill'])
  f.hosts.receive(suggesting); await flush(); expect(f.answer()).toMatchObject({ response: { response: { shown: false } } })
  f.detach()
  const suggest = vi.fn(async () => true)
  f.hosts.register('view', { ...f.host, suggest })
  expect(f.hosts.answers('view')).toEqual(['ui_prompt_read', 'ui_prompt_fill', 'ui_prompt_suggest'])
  f.hosts.receive({ ...suggesting, request_id: 'supported' }); await flush()
  expect(suggest).toHaveBeenCalledWith('ghost', expect.any(AbortSignal), expect.any(Number))
  expect(f.answer()).toMatchObject({ response: { request_id: 'supported', response: { shown: true } } })
  f.hosts.receive({ ...suggesting, request_id: 'blank', request: { ...suggesting.request, text: '  ' } }); await flush()
  expect(suggest).toHaveBeenCalledOnce(); expect(f.answer()).toMatchObject({ response: { response: { shown: false } } })
  f.hosts.close()
})

it('refuses a painted fill that finishes after its original mounted host detaches', async () => {
  let resolve!: (value: { text: string; mode: 'insert' }) => void
  const paint = vi.fn(() => new Promise<{ text: string; mode: 'insert' }>(yes => { resolve = yes }))
  const write = vi.fn((_value: unknown) => true), apply = vi.fn(async () => true)
  const hosts = createClaudePromptHosts(write, paint)
  const detach = hosts.register('view', { read: async () => undefined, fill: apply })
  hosts.receive(fill()); await flush(); expect(paint).toHaveBeenCalledOnce()
  detach(); resolve({ text: 'native', mode: 'insert' }); await flush()
  expect(apply).not.toHaveBeenCalled()
  expect(write).toHaveBeenCalledOnce(); expect(write.mock.calls[0]?.[0]).toMatchObject({ response: { response: { filled: false } } })
  hosts.close()
})


it('copies exact text once only for an advertising desktop host, including an empty string', async () => {
  const f = fixture(), copy = vi.fn(async () => true)
  f.detach(); f.hosts.register('view', { ...f.host, copy })
  expect(f.hosts.answers('view')).toContain('ui_copy')
  const request = { ...read('copy'), request: { ...read().request, subtype: 'ui_copy', text: 'native 👋\nexact' } }
  f.hosts.receive(request); f.hosts.receive(request); await flush()
  expect(copy).toHaveBeenCalledOnce()
  expect(copy).toHaveBeenCalledWith('native 👋\nexact', expect.any(AbortSignal), expect.any(Number))
  expect(f.answer()).toMatchObject({ response: { response: { copied: true } } })
  f.hosts.receive({ ...request, request_id: 'empty', request: { ...request.request, text: '' } }); await flush()
  expect(copy).toHaveBeenLastCalledWith('', expect.any(AbortSignal), expect.any(Number))
  f.hosts.close()
})

it('refuses absent, foreign, non-desktop and oversized clipboard requests without writing', async () => {
  const f = fixture(), copy = vi.fn(async () => true)
  const request = { ...read('copy'), request: { ...read().request, subtype: 'ui_copy', text: 'native' } }
  f.hosts.receive(request); await flush()
  expect(f.answer()).toMatchObject({ response: { response: { copied: false } } })
  f.detach();f.hosts.register('view', { ...f.host, copy })
  for (const [id, overrides] of [['foreign', { client_id: 'other' }], ['mobile', { surface: 'mobile' }], ['large', { text: 'x'.repeat(1000001) }]] as const) {
    f.hosts.receive({ ...request, request_id: id, request: { ...request.request, ...overrides } });await flush()
    expect(f.answer()).toMatchObject({ response: { response: { copied: false } } })
  }
  expect(copy).not.toHaveBeenCalled();f.hosts.close()
})

it('retires pending clipboard answers when their host is detached', async () => {
  const f = fixture();let resolve!: (value: boolean) => void
  const copy = vi.fn(() => new Promise<boolean>(yes => { resolve = yes }))
  f.detach();const detach = f.hosts.register('view', { ...f.host, copy })
  f.hosts.receive({ ...read('copy'), request: { ...read().request, subtype: 'ui_copy', text: 'native' } });await flush()
  detach();expect(f.answer()).toMatchObject({ response: { response: { copied: false } } })
  resolve(true);await flush();expect(f.write).toHaveBeenCalledOnce();f.hosts.close()
})
