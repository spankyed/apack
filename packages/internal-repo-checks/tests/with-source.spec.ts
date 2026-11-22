import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

/** scripts/with-source.mjs gives a command's Node processes the @apackdev/source condition */
const WITH_SOURCE = path.join(REPO_ROOT, 'scripts', 'with-source.mjs');
const PRINT_NODE_OPTIONS = ['node', '-p', 'process.env.NODE_OPTIONS'];

/** The wrapper's exit code, and what it printed, whichever way it exited */
async function run(args: string[], nodeOptions?: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<{ code: unknown; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, ...extraEnv };
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  try {
    return { code: 0, ...await execFileWhileWorking(process.execPath, [WITH_SOURCE, ...args], { cwd: REPO_ROOT, env }) };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: unknown; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

describe('with-source', () => {
  it("appends the condition to the caller's NODE_OPTIONS", async () => {
    expect((await run(PRINT_NODE_OPTIONS, '--max-old-space-size=4096')).stdout.trim())
      .toBe('--max-old-space-size=4096 --conditions=@apackdev/source');
    expect((await run(PRINT_NODE_OPTIONS)).stdout.trim()).toBe('--conditions=@apackdev/source');
  });

  /**
   * The usage line in that script is `node scripts/with-source.mjs playwright test …`, which is also how
   * every drive and test script in `package.json` reads. Copied out of one and into a terminal it died with
   * `spawn playwright ENOENT`, because npm is what puts `node_modules/.bin` on PATH and nothing else did.
   */
  it("resolves a locally installed command, with the PATH a terminal has rather than npm's", async () => {
    // Node's own directory and nothing else: no `node_modules/.bin`, as a shell outside npm has
    const bare = path.dirname(process.execPath);

    expect((await run(['tsx', '--version'], undefined, { PATH: bare })).stdout).toMatch(/tsx/);
  });

  it('preserves repeated spaces in preload paths through nested wrappers', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-node-options-'));
    try {
      const preload = path.join(directory, 'pre load  file.cjs');
      fs.writeFileSync(preload, 'globalThis.preloadProbe = "PRELOADED";');
      const result = await run(['node', WITH_SOURCE, 'node', '-p', 'globalThis.preloadProbe'], '--require=' + JSON.stringify(preload));
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('PRELOADED');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('adds the condition once when nested', async () => {
    expect((await run(['node', WITH_SOURCE, ...PRINT_NODE_OPTIONS])).stdout.trim()).toBe('--conditions=@apackdev/source');
  });

  it("exits with the command's code", async () => {
    expect((await run(['node', '-e', 'process.exit(3)'])).code).toBe(3);
  });

  /**
   * Runs a command through the wrapper, signals it once it says `ready`, and hands back everything the run
   * produced.
   *
   * **Resolved on `close`, not `exit`, because the process being watched is not the one that writes.** The
   * wrapper spawns with `stdio: 'inherit'`, so the command's output reaches this pipe through an inherited
   * fd; `exit` fires on the wrapper's own SIGCHLD and claims nothing about whether those bytes arrived,
   * where `close` fires only once every stdio stream has ended. `bounded-spawn.ts` resolves on `close` for
   * this reason.
   *
   * **`stderr` and `signal` come back whether a case asserts on them or not.** The wrapper reports a spawn
   * failure on stderr, and a command killed by a signal is only visible in `signal` — a run that read
   * neither cannot say what happened to it.
   */
  async function signalled(childCode: string, send: (child: ChildProcess) => void) {
    const child = spawn(process.execPath, [WITH_SOURCE, process.execPath, '-e', childCode], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH },
      detached: true, // its own process group, as the terminal's foreground group is
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => { out += chunk; });
    child.stderr.on('data', (chunk: string) => { err += chunk; });
    // Subscribed before the command is signalled, so nothing it prints afterwards is missed
    const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal }));
    });

    // Awaited rather than assumed: a command that never announces itself fails naming that, where a bare
    // `data` listener would hang to the suite's own timeout and say only that the test took too long
    await _whenSatisfied(
      (notify) => {
        child.stdout.on('data', notify);
        return () => child.stdout.off('data', notify);
      },
      () => out.includes('ready') || undefined,
      'the wrapped command to print ready',
    );
    send(child);
    return { ...await finished, out, err };
  }

  /** A terminal's Ctrl+C: SIGINT to the whole foreground group, which the wrapper and its command share */
  const groupCtrlC = (child: ChildProcess) => { process.kill(-(child.pid as number), 'SIGINT'); };

  /**
   * Each of these lets its last write drain instead of calling `process.exit` on the line after
   * `console.log`: stdout to a pipe is asynchronous and `process.exit` does not flush it, so the line the
   * case asserts on can be dropped outright. Clearing the keep-alive timer lets the loop empty and the
   * process exit 0 of its own accord, after the write has gone.
   */
  const READY_THEN_COUNT_SIGINTS =
    'const alive=setTimeout(()=>{},5000);let n=0;'
    + "process.on('SIGINT',()=>{if(++n===1)setTimeout(()=>{console.log('sigints='+n);clearTimeout(alive)},300)});"
    + 'console.log("ready")';

  const READY_THEN_RERAISE =
    "process.on('SIGINT',()=>{process.removeAllListeners('SIGINT');process.kill(process.pid,'SIGINT')});"
    + 'setTimeout(()=>{},5000);console.log("ready")';

  const READY_THEN_REPORT_SIGTERM =
    'const alive=setTimeout(()=>{},5000);'
    + "process.on('SIGTERM',()=>{console.log('sigterm');clearTimeout(alive)});"
    + 'console.log("ready")';

  it.skipIf(process.platform === 'win32')('delivers a terminal Ctrl+C to the command exactly once', async () => {
    const { out, err, code, signal } = await signalled(READY_THEN_COUNT_SIGINTS, groupCtrlC);

    // `sigints=2` is the failure this guards: the wrapper re-sending a signal the group already delivered
    expect(out, `stderr: ${err}`).toContain('sigints=1');
    expect({ code, signal }, 'the command chose its own exit, so neither it nor the wrapper died by signal')
      .toEqual({ code: 0, signal: null });
  });

  it.skipIf(process.platform === 'win32')('exits the way a signalled command did', async () => {
    const { signal, err } = await signalled(READY_THEN_RERAISE, groupCtrlC);

    expect(signal, `stderr: ${err}`).toBe('SIGINT');
  });

  /**
   * SIGTERM is never terminal-generated, so one aimed at the wrapper alone does not reach the command
   * in its group: the wrapper forwards it. Signalling the process rather than the group is what tells
   * the two paths apart — absorbing SIGTERM the way SIGINT is absorbed would leave the command running.
   */
  it.skipIf(process.platform === 'win32')('forwards a SIGTERM aimed at the wrapper alone to the command', async () => {
    const { out, err, code } = await signalled(READY_THEN_REPORT_SIGTERM, (child) => { child.kill('SIGTERM'); });

    expect(out, `stderr: ${err}`).toContain('sigterm');
    expect(code).toBe(0);
  });
});
