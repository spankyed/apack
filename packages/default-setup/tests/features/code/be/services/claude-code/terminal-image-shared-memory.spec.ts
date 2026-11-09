import { randomBytes } from 'node:crypto'
import { writeFile, access, unlink } from 'node:fs/promises'
import { readClaudeTerminalSharedImage } from '#features/code/be/services/claude-code/terminal-image-shared-memory.ts'

const names: string[] = []
async function publish(bytes: Buffer) {
  const name = '/apack_cc_test_' + randomBytes(6).toString('hex')
  await writeFile('/dev/shm/' + name.slice(1), bytes, { flag: 'wx', mode: 0o600 }); names.push(name)
  return name
}
afterEach(async () => { for (const name of names.splice(0)) await unlink('/dev/shm/' + name.slice(1)).catch(error => { if (error.code !== 'ENOENT') throw error }) })
describe.skipIf(process.platform !== 'linux')('Linux terminal-owned shared pixels', () => {
  it('reads exact RGBA bytes and consumes the object once', async () => {
    const pixels = Buffer.from([255, 128, 0, 255]), name = await publish(pixels)
    expect(await readClaudeTerminalSharedImage(name, { format: 'rgba', width: 1, height: 1 })).toEqual(pixels)
    await expect(access('/dev/shm/' + name.slice(1))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readClaudeTerminalSharedImage(name, { format: 'rgba', width: 1, height: 1 })).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('reads RGB from a larger allocation without copying its padding', async () => {
    const name = await publish(Buffer.from([1, 2, 3, 99, 99]))
    expect(await readClaudeTerminalSharedImage(name, { format: 'rgb', width: 1, height: 1 })).toEqual(Buffer.from([1, 2, 3]))
  })
  it('refuses a short allocation without unlinking it', async () => {
    const name = await publish(Buffer.alloc(0))
    await expect(readClaudeTerminalSharedImage(name, { format: 'rgba', width: 1, height: 1 })).rejects.toThrow('too short')
    await access('/dev/shm/' + name.slice(1))
  })
  it('rejects traversal and PNG sources before consuming an object', async () => {
    await expect(readClaudeTerminalSharedImage('/../private', { format: 'rgba', width: 1, height: 1 })).rejects.toThrow('name')
    const name = await publish(Buffer.alloc(4))
    await expect(readClaudeTerminalSharedImage(name, { format: 'png' })).rejects.toThrow('format')
    await access('/dev/shm/' + name.slice(1))
  })
  it('rejects dimensions beyond the native limit without consuming the object', async () => {
    const name = await publish(Buffer.alloc(4))
    await expect(readClaudeTerminalSharedImage(name, { format: 'rgba', width: 4097, height: 1 })).rejects.toThrow('dimensions')
    await access('/dev/shm/' + name.slice(1))
  })
  it('leaves a cancelled object available to its publisher', async () => {
    const name = await publish(Buffer.alloc(4)), controller = new AbortController(); controller.abort()
    await expect(readClaudeTerminalSharedImage(name, { format: 'rgba', width: 1, height: 1 }, controller.signal)).rejects.toThrow()
    await access('/dev/shm/' + name.slice(1))
  })
})
