// Projections run in the unit of a write that changes what they derive from, and catch up on anything else from what
// the database says changed since each last read: what's derived commits with what caused it, a failure undoes both, a
// write to anything else doesn't run them, and nothing but a first run, a new version or an unknowable answer derives
// everything again.
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { EARS, EarsEngine } from '@apackdev/ears';
import { catchUpTestProjections, resetTestData, startTestRuntime, testPacks } from '../../src/testing/index.ts';
import { boundEars, untypedCreate, untypedQuery, untypedWrite } from '../../src/ears/index.ts';

startTestRuntime();

const applied: string[][] = [];
let rebuilds = 0;
let failing = false;
const projection: { from: string[]; version?: number; apply(ids: readonly string[]): void; rebuild(): void } = {
  from: ['Collection'],
  apply(ids) {
    if (failing) throw new Error('the projection failed');
    applied.push([...ids]);
  },
  rebuild() {
    if (failing) throw new Error('the projection failed');
    rebuilds++;
  },
};

beforeEach(async () => {
  resetTestData();
  applied.length = 0;
  rebuilds = 0;
  failing = false;
  delete projection.version;
  testPacks.projections.push({ name: 'test/feature/derived', projection });
  // Its first run, out of the way of what each case asks
  untypedCreate('Collection', { name: 'first' });
  await catchUpTestProjections();
  applied.length = 0;
  rebuilds = 0;
});
afterEach(async () => {
  failing = false;
  await catchUpTestProjections();
  testPacks.projections.length = 0;
});

const engine = () => boundEars() as EarsEngine;
const aCollection = () => untypedCreate('Collection', { name: 'c' }).id() as EARS.EntityId;
const everyApplied = () => applied.flat();

it('derives everything on its first run, and only what changed after', async () => {
  testPacks.projections.push({ name: 'test/feature/fresh', projection: { ...projection, rebuild: () => { rebuilds += 10; } } });
  const second = aCollection();
  expect(rebuilds, 'a write applies its own, and leaves a first run to a catch-up').toBe(0);
  await catchUpTestProjections();
  expect(rebuilds).toBe(10);
  applied.length = 0;
  untypedWrite(second).set('name', 'renamed');
  expect(applied).toEqual([[second], [second]]);
});

it('applies in the write what the write changed, and nothing for a write to anything else', () => {
  const second = aCollection();
  expect(applied).toEqual([[second]]);
  untypedCreate('Flow', { label: 'f', flowType: 'root' });
  expect(applied).toEqual([[second]]);
  expect(rebuilds).toBe(0);
});

it('undoes the write when it fails', () => {
  failing = true;
  expect(() => aCollection()).toThrow('the projection failed');
  expect(untypedQuery('Collection').count()).toBe(1);
});

it('has nothing to catch up on after writes it ran in', async () => {
  aCollection();
  aCollection();
  applied.length = 0;
  await catchUpTestProjections();
  expect([rebuilds, applied.length]).toEqual([0, 0]);
});

it('applies a write it never saw, an admin load, without deriving everything', async () => {
  const loaded = 'Collection-loaded' as EARS.EntityId;
  engine().admin.bulkLoadAttr(loaded, 'name' as EARS.AttrKind, 'loaded');
  expect(applied, 'no hook sees a load').toEqual([]);
  await catchUpTestProjections();
  expect([rebuilds, everyApplied()]).toEqual([0, [loaded]]);
});

it('catches up on a backlog in chunks, and a write behind one applies only its own', async () => {
  engine().admin.transactWithoutHook(() => {
    for (let i = 0; i < 1200; i++) untypedCreate('Collection', { name: `backlog ${i}` });
  });
  const mine = aCollection();
  expect(applied, 'its own, the backlog left to the catch-up').toEqual([[mine]]);
  applied.length = 0;
  await catchUpTestProjections();
  expect(rebuilds).toBe(0);
  expect(applied.every((chunk) => chunk.length <= 500), 'no unit applies more than a chunk').toBe(true);
  expect(new Set(everyApplied()).size).toBe(1201);
});

it('derives everything again when its version changes', async () => {
  projection.version = 2;
  await catchUpTestProjections();
  expect(rebuilds).toBe(1);
  await catchUpTestProjections();
  expect(rebuilds, 'once').toBe(1);
});

it('hears a relation at either end, and a destroy', async () => {
  const [a, b] = [aCollection(), aCollection()];
  applied.length = 0;
  engine().admin.transactWithoutHook(() => { untypedWrite(a).link('parent_of' as EARS.RelKind, b); });
  await catchUpTestProjections();
  expect(everyApplied().sort()).toEqual([a, b].sort());
  applied.length = 0;
  engine().admin.transactWithoutHook(() => { untypedWrite(b).destroy(); });
  await catchUpTestProjections();
  expect(everyApplied()).toContain(b);
});

it('keeps catching up the others when one fails, and its cursor where it was', async () => {
  const other = { ...projection, apply: () => { rebuilds += 10; } };
  testPacks.projections.push({ name: 'test/feature/other', projection: other });
  failing = true;
  engine().admin.transactWithoutHook(() => { aCollection(); });
  await expect(catchUpTestProjections()).resolves.toBeUndefined();
  failing = false;
  rebuilds = 0;
  applied.length = 0;
  await catchUpTestProjections();
  expect(applied.length, 'the one that failed still had it to apply').toBe(1);
});
