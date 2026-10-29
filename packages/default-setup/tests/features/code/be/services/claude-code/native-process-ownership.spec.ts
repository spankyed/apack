import { isClaudeNativeDescendant } from '#features/code/be/services/claude-code/native-process-ownership.ts'
it('recognizes the actual native child beneath a launcher and refuses a foreign tree', async () => {
  const parent = async (pid: number) => ({ 300: 200, 200: 100, 400: 1 }[pid] ?? 0)
  expect(await isClaudeNativeDescendant(300, 100, parent)).toBe(true)
  expect(await isClaudeNativeDescendant(100, 100, parent)).toBe(true)
  expect(await isClaudeNativeDescendant(400, 100, parent)).toBe(false)
})
it('bounds malformed cyclic ancestry and refuses absent owners', async () => {
  expect(await isClaudeNativeDescendant(300, 100, async () => 300)).toBe(false)
  expect(await isClaudeNativeDescendant(300, undefined, async () => 100)).toBe(false)
})
