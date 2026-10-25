/**
 * A vitest setup file: a worker exits when the vitest process that started it is gone, and runs its exit handlers when
 * vitest stops it.
 *
 * Vitest runs test files in forked workers (tinypool's `child_process` runtime), and nothing in them watches
 * their parent. When the main process dies — on "Worker exited unexpectedly", after one worker aborted in
 * native code — the rest are reparented to init and go on running whatever file they were in, holding its
 * memory and CPU until someone kills them. A normal shutdown never reaches this: tinypool stops a worker with
 * SIGTERM, then SIGKILL. The IPC channel closes only when the parent has exited.
 *
 * A worker blocked in synchronous code sees the disconnect when it next turns its event loop, and one still
 * loading when its vitest died finds the channel already closed as this installs. What a launcher started is also
 * reaped by process group (`scripts/lib/bounded-spawn.ts`); this covers a vitest started any other way.
 *
 * Tinypool stops a worker with SIGTERM, which Node's default answers by dying without its `exit` handlers or its native
 * modules' cleanup hooks: a database a spec's temporary runtime holds is never closed, and on macOS each one left open
 * keeps its LMDB lock's named semaphores until the machine restarts, in a table that fills. A worker told to stop
 * exits instead, through those handlers.
 *
 * Every host package's config lists it, and a pack's has it through `isolatedDataDir()` (`definePackTestConfig`). A
 * worker loads it once per file, so it installs its listeners once.
 */
const INSTALLED = Symbol.for('apack.vitest.exitWithParent');
const state = globalThis as { [INSTALLED]?: true };

// Absent in a thread worker, which dies with its process anyway
if (process.send !== undefined && state[INSTALLED] === undefined) {
  state[INSTALLED] = true;
  // A signal, because vitest replaces `process.exit` in a worker with one that throws
  const exit = () => process.kill(process.pid, 'SIGKILL');
  // A `disconnect` that came before this listener is not heard again
  if (process.connected) process.once('disconnect', exit);
  else exit();
  // Between files, where vitest has put back the `process.exit` it replaces while a test runs
  process.once('SIGTERM', () => process.exit(143));
}
