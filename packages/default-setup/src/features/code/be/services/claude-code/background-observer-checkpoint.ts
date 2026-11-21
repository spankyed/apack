import { constants } from 'node:fs'
import { link, lstat, mkdir, open, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'

type Endpoint = { directory: string; token: string }
type Generation = Endpoint & { id: string; pid: number }

async function privateDirectory(path: string, create = true) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw Error('Background checkpoint directory is not private')
}
async function readPrivate(path: string): Promise<string | undefined> {
  let file
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  try {
    const info = await file.stat()
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size > 4096) throw Error('Background checkpoint file is not private')
    return await file.readFile('utf8')
  } finally { await file.close() }
}
function decode(raw: string): Generation {
  const value = JSON.parse(raw) as Generation
  const temporary = process.platform === 'darwin' ? '/private/tmp' : tmpdir()
  if (!value || !/^[a-f0-9-]{36}$/.test(value.id) || !Number.isSafeInteger(value.pid) || value.pid <= 1 || !/^[a-f0-9]{64}$/.test(value.token)
    || typeof value.directory !== 'string' || dirname(value.directory) !== temporary || !/^cc-child-[a-zA-Z0-9]+$/.test(basename(value.directory))) throw Error('Invalid background checkpoint')
  return value
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error }
}

/**
 * An immutable generation grants its successor with one exclusive hard link. No stale lock is
 * unlinked: concurrent claimants follow the winner, including when it dies during socket recovery.
 * The registry contains only a private endpoint capability, never Claude credentials or settings.
 */
export async function claimClaudeBackgroundCheckpoint(options: {
  profile: string
  parentSessionId: string
  endpoint?: Endpoint
}) {
  const temporary = process.platform === 'darwin' ? '/private/tmp' : tmpdir()
  const root = join(temporary, 'apack-claude-background-' + process.getuid?.())
  await privateDirectory(root)
  const key = createHash('sha256').update(JSON.stringify([options.profile, options.parentSessionId])).digest('hex')
  const directory = join(root, key); await privateDirectory(directory)
  let pointer = join(directory, 'head')
  for (let depth = 0; depth < 4096; depth++) {
    const raw = await readPrivate(pointer)
    let previous: Generation | undefined, retired = false
    if (raw) {
      previous = decode(raw)
      const next = join(directory, previous.id + '.next')
      if (await readPrivate(next)) { pointer = next; continue }
      retired = await readPrivate(join(directory, previous.id + '.retired')) === previous.id
      if (!retired && alive(previous.pid)) throw Error('Background checkpoint still has a live API owner')
      if (retired && !options.endpoint) return
      pointer = next
    } else if (!options.endpoint) return
    const endpoint = options.endpoint ?? previous!
    await privateDirectory(endpoint.directory, false)
    const generation: Generation = { id: randomUUID(), pid: process.pid, directory: endpoint.directory, token: endpoint.token }
    decode(JSON.stringify(generation))
    const prepared = join(directory, generation.id)
    await writeFile(prepared, JSON.stringify(generation), { flag: 'wx', mode: 0o600 })
    try { await link(prepared, pointer) }
    catch (error) {
      await unlink(prepared)
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    let retiring: Promise<void> | undefined
    return {
      directory:endpoint.directory, token:endpoint.token,
      retire() {
        return retiring ??= writeFile(join(directory, generation.id + '.retired'), generation.id, { flag: 'wx', mode: 0o600 })
      },
    }
  }
  throw Error('Background checkpoint generation chain exceeds its safety bound')
}
export type ClaudeBackgroundCheckpoint = NonNullable<Awaited<ReturnType<typeof claimClaudeBackgroundCheckpoint>>>
