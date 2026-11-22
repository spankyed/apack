import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileWhileWorking } from '@apackdev/sdk/progress'
import { claudeTerminalStatusObserverRuntime } from '#features/code/be/services/claude-code/terminal-status-observer-runtime.ts'

it.skipIf(process.platform === 'win32')('uses the native caption to settle a signalled main helper and discards a superseded observation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'claude-status-'))
  const socketPath = join(directory, 'status.sock')
  const sessionId = '11111111-1111-4111-8111-111111111111'
  const events: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    if (request.url === '/native-status') events.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.end('{}')
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    const observer = join(directory, 'observer.mjs')
    const config = join(directory, 'observer.json')
    const command = 'fixture-main'
    await writeFile(observer, claudeTerminalStatusObserverRuntime)
    await writeFile(config, JSON.stringify({ socketPath, sessionId, token: 'fixture', generations: { main: 'generation' } }))
    const script = `
      import assert from 'node:assert/strict';
      import { spawn } from 'node:child_process';
      import { once } from 'node:events';
      import { installNativeHelperObserver } from ${JSON.stringify(pathToFileURL(observer).href)};
      const observer = installNativeHelperObserver({resolveConfig:()=>${JSON.stringify(config)}, reconcileSignalledMain:()=>true});
      await observer.activate();
      const payload = ${JSON.stringify(JSON.stringify({ session_id: sessionId, version: '2.1.302', cost: {}, context_window: {} }))};
      const run = async source => {
        const child = spawn(process.execPath, ['-e', source, ${JSON.stringify(command)}], {stdio:['pipe','pipe','ignore']});
        const completed = once(child, 'close');
        child.stdout.resume();
        child.stdin.end(payload);
        await completed;
      };
      const signal = () => run("process.stdin.resume();process.stdin.on('end',()=>process.kill(process.pid,'SIGTERM'))");
      const reconcile=(startedAt, cachedMainStatus)=>observer.reconcileMainStatus(startedAt,{sessionId:${JSON.stringify(sessionId)},statusCommand:${JSON.stringify(command)},cachedMainStatus});
      await signal();
      const superseded=observer.signalledMainStartedAt;
      assert.ok(superseded);
      reconcile(superseded, 'Previous caption');
      assert.equal(observer.signalledMainStartedAt,superseded);
      await run("process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('Fresh caption'))");
      assert.equal(observer.signalledMainStartedAt,undefined);
      reconcile(superseded,null);
      await signal();
      const current=observer.signalledMainStartedAt;
      assert.ok(current);
      assert.notEqual(current,superseded);
      reconcile(superseded,null);
      assert.equal(observer.signalledMainStartedAt,current);
      reconcile(current,null);
      assert.equal(observer.signalledMainStartedAt,undefined);
      observer.close();
    `
    await execFileWhileWorking(process.execPath, ['--input-type=module', '-e', script], { timeout: 10000 })
    expect(events).toEqual([
      expect.objectContaining({ code: 0, signal: null, stdout: 'Fresh caption' }),
      expect.objectContaining({ code: null, signal: 'SIGTERM', stdout: '' }),
    ])
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
