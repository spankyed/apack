// admin.calls: what a stretch of work cost in crossings to the database, by kind and by the code that made each call.
// Each case reads the counts a measurement would, and the site is checked to name this file, since a site that named
// the engine's own modules would attribute every call to the engine.
import { beforeEach, describe, expect, it } from 'vitest';
import { engine } from './helpers.ts';
import type { EngineUnderTest } from './engine-under-test.ts';
import type { CallKind, CallSite } from '../../src/index.ts';
import { callSite } from '../../src/calls.ts';

let e: EngineUnderTest;
beforeEach(() => { e = engine(); });

const THIS_FILE = 'tests/engine/calls.spec.ts';
const sitesOf = (kind: CallKind, sites: CallSite[]) => sites.filter((site) => site.kind === kind);

describe('admin.calls', () => {
  it.each([
    { format: 'Windows source', internal: String.raw`D:\repo\packages\apack-ears\src\calls.ts`, caller: String.raw`D:\repo\packages\app\src\feature.ts` },
    { format: 'Windows installed package', internal: String.raw`C:\repo\node_modules\@apackdev\ears\dist\calls.js`, caller: String.raw`C:\repo\packages\app\src\feature.ts` },
    { format: 'file URLs', internal: 'file:///C:/some%20folder/packages/apack-ears/src/calls.ts', caller: 'file:///C:/some%20folder/packages/app/src/feature.ts' },
  ])('attributes $format stacks to the caller, excluding engine and Node frames', ({ internal, caller }) => {
    const prepare = Error.prepareStackTrace, limit = Error.stackTraceLimit;
    try {
      Error.prepareStackTrace = () => [
        'Error', `    at callSite (${internal}:106:1)`, '    at processTick (node:internal/process/task_queues:1:1)',
        `    at feature (${caller}:12:3)`, `    at dispatch (${caller}:20:3)`, `    at start (${caller}:30:3)`,
        `    at ignored (${caller}:40:3)`,
      ].join('\n');
      expect(callSite()).toBe('packages/app/src/feature.ts:12 < packages/app/src/feature.ts:20 < packages/app/src/feature.ts:30');
      expect(Error.stackTraceLimit).toBe(limit);
    } finally { Error.prepareStackTrace = prepare; Error.stackTraceLimit = limit; }
  });
  it('counts nothing until started, and nothing after it stops', () => {
    e.create('Task', { title: 'before' });
    e.query('Task').ids();
    expect(e.admin.calls.report()).toMatchObject({ counting: false, sites: [], totals: { read: { calls: 0 }, write: { calls: 0 }, unit: { calls: 0 } } });

    e.admin.calls.start();
    e.query('Task').ids();
    const stopped = e.admin.calls.stop();
    expect(stopped.totals.read.calls).toBe(1);
    e.query('Task').ids();
    e.create('Task', { title: 'after' });
    expect(e.admin.calls.report()).toEqual(stopped);
  });

  it('counts a read, a write outside a unit and a unit with its writes, each at the code that made it', () => {
    e.admin.calls.start();
    e.query('Task').ids();
    e.create('Task', { title: 'one' });
    e.transact(() => {
      e.create('Task', { title: 'two' });
      e.transact(() => { e.create('Task', { title: 'three' }); });
    });
    const report = e.admin.calls.stop();

    expect(report.totals.read).toMatchObject({ calls: 1, ops: 1 });
    expect(report.totals.write).toMatchObject({ calls: 1 });
    // The nested level is a savepoint of the outer unit: one unit, holding both writes
    expect(report.totals.unit).toMatchObject({ calls: 1 });
    expect(sitesOf('unit', report.sites)).toEqual([expect.objectContaining({ calls: 1, writes: 2 })]);
    for (const site of report.sites) {
      expect(site.site.split(' < ')[0]).toContain(THIS_FILE);
      expect(site.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('sums repeated calls from one line into one site, which is what a loop of one-entity reads looks like', () => {
    const ids = Array.from({ length: 5 }, (_, i) => e.create('Task', { title: `t${i}` }).id());
    e.admin.calls.start();
    for (const id of ids) e.getRow(id);
    const reads = sitesOf('read', e.admin.calls.stop().sites);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ calls: 5, watch: false });
  });

  it('counts no unit for a transact that wrote nothing, and counts one that threw with what it wrote', () => {
    e.admin.calls.start();
    e.transact(() => e.query('Task').ids());
    expect(() => e.transact(() => {
      e.create('Task', { title: 'undone' });
      throw new Error('stop');
    })).toThrow('stop');
    const report = e.admin.calls.stop();
    expect(report.totals.unit).toMatchObject({ calls: 1 });
    expect(sitesOf('unit', report.sites)[0]).toMatchObject({ writes: 1 });
    expect(report.totals.read.calls).toBe(1);
  });

  it("counts a watch's runs, and marks the reads a re-run made", async () => {
    const watching = e.watch(() => e.query('Task').ids(), () => {});
    await e.admin.watchesSettled();
    e.admin.calls.start();
    e.create('Task', { title: 'touches the watch' });
    await e.admin.watchesSettled();
    const report = e.admin.calls.stop();
    watching.stop();
    expect(report.totals.watchRuns.calls).toBe(1);
    expect(sitesOf('read', report.sites)).toEqual([expect.objectContaining({ watch: true, calls: 1 })]);
  });

  it('starts from nothing each time', () => {
    e.admin.calls.start();
    e.query('Task').ids();
    e.admin.calls.start();
    expect(e.admin.calls.report()).toMatchObject({ counting: true, sites: [], totals: { read: { calls: 0 } } });
    e.admin.calls.stop();
  });
});
