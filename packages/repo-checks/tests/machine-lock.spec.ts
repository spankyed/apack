import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MACHINE_LOCK, MACHINE_WAIT_MS, MachineLockRefused, UNRESOLVED_WAIT_MS, expensiveSteps } from '../../../scripts/lib/machine-lock.ts';

const EXPENSIVE = { expensive: true, name: 'test:integration', dependsOn: [] } as const;
const CHEAP = { name: 'lint:check', dependsOn: [] } as const;

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-lock-'));
  file = path.join(dir, 'expensive.lock');
});
afterEach(() => {
  fs.chmodSync(dir, 0o700);
  fs.rmSync(dir, { recursive: true, force: true });
});

const lockAs = (fields: { pid?: number; machine?: string; what?: string }): void => {
  fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, machine: os.hostname(), what: 'npm run chain in /a/checkout', since: new Date().toISOString(), ...fields }));
};

describe('where the lock lives', () => {
  it('is under the home directory, since TMPDIR differs between two shells on one machine', () => {
    expect(MACHINE_LOCK.startsWith(`${os.homedir()}${path.sep}`)).toBe(true);
    expect(MACHINE_LOCK.startsWith(os.tmpdir())).toBe(false);
  });
});

describe('a chain\'s steps', () => {
  it('leave a cheap step alone', () => {
    const lock = expensiveSteps({ what: 'a chain', file });
    expect(lock.admit(CHEAP)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    lock.leave(CHEAP);
  });

  it('share one hold, which goes back when the last leaves', () => {
    const lock = expensiveSteps({ what: 'a chain', file });
    expect(lock.admit(EXPENSIVE)).toBe(true);
    expect(lock.admit(EXPENSIVE)).toBe(true);
    lock.leave(EXPENSIVE);
    expect(fs.existsSync(file)).toBe(true);
    lock.leave(EXPENSIVE);
    expect(fs.existsSync(file)).toBe(false);
    expect(lock.admit(EXPENSIVE)).toBe(true);
    lock.leave(EXPENSIVE);
  });
});

describe('another chain\'s hold', () => {
  it('turns a step away, says who holds it and where, once, and lets it in when it ends', () => {
    lockAs({});
    const told: string[] = [];
    const lock = expensiveSteps({ what: 'this chain', file, onWait: (holder) => told.push(holder) });
    expect(lock.admit(EXPENSIVE)).toBe(false);
    expect(lock.admit(EXPENSIVE)).toBe(false);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('npm run chain in /a/checkout');
    expect(told[0]).toContain(file);
    fs.rmSync(file);
    expect(lock.admit(EXPENSIVE)).toBe(true);
    lock.leave(EXPENSIVE);
  });

  it('is waited for as long as a step can run, and then refused, naming the file', () => {
    lockAs({});
    let at = 0;
    const lock = expensiveSteps({ what: 'this chain', file, now: () => at });
    expect(lock.admit(EXPENSIVE)).toBe(false);
    at = MACHINE_WAIT_MS - 1;
    expect(lock.admit(EXPENSIVE)).toBe(false);
    at = MACHINE_WAIT_MS;
    expect(() => lock.admit(EXPENSIVE)).toThrow(MachineLockRefused);
    expect(() => lock.admit(EXPENSIVE)).toThrow(file);
  });

  it('is taken over once its holder has died', () => {
    lockAs({ pid: 2 ** 22 + 1 });
    const lock = expensiveSteps({ what: 'this chain', file });
    expect(lock.admit(EXPENSIVE)).toBe(true);
    lock.leave(EXPENSIVE);
  });
});

describe('a lock nothing can resolve', () => {
  it.each([
    ['unreadable', () => { fs.writeFileSync(file, ''); }],
    ['naming another machine', () => { lockAs({ machine: 'elsewhere.local' }); }],
    ['naming this process, which holds none', () => { lockAs({ pid: process.pid }); }],
  ])('is refused soon rather than waited on: %s', (_what, leave) => {
    leave();
    let at = 0;
    const lock = expensiveSteps({ what: 'this chain', file, now: () => at });
    expect(lock.admit(EXPENSIVE)).toBe(false);
    at = UNRESOLVED_WAIT_MS - 1;
    expect(lock.admit(EXPENSIVE)).toBe(false);
    at = UNRESOLVED_WAIT_MS;
    expect(() => lock.admit(EXPENSIVE)).toThrow(MachineLockRefused);
  });
});

describe('an error that isn\'t the lock being held', () => {
  it('surfaces as itself instead of being waited on', () => {
    fs.chmodSync(dir, 0o500);
    const lock = expensiveSteps({ what: 'this chain', file });
    expect(() => lock.admit(EXPENSIVE)).toThrow(/EACCES|permission/i);
  });
});
