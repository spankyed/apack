import { createClaudeTerminalImageFileTransport } from '#features/code/be/services/claude-code/terminal-image-file-transport.ts'
const frame = (header: string, path = '/private/frame.rgba') => `\x1b_G${header};${Buffer.from(path).toString('base64')}\x1b\\`
function fixture(read = vi.fn(async () => Buffer.from([1, 2, 3, 255]))) {
  const emit = vi.fn(), reply = vi.fn(), transport = createClaudeTerminalImageFileTransport({ emit, reply, read })
  return { emit, reply, read, ...transport, output: () => emit.mock.calls.map(call => call[0]).join('') }
}
it('answers the original four-byte local file probe without exposing its name', async () => {
  const f = fixture()
  await f.write(frame('i=24,s=1,v=1,a=q,t=f,f=32'))
  expect(f.read).toHaveBeenCalledWith('/private/frame.rgba', { format: 'rgba', width: 1, height: 1 })
  expect(f.reply).toHaveBeenCalledExactlyOnceWith('\x1b_Gi=24;OK\x1b\\')
  expect(f.output()).toBe('')
})
it('preserves terminal text order across split frames and asynchronous file reads', async () => {
  let release!: (pixels: Buffer) => void
  const f = fixture(vi.fn(() => new Promise<Buffer>(resolve => { release = resolve })))
  const source = frame('a=T,U=1,q=1,f=32,s=1,v=1,t=f,i=7,c=2,r=1')
  await f.write('before' + source.slice(0, 12))
  const pending = f.write(source.slice(12) + 'after'), later = f.write('last')
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
  expect(f.output()).toBe('before')
  release(Buffer.from([1, 2, 3, 255])); await Promise.all([pending, later])
  expect(f.output()).toBe('before\x1b_Ga=T,U=1,q=2,f=32,s=1,v=1,t=d,i=7,c=2,r=1,m=0;AQID/w==\x1b\\afterlast')
  expect(f.reply).not.toHaveBeenCalled()
})
it('refuses failed file reads and shared memory without claiming support', async () => {
  const f = fixture(vi.fn(async () => { throw new Error('private filename') }))
  await f.write(frame('a=T,q=1,f=32,s=1,v=1,t=f,i=8'))
  await f.write(frame('a=T,q=1,f=32,s=1,v=1,t=s,i=9'))
  expect(f.read).toHaveBeenCalledOnce()
  expect(f.output()).toBe('')
  expect(f.reply.mock.calls).toEqual([['\x1b_Gi=8;EIO:terminal image file could not be read\x1b\\'], ['\x1b_Gi=9;ENOTSUPPORTED:shared memory transport is unavailable\x1b\\']])
})
it('leaves direct image frames and unrelated terminal escapes untouched', async () => {
  const f = fixture(), text = '\x1b[31mred\x1b[0m\x1b_Ga=T,t=d,f=32,i=1;AQID/w==\x1b\\'
  for (const char of text) await f.write(char)
  expect(f.output()).toBe(text); expect(f.read).not.toHaveBeenCalled()
})
it('withdraws an in-flight read on owner close', async () => {
  let release!: (pixels: Buffer) => void
  const f = fixture(vi.fn(() => new Promise<Buffer>(resolve => { release = resolve })))
  const pending = f.write(frame('a=T,q=1,f=32,s=1,v=1,t=f,i=7'))
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
  f.close(); release(Buffer.alloc(4)); await pending
  expect(f.output()).toBe(''); expect(f.reply).not.toHaveBeenCalled()
})
it('rejects duplicate header authority without opening a file', async () => {
  const f = fixture()
  await f.write(frame('a=T,t=f,t=d,f=32,s=1,v=1,i=7'))
  expect(f.read).not.toHaveBeenCalled()
  expect(f.reply).toHaveBeenCalledWith('\x1b_Gi=7;EINVAL:invalid named image frame\x1b\\')
})
it('chunks larger pixels into one ordered direct transmission', async () => {
  const bytes = Buffer.alloc(4096, 127), f = fixture(vi.fn(async () => bytes))
  await f.write(frame('a=T,U=1,q=1,f=32,s=32,v=32,t=f,i=7,c=8,r=4'))
  expect(f.emit).toHaveBeenCalledTimes(2)
  const frames = f.emit.mock.calls.map(call => call[0] as string)
  expect(frames[0]).toContain('t=d,i=7,c=8,r=4,m=1;')
  expect(frames[1]!.startsWith('\x1b_Gq=2,m=0;')).toBe(true)
  const encoded = frames.map(value => value.slice(value.indexOf(';') + 1, -2)).join('')
  expect(Buffer.from(encoded, 'base64')).toEqual(bytes)
  expect(f.reply).not.toHaveBeenCalled()
})
