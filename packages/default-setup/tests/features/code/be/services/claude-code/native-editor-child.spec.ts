import {afterEach, describe, expect, it} from 'vitest'
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http'
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {once} from 'node:events'
import {spawn} from 'node:child_process'
import {CLAUDE_NATIVE_EDITOR_PROGRAM} from '#features/code/be/services/claude-code/native-editor/program.generated.ts'
import {runClaudeNativeEditorChild} from '#features/code/be/services/claude-code/native-editor/program.ts'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function fixture(handle: (req: IncomingMessage, res: ServerResponse) => void) {
  // Short Unix path: macOS sockaddr_un is much smaller than the default tmpdir path plus a filename.
  const directory = realpathSync(mkdtempSync('/tmp/cc-editor-'))
  cleanup.push(() => rmSync(directory, {recursive: true, force: true}))
  const socketPath = join(directory, 'bridge.sock'), path = join(directory, 'auto-mode-env-edit-0123456789abcdef.md')
  writeFileSync(path, 'Original environment\n', {mode: 0o600})
  const server = createServer(handle)
  server.listen(socketPath); await once(server, 'listening')
  cleanup.push(() => new Promise<void>((resolve, reject) => {server.closeAllConnections(); server.close(error => error ? reject(error) : resolve())}))
  const abort = new AbortController(); cleanup.push(() => abort.abort())
  const config = {socketPath, directory, token: 'a'.repeat(64), sessionId: '11111111-1111-4111-8111-111111111111', maxBytes: 100_000}
  function runRecorded(privateConfig = true) {
    const program = join(directory, 'editor.mjs'), configuration = join(directory, 'editor.json')
    writeFileSync(program, CLAUDE_NATIVE_EDITOR_PROGRAM, {mode: 0o600})
    writeFileSync(configuration, JSON.stringify(config), {mode: privateConfig ? 0o600 : 0o644})
    const child = spawn(process.execPath, ['--max-old-space-size=64', program, configuration, path], {stdio: ['ignore', 'ignore', 'pipe'], env: {...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: ''}})
    cleanup.push(() => {child.kill('SIGKILL')})
    let stderr = ''; child.stderr.on('data', chunk => {stderr += chunk.toString()})
    return once(child, 'exit').then(([code, signal]) => ({code, signal, stderr}))
  }
  return {path, config, abort, runRecorded, read: () => readFileSync(path, 'utf8'), run: () => runClaudeNativeEditorChild(config, path, abort.signal)}
}

describe('owned external-editor child exchange', () => {
  it('runs the recorded entry as a separate real child and saves its original file', async () => {
    let childPid: number | undefined, parentPid: number | undefined
    const f = await fixture(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
      const offer = JSON.parse(Buffer.concat(chunks).toString()); childPid = offer.pid; parentPid = offer.parentPid
      res.end(JSON.stringify({kind: 'save', content: 'Saved from owned child'}))
    })
    expect(await f.runRecorded()).toEqual({code: 0, signal: null, stderr: ''})
    expect(childPid).toBeGreaterThan(1); expect(childPid).not.toBe(process.pid); expect(parentPid).toBe(process.pid)
    expect(f.read()).toBe('Saved from owned child')
  })
  it('the real entry refuses non-private configuration before offering any file', async () => {
    let offered = false
    const f = await fixture((_req, res) => {offered = true; res.end(JSON.stringify({kind: 'save', content: 'bad'}))})
    const result = await f.runRecorded(false)
    expect(result.code).toBe(1); expect(result.stderr).toContain('configuration is not private'); expect(result.stderr).not.toContain(f.config.token)
    expect(offered).toBe(false); expect(f.read()).toBe('Original environment\n')
  })
  it('authenticates the offer and returns a save through the original working file', async () => {
    let offered: unknown, token: unknown, route: unknown
    const f = await fixture(async (req, res) => {
      token = req.headers['x-apack-native-token']; route = req.url
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
      offered = JSON.parse(Buffer.concat(chunks).toString()); res.end(JSON.stringify({kind: 'save', content: 'Changed environment\n'}))
    })
    await f.run(); expect(f.read()).toBe('Changed environment\n'); expect(token).toBe(f.config.token); expect(route).toBe('/native-editor')
    expect(offered).toEqual({sessionId: f.config.sessionId, pid: process.pid, parentPid: process.ppid, fileIdentity: expect.stringMatching(/^[a-f0-9]{64}$/), content: 'Original environment\n'})
    expect(offered).not.toHaveProperty('path')
  })
  it('cancel leaves the file unchanged', async () => {
    const f = await fixture((_req, res) => res.end(JSON.stringify({kind: 'cancel'})))
    await f.run(); expect(f.read()).toBe('Original environment\n')
  })
  it.each([undefined, {kind: 'save'}, {kind: 'cancel', content: 'injected'}, {kind: 'save', content: 'injected', path: '/elsewhere'}])('rejects malformed decisions without writing (%j)', async answer => {
    const f = await fixture((_req, res) => res.end(answer === undefined ? 'not JSON' : JSON.stringify(answer)))
    await expect(f.run()).rejects.toThrow(); expect(f.read()).toBe('Original environment\n')
  })
  it('refusal and socket loss leave the file unchanged', async () => {
    const f = await fixture((_req, res) => {res.writeHead(409); res.end('{}')})
    await expect(f.run()).rejects.toThrow(/refused/); expect(f.read()).toBe('Original environment\n')
    const lost = await fixture(req => req.socket.destroy())
    await expect(lost.run()).rejects.toThrow(); expect(lost.read()).toBe('Original environment\n')
  })
  it('owner abort interrupts the wait without writing, even after the offer was delivered', async () => {
    let delivered!: () => void; const delivery = new Promise<void>(resolve => {delivered = resolve})
    const f = await fixture(async req => {for await (const _chunk of req) { /* drain the authenticated offer */ }; delivered()})
    const result = f.run(); const refused = expect(result).rejects.toThrow(); await delivery; f.abort.abort(); await refused
    expect(f.read()).toBe('Original environment\n')
  })
  it('rejects oversized replies before retaining them as decisions', async () => {
    const f = await fixture((_req, res) => res.end(JSON.stringify({kind: 'save', content: 'x'.repeat(700_000)})))
    await expect(f.run()).rejects.toThrow(/limit/); expect(f.read()).toBe('Original environment\n')
  })
  it('rechecks original text after waiting for a decision', async () => {
    const f = await fixture((_req, res) => {writeFileSync(f.path, 'Changed elsewhere'); res.end(JSON.stringify({kind: 'save', content: 'stale'}))})
    await expect(f.run()).rejects.toThrow(/text changed/); expect(f.read()).toBe('Changed elsewhere')
  })
})
