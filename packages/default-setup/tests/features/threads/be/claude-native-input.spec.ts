import { prepareClaudeNativeInput } from '#features/threads/be/claude-native-input.ts'

it('preserves resolved context/file text and ordered image labels and bytes', async () => {
  const references = { images: [{ name: 'pixel.png', url: 'media://fixture/pixel.png' }] }
  const resolve = vi.fn(async () => ({ textPrefix: '[Attached file: /fixture/file.txt]\n--- Note: context ---', addDirs: ['/fixture'], imageBlocks: [
    { type: 'text', text: '[Image: pixel.png]' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YQ==' } },
  ] }))
  expect(await prepareClaudeNativeInput('Inspect these', references, resolve)).toEqual({ text: '[Attached file: /fixture/file.txt]\n--- Note: context ---\n\nInspect these\n\n[Image: pixel.png]', images: [{ mediaType: 'image/png', data: 'YQ==' }] })
  expect(resolve).toHaveBeenCalledExactlyOnceWith(references)
})
it('refuses unavailable or unsupported image references rather than losing them from a send', async () => {
  const references = { images: [{ name: 'missing.png', url: 'media://fixture/missing.png' }] }
  await expect(prepareClaudeNativeInput('Keep draft', references, async () => ({ textPrefix: '', imageBlocks: [], addDirs: [] }))).rejects.toThrow('unavailable')
  await expect(prepareClaudeNativeInput('Keep draft', references, async () => ({ textPrefix: '', imageBlocks: [{ type: 'image', source: { type: 'base64', media_type: 'image/unsupported', data: 'YQ==' } }], addDirs: [] }))).rejects.toThrow('could not be prepared')
})
