import {afterEach, describe, expect, it, vi} from 'vitest'
import {createServer} from 'node:http'
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createClaudeNativeEditorBridge} from '#features/code/be/services/claude-code/native-editor-bridge.ts'
import {claudeSettingsSnapshot} from '#features/code/common/native-settings.ts'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close()})
async function fixture() {
  const directory = realpathSync(mkdtempSync('/tmp/cc-ed-bridge-')), sessionId = randomUUID(), originalDirectory = join(directory, sessionId)
  cleanup.push(() => rmSync(directory, {recursive: true, force: true})); mkdirSync(originalDirectory, {mode: 0o700})
  const path = join(originalDirectory, 'auto-mode-env-edit-0123456789abcdef.md'), socketPath = join(directory, 'bridge.sock'), token = 'a'.repeat(64), clientId = 'window-one', panelId = randomUUID()
  let childPid: number | undefined
  const server = createServer(async (req, res) => {
    if (req.headers['x-apack-native-token'] !== token) {res.writeHead(403); res.end('{}'); return}
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
    const offer = JSON.parse(Buffer.concat(chunks).toString())
    if (offer.sessionId !== sessionId || !await bridge.offer(offer, decision => res.end(JSON.stringify(decision)))) {res.writeHead(409); res.end('{}'); return}
    const id = bridge.active!.id; res.once('close', () => {if (!res.writableEnded) bridge.disconnect(id)})
  })
  server.listen(socketPath); await once(server, 'listening')
  cleanup.push(() => new Promise<void>(resolve => {server.closeAllConnections(); server.close(() => resolve())}))
  const originalResult = {snapshot: {revision: 'b'.repeat(64), rows: [], permissions: {title: 'Permissions', tabs: [], choices: [], paragraphs: [{runs:[{text:'Original native validation result',style:{}}]}], readOnly: false}}}
  const release = vi.fn(), hold = vi.fn(() => release), changed = vi.fn(), failed = vi.fn()
  const request = vi.fn(async (value: Record<string, unknown>) => {
    if (value.subtype !== 'apack_ui_settings' || value.operation !== 'permissions') return {read: true}
    const prepared = await bridge.prepare({pid: process.pid, sessionId, clientId, panelId, directory: originalDirectory})
    writeFileSync(path, 'Original environment\n', {mode: 0o600})
    const child = spawn(prepared.command, [path], {stdio: ['ignore', 'ignore', 'pipe']}); childPid = child.pid
    cleanup.push(() => {child.kill('SIGKILL')})
    let stderr = ''; child.stderr.on('data', chunk => {stderr += chunk.toString()})
    const [code] = await once(child, 'exit')
    if (code !== 0) throw new Error('Editor child failed: ' + stderr)
    return originalResult
  })
  const bridge = await createClaudeNativeEditorBridge({directory, socketPath, token, transport: {request, promptHosts: {register: () => () => {}, answers: () => [], detach() {}}, subscribe: () => () => {}}, hold, current: () => ({pid: process.pid, sessionId}), ownsChild: async pid => pid === childPid, changed, failed})
  cleanup.push(bridge.close)
  const opening = {subtype: 'apack_ui_settings', operation: 'permissions', client_id: clientId, panel_id: panelId, revision: 'a'.repeat(64), command: {action: 'select', value: 'environment-document'}}
  const local = (operation: string, command?: unknown, revision = bridge.active?.revision) => bridge.request({subtype: 'apack_ui_settings', operation, client_id: clientId, panel_id: panelId, revision, command})
  return {bridge, request, hold, release, originalResult, opening, local, path, sessionId, originalDirectory, clientId, panelId, failed}
}

describe('desktop editor bridge through the real owned child', () => {
  it('returns a scoped document, defers native reads, then returns the original validation result', async () => {
    const f = await fixture(), opened = await f.bridge.request(f.opening) as {snapshot: unknown}
    const snapshot = claudeSettingsSnapshot.parse(opened.snapshot), editor = snapshot.permissions!.editor!
    expect(editor.value).toBe('Original environment\n'); expect(f.hold).toHaveBeenCalledExactlyOnceWith(f.opening)
    let readFinished = false
    const read = f.bridge.request({subtype: 'ui_render'}).then(value => {readFinished = true; return value})
    await Promise.resolve(); expect(readFinished).toBe(false); expect(f.request).toHaveBeenCalledOnce()
    expect(await f.local('read')).toEqual(opened)
    const saved = await f.local('permissions', {action: 'externalSave', id: editor.id, value: 'Updated from app\n'}, editor.revision)
    expect(saved).toBe(f.originalResult); expect(readFileSync(f.path, 'utf8')).toBe('Updated from app\n')
    await expect(read).resolves.toEqual({read: true}); expect(f.release).toHaveBeenCalledOnce(); expect(f.bridge.active).toBeUndefined(); expect(f.failed).not.toHaveBeenCalled()
  })
  it('refuses foreign, stale and duplicate decisions; cancel leaves native bytes unchanged', async () => {
    const f = await fixture(); await f.bridge.request(f.opening); const editor = f.bridge.active!
    await expect(f.bridge.request({subtype: 'apack_ui_settings', operation: 'permissions', client_id: 'another-window', panel_id: f.panelId, revision: editor.revision, command: {action: 'externalSave', id: editor.id, value: 'foreign'}})).rejects.toThrow(/Finish/)
    await expect(f.local('permissions', {action: 'externalSave', id: editor.id, value: 'stale'}, 'c'.repeat(64))).rejects.toThrow(/changed/)
    await expect(f.bridge.prepare({pid: process.pid, sessionId: f.sessionId, clientId: 'another-window', panelId: f.panelId, directory: f.originalDirectory})).rejects.toThrow(/not owned/)
    await expect(f.local('permissions', {action: 'externalCancel', id: editor.id})).resolves.toBe(f.originalResult)
    expect(readFileSync(f.path, 'utf8')).toBe('Original environment\n')
    await expect(f.local('permissions', {action: 'externalCancel', id: editor.id}, editor.revision)).rejects.toThrow(/expired/)
  })
  it('owning window detach cancels the child before forwarding native detach', async () => {
    const f = await fixture(); await f.bridge.request(f.opening)
    await expect(f.bridge.request({subtype: 'ui_detach', client_id: f.clientId})).resolves.toEqual({read: true})
    expect(f.bridge.active).toBeUndefined(); expect(readFileSync(f.path, 'utf8')).toBe('Original environment\n'); expect(f.release).toHaveBeenCalledOnce()
  })
})
