import { mkdtemp, writeFile, readFile, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readClaudeTerminalImageFile } from '#features/code/be/services/claude-code/terminal-image-file.ts'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'claude-terminal-image-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
it('reads exact raw pixels and leaves the source in place', async () => {
  const path = join(directory, 'frame.rgb'), bytes = Buffer.from([255, 128, 0])
  await writeFile(path, bytes)
  expect(await readClaudeTerminalImageFile(path, { format: 'rgb', width: 1, height: 1 })).toEqual(bytes)
  expect(await readFile(path)).toEqual(bytes)
})
it('reads a new frame under the same name without caching stale pixels', async () => {
  const path = join(directory, 'frame.rgba')
  await writeFile(path, Buffer.from([1, 2, 3, 255]))
  expect(await readClaudeTerminalImageFile(path, { format: 'rgba', width: 1, height: 1 })).toEqual(Buffer.from([1, 2, 3, 255]))
  await writeFile(path, Buffer.from([4, 5, 6, 255]))
  expect(await readClaudeTerminalImageFile(path, { format: 'rgba', width: 1, height: 1 })).toEqual(Buffer.from([4, 5, 6, 255]))
})
it('refuses dimension and byte-count mismatches', async () => {
  const path = join(directory, 'frame'); await writeFile(path, Buffer.alloc(4))
  await expect(readClaudeTerminalImageFile(path, { format: 'rgb', width: 1, height: 1 })).rejects.toThrow('size')
  await expect(readClaudeTerminalImageFile(path, { format: 'rgba', width: 4097, height: 1 })).rejects.toThrow('dimensions')
})
it('refuses special sources and directories before reading their contents', async () => {
  await expect(readClaudeTerminalImageFile('/dev/zero', { format: 'png' })).rejects.toThrow('regular local')
  await expect(readClaudeTerminalImageFile(directory, { format: 'png' })).rejects.toThrow('size or kind')
  await expect(readClaudeTerminalImageFile('relative.png', { format: 'png' })).rejects.toThrow('path')
})
it('refuses oversized files before allocating their contents', async () => {
  const path = join(directory, 'large.png'); await writeFile(path, '')
  await truncate(path, 64 * 1024 * 1024 + 1)
  await expect(readClaudeTerminalImageFile(path, { format: 'png' })).rejects.toThrow('size')
})
it('refuses invalid PNG content', async () => {
  const path = join(directory, 'invalid.png'); await writeFile(path, Buffer.alloc(40))
  await expect(readClaudeTerminalImageFile(path, { format: 'png' })).rejects.toThrow('header')
})
