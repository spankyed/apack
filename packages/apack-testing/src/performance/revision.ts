import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { createPerformanceRevisionJournal, type PerformanceVariant } from './comparison.ts';

/** The runner supplies actual child-close results; no lock file or heartbeat stands in for process state. */
export interface PerformanceRevisionWorkers { A?: { code: number }; B?: { code: number } }

/** Grant one trial at a time and retain observed order; workers write raw data and close independently. */
export async function coordinatePerformanceRevisions(options: {
  directory: string;
  mode: 'disabled' | 'lightweight' | 'detailed';
  measured: number;
  deadline: number;
  workers(): PerformanceRevisionWorkers;
}) {
  if (!Number.isFinite(options.deadline) || options.deadline <= 0) throw Error('Invalid revision deadline');
  const journal = createPerformanceRevisionJournal(options.directory, options.mode, options.measured);
  const marker = z.object({ index: z.number().int().nonnegative(), mode: z.literal(options.mode) });
  async function wait(variant: PerformanceVariant, name: string) {
    const file = path.join(options.directory, 'coordination', variant, name);
    while (true) {
      const workers = options.workers();
      if (Object.values(workers).some(worker => worker.code !== 0)) throw Error('Revision worker failed');
      if (Date.now() >= options.deadline) throw Error('Revision comparison deadline expired');
      if (existsSync(file)) {
        const info = lstatSync(file);
        if (!info.isFile() || info.size > 4096) throw Error('Invalid revision worker marker');
        return JSON.parse(readFileSync(file, 'utf8'));
      }
      if (workers[variant]) throw Error('Revision worker exited before completing its protocol');
      await delay(20);
    }
  }
  try {
    for (const entry of journal.schedule) {
      const own = path.join(options.directory, 'coordination', entry.variant);
      const ready = marker.parse(await wait(entry.variant, `ready-${entry.index}.json`));
      if (ready.index !== entry.index || existsSync(path.join(own, `done-${entry.index}.json`))) throw Error('Revision action completed before permission');
      journal.begin(entry);
      writeFileSync(path.join(own, `permit-${entry.index}.json`), JSON.stringify({ index: entry.index, mode: entry.mode }), { flag: 'wx' });
      const done = marker.extend({ outcome: z.enum(['passed', 'failed', 'incomplete', 'cancelled']) }).parse(await wait(entry.variant, `done-${entry.index}.json`));
      if (done.index !== entry.index) throw Error('Revision completion differs from scheduled action');
      journal.end(entry, done.outcome);
      if (done.outcome !== 'passed') throw Error('Revision action failed or capture was incomplete');
    }
    for (const variant of ['A', 'B']) writeFileSync(path.join(options.directory, 'coordination', variant, 'release.json'), JSON.stringify({ released: true }), { flag: 'wx' });
  } catch (error) { journal.fail(); throw error; }
}
