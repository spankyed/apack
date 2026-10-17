/** Authored helper executed only when native invokes its configured command. */
export const claudeTerminalStatusRuntime = String.raw`import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';

async function publish({ socketPath, token }, body) {
  await new Promise(resolve => {
    const request = http.request({ socketPath, path: '/native-status', method: 'POST', headers: { 'x-research-token': token, 'content-type': 'application/json' }, timeout: 500 }, response => { response.resume(); response.on('end', resolve); });
    request.on('timeout', () => { request.destroy(); resolve(); });
    request.on('error', resolve);
    request.end(JSON.stringify(body));
  });
}

/** The native shell-prefix argument is one original command string, already admitted by native. */
export async function runNativeStatusPrefix(options, argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !argv[0]) { process.exitCode = 64; return; }
  const startedAt = process.hrtime.bigint().toString();
  const command = argv[0], kind = options.captureMain ? 'main' : options.commands[command];
  const observed = kind === 'main' || kind === 'subagent';
  // Native treats the prefix as one executable path, with an optional raw flag tail.
  const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const prefix = options.delegatePrefix;
  const split = prefix?.lastIndexOf(' -') ?? -1;
  const delegated = !prefix ? command : split > 0
    ? quote(prefix.substring(0, split)) + ' ' + prefix.substring(split + 1) + ' ' + quote(command)
    : quote(prefix) + ' ' + quote(command);
  const child = spawn('/bin/sh', ['-c', delegated], { stdio: observed ? ['pipe', 'pipe', 'inherit'] : 'inherit' });
  const inputChunks = [], outputChunks = [];
  let inputBytes = 0, outputBytes = 0, truncated = false;
  if (observed) {
    process.stdin.on('data', chunk => { inputBytes += chunk.length; if (inputBytes <= 65536) inputChunks.push(chunk); });
    process.stdin.pipe(child.stdin);
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      if (!process.stdout.write(chunk)) { child.stdout.pause(); process.stdout.once('drain', () => child.stdout.resume()); }
      outputBytes += chunk.length;
      if (outputBytes <= 8192) outputChunks.push(chunk); else truncated = true;
    });
  }
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  const forward = signal => child.kill(signal);
  const handlers = signals.map(signal => { const handler = () => forward(signal); process.on(signal, handler); return [signal, handler]; });
  const result = await new Promise(resolve => {
    child.once('error', () => resolve({ code: 127, signal: null }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  for (const [signal, handler] of handlers) process.off(signal, handler);
  if (observed && inputBytes <= 65536) {
    let payload; try { payload = JSON.parse(Buffer.concat(inputChunks).toString()); } catch {}
    const valid = typeof payload?.session_id === 'string' && /^[a-f0-9-]{36}$/i.test(payload.session_id)
      && (kind === 'main' ? typeof payload.version === 'string' && payload.cost && payload.context_window : Array.isArray(payload.tasks));
    if (valid) await publish(options, { sessionId: payload.session_id, kind, command, startedAt, stdout: Buffer.concat(outputChunks).toString(), truncated, code: result.code, signal: result.signal,
      ...(kind === 'subagent' ? { tasks: payload.tasks.filter(task => typeof task.id === 'string' && task.id.length <= 256 && typeof task.status === 'string').slice(0, 256).map(task => ({id:task.id,status:task.status})) } : {}) });
  }
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.code ?? 1;
}

const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
if(config.originalPrefix === undefined)delete process.env.CLAUDE_CODE_SHELL_PREFIX;else process.env.CLAUDE_CODE_SHELL_PREFIX=config.originalPrefix;
if(config.electronEnv === undefined)delete process.env.ELECTRON_RUN_AS_NODE;else process.env.ELECTRON_RUN_AS_NODE=config.electronEnv;
await runNativeStatusPrefix(config,process.argv.slice(3));
`
