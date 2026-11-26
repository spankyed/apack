import { copyClaudeUiText } from '#features/threads/fe/chat/native-ui-clipboard.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('copies exact text only for a current focused view and handles platform refusal', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const writeText = vi.fn(async (_text: string) => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  expect(await copyClaudeUiText('native 👋\nexact', Date.now() + 3500, () => true)).toBe(true)
  expect(writeText).toHaveBeenCalledWith('native 👋\nexact')
  expect(await copyClaudeUiText('stale', Date.now() + 3500, () => false)).toBe(false)
  expect(await copyClaudeUiText('expired', Date.now() - 1, () => true)).toBe(false)
  expect(writeText).toHaveBeenCalledOnce()
  writeText.mockRejectedValueOnce(new Error('clipboard unavailable'))
  expect(await copyClaudeUiText('refused', Date.now() + 3500, () => true)).toBe(false)
})

it('does not report success after a view retires during the platform write', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  let resolve!: () => void, current = true
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>(yes => { resolve = yes }) } })
  const result = copyClaudeUiText('native', Date.now() + 3500, () => current)
  current = false;resolve();expect(await result).toBe(false)
})
