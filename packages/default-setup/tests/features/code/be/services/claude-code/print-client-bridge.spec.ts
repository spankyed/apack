import { spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { prepareClaudePrintClients } from '#features/code/be/services/claude-code/print-client-bridge.ts'
import { createClaudePrintClientRuntime } from '#features/code/be/services/claude-code/print-client-runtime.ts'
const site = { client_id: 'print-owner', surface: 'desktop' as const, component: 'AbovePrompt', instance_id: 'above', instance_revision: 1, props: {} }
const frame = { tree: { type: 'Client', props: { key: 'extension', module: './surface.ts' }, client: { plugin: 'fixture' } }, props: {}, rewritten: false, hooked: true }
async function nativeFixture(pid: () => number | undefined, helloPid = process.pid) {
  const bridge = await prepareClaudePrintClients({ currentPid: pid })
  const path = fileURLToPath(bridge.bunOptions.slice('--preload='.length)), source = await readFile(path, 'utf8')
  const config = JSON.parse(source.match(/^const config=(.+);$/m)![1]!) as { socketPath: string; token: string; epoch: string }
  const calls: string[] = []
  let finish!: () => void, started!: () => void
  const pending = new Promise<void>(resolve => { started = resolve })
  const server: Server = createServer(async (request, response) => {
    expect(request.headers['x-apack-native-token']).toBe(config.token)
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push(body.operation)
    if (body.operation === 'project') { started(); await new Promise<void>(resolve => { finish = resolve }) }
    response.end(JSON.stringify({ id: body.id, pid: body.operation === 'hello' ? helloPid : process.pid, epoch: config.epoch, result: body.operation === 'hello' ? { ready: true } : body.frame }))
  })
  server.listen(config.socketPath); await once(server, 'listening')
  return { bridge, calls, pending, finish: () => finish(), async close() { server.close(); await once(server, 'close'); await bridge.close() } }
}
it('requires an owned native palette for ordinary print drawings and parses its generated preload', async () => {
  const bridge = await prepareClaudePrintClients({ currentPid: () => undefined, bunOptions: '--preload=user-module.mjs' })
  try {
    const ordinary = { ...frame, tree: { type: 'Text', children: ['ordinary'] } }
    await expect(bridge.projection.project(site, ordinary)).rejects.toThrow('owner is unavailable')
    await expect(bridge.projection.event({ client_id: site.client_id, id: 'unused', sequence: 1, event: { kind: 'resize', columns: 5, rows: 1 } })).resolves.toEqual({ handled: false })
    expect(bridge.bunOptions).toMatch(/^--preload=user-module.mjs --preload=file:/)
    const generated = createClaudePrintClientRuntime({ socketPath: '/tmp/owned', token: 'private', epoch: 'process' })
    const parsed=spawnSync(process.execPath,['--check','--input-type=module'],{input:generated,encoding:'utf8'});expect(parsed.stderr).toBe('');expect(parsed.status).toBe(0)
  } finally { await bridge.close() }
})
it('refuses a native channel outside the owned launcher ancestry', async () => {
  const fixture = await nativeFixture(() => process.pid, 1)
  try { await expect(fixture.bridge.projection.project(site, frame)).rejects.toThrow('outside the owned launcher'); expect(fixture.calls).toEqual(['hello']) }
  finally { await fixture.close() }
})
it('refuses a projected reply after its launcher ownership ends', async () => {
  let owner: number | undefined = process.pid
  const fixture = await nativeFixture(() => owner)
  try {
    const projected = fixture.bridge.projection.project(site, frame)
    const verdict = expect(projected).rejects.toThrow('outlived its owner')
    await fixture.pending; owner = undefined; fixture.finish(); await verdict
    expect(fixture.calls).toEqual(['hello', 'project'])
  } finally { await fixture.close() }
})
