import { observeTerminalPicture, type TerminalPicture } from '#extensions/terminal/picture.ts'

const picture = (generation: number): TerminalPicture => ({ generation, width: 1, height: 1, pixels: new Uint8ClampedArray([generation, 0, 0, 255]) })
function fixture() {
  let listener!: { frame(frame: { sequence: number; images: number }): void; ended(): void }
  const detach = vi.fn(), changed = vi.fn(), source = { attach: vi.fn(value => { listener = value; return detach }), acknowledge: vi.fn(), image: vi.fn<() => Promise<TerminalPicture | null>>() }
  const stop = observeTerminalPicture(source, 42, changed)
  const frame = (images: number, sequence = images) => listener.frame({ sequence, images })
  return { source, changed, detach, stop, frame, ended: () => listener.ended() }
}
it('acknowledges every frame, reads only when the image counter changes and observes deletion', async () => {
  const f = fixture(); f.source.image.mockResolvedValueOnce(picture(1)).mockResolvedValueOnce(null)
  f.frame(1); await Promise.resolve()
  expect(f.changed).toHaveBeenLastCalledWith(picture(1))
  f.frame(1, 2); expect(f.source.image).toHaveBeenCalledOnce()
  f.frame(0, 3); await Promise.resolve()
  expect(f.source.acknowledge.mock.calls).toEqual([[1], [2], [3]])
  expect(f.source.image.mock.calls).toEqual([[42], [42]])
  expect(f.changed).toHaveBeenLastCalledWith(null)
  f.stop(); expect(f.detach).toHaveBeenCalledOnce()
})
it('coalesces a replacement while pixels are in flight and refuses the superseded generation', async () => {
  const f = fixture(); let release!: (value: TerminalPicture) => void
  f.source.image.mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValueOnce(picture(9))
  f.frame(1); f.frame(2); f.frame(3)
  expect(f.source.image).toHaveBeenCalledOnce()
  release(picture(1)); await Promise.resolve(); await Promise.resolve()
  expect(f.changed.mock.calls.filter(([value]) => value)).toEqual([[picture(9)]])
  expect(f.source.image).toHaveBeenCalledTimes(2)
  f.stop()
})
it.each(['detach', 'ended'] as const)('refuses late pixels after %s', async mode => {
  const f = fixture(); let release!: (value: TerminalPicture) => void
  f.source.image.mockImplementation(() => new Promise(resolve => { release = resolve }))
  f.frame(1); if (mode === 'detach') f.stop(); else f.ended()
  release(picture(1)); await Promise.resolve()
  expect(f.changed.mock.calls.every(([value]) => value === null)).toBe(true)
  if (mode === 'ended') f.stop()
})
it('reports missing pixels on broker failure without polling or an unhandled rejection', async () => {
  const f = fixture(); f.source.image.mockRejectedValue(new Error('broker ended'))
  f.frame(1); await Promise.resolve()
  expect(f.changed).toHaveBeenLastCalledWith(null)
  expect(f.source.image).toHaveBeenCalledOnce(); f.stop()
})
