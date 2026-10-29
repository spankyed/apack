import { createClaudeTerminalImageCache } from '#features/code/be/services/claude-code/terminal-image-cache.ts'
const reference = (imageId: number) => ({ type: 'NativeImageReference', props: { imageId, columns: 2, rows: 1, alt: 'Release cover' }, part: { plugin: 'fixture' } })
it('projects exact cached RGBA without exposing a filename', () => {
  const cache = createClaudeTerminalImageCache(), pixels = Buffer.from([1, 2, 3, 255])
  cache.put({ id: 7, image: { format: 'rgba', width: 1, height: 1 }, pixels })
  expect(cache.project(reference(7))).toEqual({ type: 'NativeImage', props: { columns: 2, rows: 1, alt: 'Release cover', format: 'rgba', data: pixels.toString('base64'), width: 1, height: 1 }, part: { plugin: 'fixture' } })
})
it('converts raw RGB into opaque RGBA pixels', () => {
  const cache = createClaudeTerminalImageCache()
  cache.put({ id: 1, image: { format: 'rgb', width: 1, height: 1 }, pixels: Buffer.from([255, 128, 0]) })
  expect(cache.project(reference(1))).toMatchObject({ props: { format: 'rgba', data: Buffer.from([255, 128, 0, 255]).toString('base64') } })
})
it('replaces the current frame and refuses it after native deletion', () => {
  const cache = createClaudeTerminalImageCache()
  for (const value of [1, 2]) cache.put({ id: 1, image: { format: 'rgba', width: 1, height: 1 }, pixels: Buffer.alloc(4, value) })
  expect(cache.project(reference(1))).toMatchObject({ props: { data: Buffer.alloc(4, 2).toString('base64') } })
  cache.remove(1)
  expect(cache.project(reference(1))).toMatchObject({ type: 'Text', children: ['Image pixels are unavailable in this terminal view.'] })
})
it('cannot restore old pixels after terminal ownership closes', () => {
  const cache = createClaudeTerminalImageCache(), value = { id: 1, image: { format: 'png' as const }, pixels: Buffer.alloc(4) }
  cache.put(value); cache.close(); cache.put(value)
  expect(cache.project(reference(1))).toMatchObject({ type: 'Text' })
})
it('keeps bounded conversation fallback separate from terminal image storage', () => {
  const cache = createClaudeTerminalImageCache()
  cache.put({ id: 1, image: { format: 'rgba', width: 128, height: 128 }, pixels: Buffer.alloc(128 * 128 * 4) })
  expect(cache.project(reference(1))).toMatchObject({ type: 'Text', children: ['Image preview exceeds this view. Open the native interface to inspect it.'] })
})
it('leaves other drawing contracts intact while resolving nested images', () => {
  const cache = createClaudeTerminalImageCache(), tree = { tree: { type: 'Box', props: { key: 'context' }, children: ['Heading', reference(77)] }, props: { requestId: 'original' } }
  expect(cache.project(tree)).toMatchObject({ tree: { type: 'Box', props: { key: 'context' }, children: ['Heading', { type: 'Text' }] }, props: { requestId: 'original' } })
})
