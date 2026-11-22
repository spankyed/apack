// What each chain step cost the last few times it passed here: the window `--dry` and a failure report read.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEPT_RUNS } from '../../../scripts/lib/spec-durations.ts';
import {
  readStepSeconds, recordStepDurations, stepDurationsFile, UNREAD_STEP_SECONDS, withRecordedSeconds,
} from '../../../scripts/lib/step-durations.ts';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-step-durations-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('the step-duration window', () => {
  it('reads nothing where no run has recorded', () => {
    expect(readStepSeconds(root).size).toBe(0);
  });

  it('answers the median of each step across the runs that measured it', () => {
    recordStepDurations(root, new Map([['typecheck:sdk', 4_000], ['test:smoke', 20_000]]));
    recordStepDurations(root, new Map([['typecheck:sdk', 6_000]]));
    recordStepDurations(root, new Map([['typecheck:sdk', 30_000], ['test:smoke', 10_000]]));

    const seconds = readStepSeconds(root);
    expect(seconds.get('typecheck:sdk'), 'one slow run does not move a median of three').toBe(6);
    expect(seconds.get('test:smoke'), 'an even count takes the mean of the middle two').toBe(15);
  });

  it('keeps only the newest runs, so an old cost stops describing the step', () => {
    recordStepDurations(root, new Map([['lint:check', 99_000]]));
    for (let run = 0; run < KEPT_RUNS; run += 1) recordStepDurations(root, new Map([['lint:check', 1_000]]));
    expect(readStepSeconds(root).get('lint:check')).toBe(1);
  });

  it('reads a damaged window as no evidence rather than throwing', () => {
    fs.mkdirSync(path.dirname(stepDurationsFile(root)), { recursive: true });
    fs.writeFileSync(stepDurationsFile(root), '{ not json');
    expect(readStepSeconds(root).size).toBe(0);
    recordStepDurations(root, new Map([['lint:check', 2_000]]));
    expect(readStepSeconds(root).get('lint:check'), 'and the next run starts a fresh window').toBe(2);
  });

  it('writes nothing for a run that measured nothing', () => {
    recordStepDurations(root, new Map());
    expect(fs.existsSync(stepDurationsFile(root))).toBe(false);
  });
});

describe('withRecordedSeconds', () => {
  it('costs a step with no reading at the neutral figure, and names it', () => {
    const { steps, unread } = withRecordedSeconds(
      [{ name: 'read', dependsOn: [] }, { name: 'unread', dependsOn: [] }],
      new Map([['read', 3]]),
    );
    expect(steps.map((step) => step.seconds)).toEqual([3, UNREAD_STEP_SECONDS]);
    expect(unread).toEqual(['unread']);
  });
});
