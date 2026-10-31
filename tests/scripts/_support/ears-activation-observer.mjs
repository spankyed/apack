// Diagnostic preload: observes ordinary methods without changing SQL, arguments or results.
import { Session } from 'node:inspector';
import { renameSync, writeFileSync } from 'node:fs';
import { SqliteDatabase } from '../../../packages/apack-ears/src/sqlite/database.ts';

const output = process.env.EARS_ACTIVATION_REPORT;
if (!output) throw Error('EARS_ACTIVATION_REPORT is required');
const publish = value => {
  writeFileSync(output + '.next', JSON.stringify(value, null, 2));
  renameSync(output + '.next', output);
};
const profiler = new Session();
const post = (method, parameters = {}) => new Promise((resolve, reject) => {
  profiler.post(method, parameters, (error, value) => error ? reject(error) : resolve(value));
});
let active = false, started, cpu;
let stats = new Map();
for (const name of ['setSchema', 'commitWrite', 'write', 'batch', 'run', 'get', 'all', 'finish']) {
  const original = SqliteDatabase.prototype[name];
  if (typeof original !== 'function') throw Error(`Missing observed method: ${name}`);
  SqliteDatabase.prototype[name] = function (...args) {
    if (!active) return original.apply(this, args);
    const at = performance.now();
    const store = this.path?.includes('run-history') ? 'runs' :
      this.path?.endsWith('/ears-db') || this.path?.endsWith('/lmdb') ? 'primary' : 'other';
    const shape = ['run', 'get', 'all'].includes(name) ? String(args[0]).trim().split(/\s+/).slice(0, 3).join(' ') : '';
    try { return original.apply(this, args); }
    finally {
      const ms = performance.now() - at, key = `${store}:${name}${shape ? ':' + shape : ''}`;
      const held = stats.get(key) ?? { key, count: 0, totalMs: 0, maxMs: 0 };
      held.count++; held.totalMs += ms; held.maxMs = Math.max(held.maxMs, ms); stats.set(key, held);
    }
  };
}

async function signal() {
  if (!active) {
    profiler.connect();
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 1000 });
    await post('Profiler.start');
    stats = new Map(); started = performance.now(); cpu = process.cpuUsage(); active = true;
    publish({ state: 'active', pid: process.pid });
  } else {
    active = false;
    const wallMs = performance.now() - started, cpuMicroseconds = process.cpuUsage(cpu);
    try {
      const { profile } = await post('Profiler.stop');
      writeFileSync(output + '.cpuprofile', JSON.stringify(profile));
      publish({ state: 'complete', pid: process.pid, wallMs, cpuMicroseconds,
        profileKind: 'V8 sampled stack time; not a syscall/CPU-wait decomposition; SQL method spans overlap',
        stats: [...stats.values()].sort((a, b) => b.totalMs - a.totalMs) });
    } finally { profiler.disconnect(); }
  }
}
process.on('SIGUSR2', () => {
  void signal().catch(error => {
    try { profiler.disconnect(); } catch { /* A failed connect need not have a session. */ }
    publish({ state: 'failed', message: error.message, stack: error.stack });
  });
});
