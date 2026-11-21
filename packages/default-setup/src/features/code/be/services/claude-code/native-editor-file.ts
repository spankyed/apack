import {createHash} from 'node:crypto'
import {closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, openSync, readSync, realpathSync, writeSync} from 'node:fs'
import {basename, dirname, resolve} from 'node:path'
import type {ClaudeNativeEditorDecision} from './native-editor-lease.ts'

/** The child holds the original CLI file; neither the window nor a later reply chooses a write path. */
export function openClaudeNativeEditorFile(path: string, options: {directory: string; maxBytes: number}) {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) throw new Error('Invalid native editor file limit')
  if (typeof process.getuid !== 'function' || !constants.O_NOFOLLOW) throw new Error('Native editor files require Unix ownership and no-follow opens')
  const uid = BigInt(process.getuid())
  const directory = realpathSync(options.directory), absolute = resolve(path)
  // Original 2.1.302 As/Oms: auto-mode-env-edit- + randomBytes(8).hex + .md.
  if (!/^auto-mode-env-edit-[a-f0-9]{16}\.md$/.test(basename(absolute)) || dirname(absolute) !== directory || realpathSync(dirname(absolute)) !== directory) throw new Error('Unexpected native editor path')
  const fd = openSync(absolute, constants.O_RDWR | constants.O_NOFOLLOW)
  let closed = false
  const close = () => { if (!closed) { closed = true; closeSync(fd) } }
  try {
    const original = fstatSync(fd, {bigint: true})
    const validate = () => {
      const held = fstatSync(fd, {bigint: true}), named = lstatSync(absolute, {bigint: true})
      if (!held.isFile() || !named.isFile() || held.dev !== original.dev || held.ino !== original.ino || named.dev !== held.dev || named.ino !== held.ino || held.nlink !== 1n || held.uid !== uid || (held.mode & 0o777n) !== 0o600n || realpathSync(dirname(absolute)) !== directory) throw new Error('Original native editor file changed identity')
      if (held.size > BigInt(options.maxBytes)) throw new Error('Native editor file exceeds the admitted transport limit')
      return held
    }
    const read = () => {
      const before = validate(), bytes = Buffer.alloc(Number(before.size))
      let offset = 0
      while (offset < bytes.length) {
        const count = readSync(fd, bytes, offset, bytes.length - offset, offset)
        if (!count) throw new Error('Native editor file changed while reading')
        offset += count
      }
      const after = validate()
      if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw new Error('Native editor file changed while reading')
      return bytes
    }
    const bytes = read(), digest = createHash('sha256').update(bytes).digest('hex')
    const content = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes)
    const fileIdentity = createHash('sha256').update(`${original.dev}:${original.ino}:${digest}`).digest('hex')
    return {
      content, fileIdentity,
      finish(decision: ClaudeNativeEditorDecision) {
        if (closed) throw new Error('Native editor file is closed')
        try {
          if (decision.kind === 'cancel') return
          const replacement = Buffer.from(decision.content, 'utf8')
          if (replacement.length > options.maxBytes) throw new Error('Native editor text exceeds the admitted transport limit')
          if (createHash('sha256').update(read()).digest('hex') !== digest) throw new Error('Original native editor text changed before save')
          let offset = 0
          while (offset < replacement.length) {
            const count = writeSync(fd, replacement, offset, replacement.length - offset, offset)
            if (!count) throw new Error('Native editor write made no progress')
            offset += count
          }
          ftruncateSync(fd, replacement.length)
          fsyncSync(fd)
        } finally { close() }
      },
      close,
    }
  } catch (error) { close(); throw error }
}
