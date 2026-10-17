import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

it('keeps only the latest native completion and cancels detached drafts', async () => {
  const start = claudeTerminalUiRuntime.indexOf('const completions=new Map();')
  const end = claudeTerminalUiRuntime.indexOf('const schemaNames=')
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};({autocomplete,clearCompletion})`, { AbortController, Promise, Map }) as {
    autocomplete(native: unknown, client: string, box: { text: string }): Promise<{ suggestions: string[]; start?: number; superseded?: boolean }>
    clearCompletion(client: string): void
  }
  const calls: { text: string; signal: AbortSignal; resolve(value: { suggestions: string[] }): void }[] = []
  const native = { session: {
    rwt: (box: { text: string }) => box.text ? { start: 0, text: box.text } : undefined,
    r_n: (args: { text: string }, signal: AbortSignal) => new Promise<{ suggestions: string[] }>(resolve => calls.push({ text: args.text, signal, resolve })),
    n_n: (rows: string[]) => rows,
  } }
  const first = api.autocomplete(native, 'a', { text: 'old' }); await Promise.resolve()
  const middle = api.autocomplete(native, 'a', { text: 'middle' })
  const latest = api.autocomplete(native, 'a', { text: 'latest' })
  expect(calls[0]!.signal.aborted).toBe(true)
  expect(await middle).toEqual({ suggestions: [], superseded: true })
  calls[0]!.resolve({ suggestions: ['stale'] })
  expect(await first).toEqual({ suggestions: [], superseded: true })
  await Promise.resolve(); expect(calls[1]!.text).toBe('latest')
  calls[1]!.resolve({ suggestions: ['current'] })
  expect(await latest).toEqual({ suggestions: ['current'], start: 0 })
  const detached = api.autocomplete(native, 'a', { text: 'detached' }); await Promise.resolve()
  api.clearCompletion('a'); expect(calls[2]!.signal.aborted).toBe(true)
  calls[2]!.resolve({ suggestions: ['late'] })
  expect(await detached).toEqual({ suggestions: [], superseded: true })
  expect(await api.autocomplete(native, 'b', { text: '' })).toEqual({ suggestions: [] })
})

it('coalesces queued edits, adopts app changes and retires edits on detach', async () => {
  type Box = { text: string; cursor: number; superseded?: boolean }
  type Edit = { before: Box; after: Box; key?: { key: string; name: string } }
  const start = claudeTerminalUiRuntime.indexOf('const edits=new Map();')
  const end = claudeTerminalUiRuntime.indexOf('// Each attached composer')
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};({editPrompt,clearEdit})`, { AbortController, Promise, Map }) as {
    editPrompt(native: unknown, client: string, box: Box, key?: { key: string }, by?: string): Promise<Box> | Box
    clearEdit(client: string): void
  }
  const calls: { event: Edit; signal: AbortSignal; resolve(value: Box): void }[] = []
  const native = { session: {
    o_n: (box: Box) => ({ text: box.text, cursor: Math.min(box.cursor, box.text.length) }),
    Aze: (before: Box, after: Box) => ({ start: 0, end: before.text.length, inputText: after.text }),
    kGr: (event: Edit, signal: AbortSignal) => new Promise<Box>(resolve => calls.push({ event, signal, resolve })),
  }, runtime: { nxe: () => [], qgr: () => [] } }
  const first = api.editPrompt(native, 'a', { text: 'a', cursor: 1 }, { key: 'a' }); await Promise.resolve()
  const middle = api.editPrompt(native, 'a', { text: 'ab', cursor: 2 }, { key: 'b' })
  const latest = api.editPrompt(native, 'a', { text: 'abc', cursor: 3 }, { key: 'c' })
  calls[0]!.resolve({ text: 'A', cursor: 1 }); await first
  expect(await middle).toEqual({ text: 'ab', cursor: 2, superseded: true })
  await Promise.resolve(); expect(calls[1]!.event.key).toBeUndefined()
  expect(calls[1]!.event.after.text).toBe('abc')
  calls[1]!.resolve({ text: 'ABC', cursor: 3 }); await latest
  expect(api.editPrompt(native, 'a', { text: 'restored', cursor: 8 }, undefined, 'app')).toEqual({ text: 'restored', cursor: 8 })
  const next = api.editPrompt(native, 'a', { text: 'restored ', cursor: 9 }, { key: 'space' }); await Promise.resolve()
  expect(calls[2]!.event.before.text).toBe('restored')
  expect(calls[2]!.event.key).toMatchObject({ key: ' ', name: '' })
  api.clearEdit('a'); expect(calls[2]!.signal.aborted).toBe(true)
  calls[2]!.resolve({ text: 'LATE', cursor: 4 })
  expect(await next).toEqual({ text: 'restored ', cursor: 9, superseded: true })
})
