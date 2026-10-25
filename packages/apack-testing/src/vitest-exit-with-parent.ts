/**
 * A vitest setup file: a worker exits when the vitest process that started it is gone.
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
 * Every host package's config lists it, and a pack's has it through `isolatedDataDir()` (`definePackTestConfig`). A
 * worker loads it once per file, so it installs its listener once.
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
}
