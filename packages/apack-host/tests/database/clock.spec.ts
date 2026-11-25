// Driving EARS through `@apackdev/clock`: wall timestamps and generated ids follow `clock.now()` (clamped against
// backward jumps), watch pacing and `caughtUp()` follow `clock.monotonic()` + `clock.after()` (unaffected by wall jumps
// and suspended spans), and closing the database before closing the clock cancels every waiting timer without throwing.
import * as path from 'node:path';
import { ClockController } from '@apackdev/clock';
import { TestClock } from '@apackdev/clock/testing';
import { defineEars, type UntypedSchema } from '@elmdb/ears';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseStore, openRunHistory } from '../../src/database/open.ts';
import { removeTempDirs, tempDir } from './fixtures.ts';

afterEach(removeTempDirs);

const taskSchema = {
  getRegisteredEntityTypes: () => new Set(['Task']),
  getRegisteredRelationKinds: () => new Set<string>(),
  getRegisteredRoles: () => new Set<string>(),
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('driving EARS with @apackdev/clock', () => {
  it('separates wall timestamps and ids from monotonic watch gaps across wall jumps and suspend/resume', async () => {
    const startWall = 1_700_000_000_000;
    const testClock = new TestClock({ wall: startWall });
    const { database, engine } = openDatabaseStore({
      path: path.join(tempDir('ears-clock-'), 'db'),
      schema: taskSchema,
      clock: testClock.clock,
    });
    try {
      const typed = defineEars<UntypedSchema & { names: 'Task' }>(() => engine);
      const deliveries: number[] = [];
      const watching = engine.watch(
        () => engine.query('Task').ids().length,
        (count) => { deliveries.push(count); },
      );

      // Initial delivery runs on a microtask
      await flushMicrotasks();
      expect(deliveries).toEqual([0]);

      // `engine.now()`, `typed.now()`, `typed.newId()`, and `createdAt` all follow `wall`
      expect(engine.now()).toBe(startWall);
      expect(typed.now()).toBe(startWall);
      const mintedId = typed.newId('Task');
      expect(mintedId.startsWith(`Task-${startWall.toString(36)}`)).toBe(true);

      // Jumping wall +10 s updates `now()`, `newId()`, and `createdAt` without bypassing the 16 ms monotonic watch gap
      const jumpedWall = startWall + 10_000;
      testClock.setWall(jumpedWall);
      const firstId = engine.create('Task', { id: mintedId, title: 'first' }).id();
      expect(engine.getRow(firstId)?.createdAt).toBe(jumpedWall);
      expect(typed.newId('Task').startsWith(`Task-${jumpedWall.toString(36)}`)).toBe(true);

      // Backward wall jump is clamped by `@apackdev/clock`
      testClock.setWall(startWall + 5_000);
      const secondId = engine.create('Task', { title: 'second' }).id();
      expect(engine.getRow(secondId)?.createdAt).toBe(jumpedWall);

      await flushMicrotasks();
      expect(deliveries).toEqual([0]);

      // 8 ms of active monotonic time is not enough for the default 16 ms minimum watch gap
      await testClock.advance(8);
      expect(deliveries).toEqual([0]);

      // Suspended time is excluded from monotonic watch pacing
      testClock.suspend();
      await testClock.advance(2_000);
      testClock.resume();
      expect(deliveries).toEqual([0]);

      // Still 8 ms remaining on the active monotonic timeline
      await testClock.advance(7);
      expect(deliveries).toEqual([0]);

      // The final 1 ms fires the watch and settles `caughtUp()`
      const caught = watching.caughtUp();
      await testClock.advance(1);
      await caught;
      expect(deliveries).toEqual([0, 2]);

      watching.stop();
    } finally {
      database.close();
      expect(testClock.waiting()).toBe(0);
      testClock.close();
    }
  });

  it('disarms watch timers on stop() and tears down cleanly when database closes before the clock', async () => {
    const testClock = new TestClock({ wall: 1_700_000_000_000 });
    const { database, engine } = openDatabaseStore({
      path: path.join(tempDir('ears-clock-close-'), 'db'),
      schema: taskSchema,
      clock: testClock.clock,
    });
    const deliveries: number[] = [];
    const watching = engine.watch(
      () => engine.query('Task').ids().length,
      (count) => { deliveries.push(count); },
    );
    await flushMicrotasks();
    expect(deliveries).toEqual([0]);

    // Write during the 16 ms post-delivery gap arms a timer on `testClock`
    engine.create('Task', { title: 'pending-watch' });
    await flushMicrotasks();
    expect(testClock.waiting()).toBeGreaterThan(0);

    // Stopping the last watch immediately cancels the armed timer
    watching.stop();
    expect(testClock.waiting()).toBe(0);

    // Re-arm a second watch and close the database directly without stopping the watch:
    // advancing the clock sees the closed database and tears down with no delivery, and closing the clock never throws
    engine.watch(
      () => engine.query('Task').ids().length,
      (count) => { deliveries.push(count); },
    );
    await flushMicrotasks();
    engine.create('Task', { title: 'after-second-watch' });
    await flushMicrotasks();
    expect(testClock.waiting()).toBeGreaterThan(0);

    database.close();
    await testClock.advance(20);
    expect(deliveries).toEqual([0, 1]);
    expect(testClock.waiting()).toBe(0);
    expect(() => testClock.close()).not.toThrow();
  });

  it('drives openRunHistory with the supplied clock', () => {
    const testClock = new TestClock({ wall: 1_700_123_456_000 });
    const runs = openRunHistory(path.join(tempDir('runs-clock-'), 'runs'), { clock: testClock.clock });
    try {
      const id = runs.engine.create('RunNode', {
        kind: 'flow',
        label: 'test-flow',
        status: 'running',
        startedAt: testClock.clock.now(),
        rootId: 'root-1',
      }).id();
      expect(runs.engine.getRow(id)?.createdAt).toBe(1_700_123_456_000);
    } finally {
      runs.database.close();
      expect(testClock.waiting()).toBe(0);
      testClock.close();
    }
  });

  it('works with a live ClockController and leaves no timers after close', async () => {
    const controller = new ClockController();
    const { database, engine } = openDatabaseStore({
      path: path.join(tempDir('ears-live-clock-'), 'db'),
      schema: taskSchema,
      clock: controller.clock,
    });
    try {
      const counts: number[] = [];
      const watching = engine.watch(
        () => engine.query('Task').ids().length,
        (count) => { counts.push(count); },
      );
      await watching.caughtUp();
      engine.create('Task', { title: 'live' });
      await watching.caughtUp();
      expect(counts).toEqual([0, 1]);
      watching.stop();
    } finally {
      database.close();
      expect(controller.waiting()).toBe(0);
      controller.close();
    }
  });
});
