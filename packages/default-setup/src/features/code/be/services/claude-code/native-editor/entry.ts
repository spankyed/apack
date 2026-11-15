import {closeSync, constants, fstatSync, openSync, readFileSync} from 'node:fs'
import {runClaudeNativeEditorChild, type ClaudeNativeEditorChildConfig} from './program.ts'

const abort = new AbortController()
const stop = () => abort.abort(new Error('Native editor child stopped'))
process.once('SIGINT', stop); process.once('SIGTERM', stop)
try {
  if (process.argv.length !== 4 || typeof process.getuid !== 'function' || !constants.O_NOFOLLOW) throw new Error('Native editor requires its private configuration and original Unix file')
  const fd = openSync(process.argv[2]!, constants.O_RDONLY | constants.O_NOFOLLOW)
  let config: ClaudeNativeEditorChildConfig
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 65_536) throw new Error('Native editor configuration is not private')
    const value: unknown = JSON.parse(readFileSync(fd, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native editor configuration is invalid')
    const parsed = value as Record<string, unknown>
    if (typeof parsed.socketPath !== 'string' || typeof parsed.token !== 'string' || typeof parsed.sessionId !== 'string' || typeof parsed.directory !== 'string' || typeof parsed.maxBytes !== 'number') throw new Error('Native editor configuration is incomplete')
    config = {socketPath: parsed.socketPath, token: parsed.token, sessionId: parsed.sessionId, directory: parsed.directory, maxBytes: parsed.maxBytes}
  } finally { closeSync(fd) }
  await runClaudeNativeEditorChild(config, process.argv[3]!, abort.signal)
} catch (error) {
  // This program is the CLI's editor child, so its failure belongs to the original editor stderr contract.
  process.stderr.write('Claude editor handoff failed: ' + (error instanceof Error ? error.message : 'unknown failure') + '\n')
  process.exitCode = 1
} finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop) }
