// What the host's opens of an elmdb database do beyond opening it: rebuild its indexes once, where an older elmdb may
// have built them, and say what the open found restored. A restore needs a power loss to make, so the database's
// report is stood in for; everything else is a real database on disk
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EarsDatabase, OpenReport } from '@apackdev/ears';
import { openRunHistory, type RunsDatabase } from '../../src/database/open.ts';

const fake = vi.hoisted(() => ({
  report: undefined as Partial<OpenReport> | undefined,
  acknowledged: 0,
  acknowledgeFails: false,
  rebuilt: 0,
  warnings: [] as string[],
}));

vi.mock('@apackdev/ears/lmdb', async (importOriginal) => {
  const real = await importOriginal<typeof import('@apackdev/ears/lmdb')>();
  return {
    ...real,
    openDatabase: (options: Parameters<typeof real.openDatabase>[0]): EarsDatabase => new Proxy(real.openDatabase(options), {
      get(target, key) {
        if (key === 'openReport' && fake.report) return { ...target.openReport, ...fake.report };
        if (key === 'acknowledgeRestore') {
          return () => {
            if (fake.acknowledgeFails) throw new Error('the record could not be written');
            fake.acknowledged++;
          };
        }
        if (key === 'rebuild') return (...args: Parameters<EarsDatabase['rebuild']>) => { fake.rebuilt++; target.rebuild(...args); };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };
});

vi.mock('@apackdev/sdk/logger', async (importOriginal) => {
  const real = await importOriginal<typeof import('@apackdev/sdk/logger')>();
  return {
    ...real,
    createLogger: (source?: string, options?: Parameters<typeof real.createLogger>[1]) => source === 'database'
      ? { debug: () => {}, info: () => {}, warn: (message: string) => { fake.warnings.push(message); }, error: () => {} }
      : real.createLogger(source, options),
  };
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-open-'));
const open: RunsDatabase[] = [];
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => Object.assign(fake, { report: undefined, acknowledged: 0, acknowledgeFails: false, rebuilt: 0, warnings: [] }));
afterEach(() => { for (const runs of open.splice(0)) if (runs.database.isOpen) runs.database.close(); });

const dir = () => path.join(fs.mkdtempSync(path.join(root, 'case-')), 'run-history');
function opened(at: string, options: { readOnly?: boolean } = {}): RunsDatabase {
  const runs = openRunHistory(at, options);
  open.push(runs);
  return runs;
}
const closed = (runs: RunsDatabase) => runs.database.close();

describe('the indexes an older elmdb built', () => {
  it('are rebuilt at the first writable open, and not at the next', () => {
    const at = dir();
    const first = opened(at);
    expect(fake.rebuilt).toBe(1);
    const sequence = first.database.sequence;
    closed(first);

    const second = opened(at);
    expect(fake.rebuilt, 'the database says it was rebuilt by this elmdb').toBe(1);
    expect(second.database.sequence, 'and the open committed nothing').toBe(sequence);
  });

  it('are rebuilt again for a database whose mark names another elmdb', () => {
    const at = dir();
    const first = opened(at);
    const unit = first.database.begin();
    unit.setCheckpoint('apack:derived-data-of', new TextEncoder().encode('elmdb 4b67670'));
    unit.commit();
    closed(first);

    opened(at);
    expect(fake.rebuilt).toBe(2);
  });

  it('are left as they are by a read-only open, which writes nothing', () => {
    const at = dir();
    const first = opened(at);
    const unit = first.database.begin();
    unit.setCheckpoint('apack:derived-data-of', new TextEncoder().encode('elmdb 4b67670'));
    unit.commit();
    closed(first);

    opened(at, { readOnly: true });
    expect(fake.rebuilt).toBe(1);
  });
});

describe('a restore the open found', () => {
  it('is said, with the sequence the database was taken back to, and marked read by a writable open', () => {
    const at = dir();
    closed(opened(at));
    fake.report = { restored: { sequence: 41 } };
    opened(at);
    expect(fake.warnings).toEqual([expect.stringMatching(new RegExp(`${at.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} was taken back to its last synced commit, sequence 41: a power loss or a failed sync lost the commits made after it`))]);
    expect(fake.acknowledged).toBe(1);
  });

  it('is said each time by a read-only open, which cannot mark it read', () => {
    const at = dir();
    closed(opened(at));
    fake.report = { restored: { sequence: null } };
    closed(opened(at, { readOnly: true }));
    opened(at, { readOnly: true });
    expect(fake.warnings).toEqual([
      expect.stringMatching(/was taken back to its last synced commit: a power loss/),
      expect.stringMatching(/was taken back to its last synced commit: a power loss/),
    ]);
    expect(fake.acknowledged).toBe(0);
  });

  it('that cannot be marked read is said again at the next open, and the open goes on', () => {
    const at = dir();
    closed(opened(at));
    fake.report = { restored: { sequence: 7 } };
    fake.acknowledgeFails = true;
    const runs = opened(at);
    expect(runs.database.isOpen).toBe(true);
    expect(fake.warnings).toEqual([
      expect.stringMatching(/sequence 7/),
      expect.stringMatching(/couldn't be marked read \(the record could not be written\): the next open says it again/),
    ]);
  });

  it('is not said when there was none', () => {
    const at = dir();
    closed(opened(at));
    opened(at);
    expect(fake.warnings).toEqual([]);
    expect(fake.acknowledged).toBe(0);
  });

  it('beside a record naming another file is said too', () => {
    const at = dir();
    closed(opened(at));
    fake.report = { notBorneOut: true };
    opened(at);
    expect(fake.warnings).toEqual([expect.stringMatching(/isn't the file its record of the last sync names/)]);
  });
});
