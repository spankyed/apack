// Projections run in the unit of a write that changes what they derive from, and catch up on anything else from what
// the database says changed since each last read: what's derived commits with what caused it, a failure undoes both, a
// write to anything else doesn't run them, and nothing but a first run, a new version or an unknowable answer derives
// everything again, a chunk per unit like any backlog.
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { EARS, EarsEngine } from '@apackdev/ears';
import { catchUpTestProjections, resetTestData, startTestRuntime, testPacks } from '../../src/testing/index.ts';
import { boundEars, untypedCreate, untypedQuery, untypedWrite } from '../../src/ears/index.ts';
import { SDK_ROW_RULES } from '../../src/types/sdk-entities.ts';

// A projection derives from a type kept in change order, which the type's owner declares: here, over the SDK's own
startTestRuntime({ rowRules: { Collection: { ...SDK_ROW_RULES.Collection, changeOrder: true } } });

const applied: string[][] = [];
let resets = 0;
let failing = false;
const projection: { from: string[]; version?: number; apply(ids: readonly string[]): void; reset(): void } = {
  from: ['Collection'],
  apply(ids) {
    if (failing) throw new Error('the projection failed');
    applied.push([...ids]);
  },
  reset() {
    if (failing) throw new Error('the projection failed');
    resets++;
  },
};

beforeEach(async () => {
  resetTestData();
  applied.length = 0;
  resets = 0;
  failing = false;
  delete projection.version;
  testPacks.projections.push({ name: 'test/feature/derived', projection });
  // Its first run, out of the way of what each case asks
  untypedCreate('Collection', { name: 'first' });
  await catchUpTestProjections();
  applied.length = 0;
  resets = 0;
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
  const fresh: string[] = [];
  testPacks.projections.push({ name: 'test/feature/fresh', projection: { ...projection, apply: (ids) => { fresh.push(...ids); }, reset: () => { resets += 10; } } });
  const second = aCollection();
  expect(resets, 'a write applies its own, and leaves a first run to a catch-up').toBe(0);
  await catchUpTestProjections();
  expect(resets).toBe(10);
  expect(new Set(fresh), 'every one, the first included').toEqual(new Set(untypedQuery('Collection').ids()));
  applied.length = 0;
  untypedWrite(second).set('name', 'renamed');
  expect(applied).toEqual([[second]]);
});

it('derives everything again a chunk per unit, and a write meanwhile applies its own and is met again', async () => {
  engine().admin.transactWithoutHook(() => {
    for (let i = 0; i < 1200; i++) untypedCreate('Collection', { name: `held ${i}` });
  });
  await catchUpTestProjections();
  projection.version = 2;
  applied.length = 0;
  const passing = catchUpTestProjections();
  const mine = aCollection();
  await passing;
  await catchUpTestProjections();
  expect(resets).toBe(1);
  expect(applied.every((chunk) => chunk.length <= 500), 'no unit applies more than a chunk').toBe(true);
  expect(new Set(everyApplied()), 'every one, and the write made during it').toEqual(new Set(untypedQuery('Collection').ids()));
  expect(everyApplied().filter((id) => id === mine).length, 'by the write, and again by the pass').toBeGreaterThanOrEqual(2);
});

it('applies, once through a pass, what changed during it: a destroy of one it had already derived included', async () => {
  engine().admin.transactWithoutHook(() => {
    for (let i = 0; i < 1200; i++) untypedCreate('Collection', { name: `held ${i}` });
  });
  await catchUpTestProjections();
  const [earliest] = [...untypedQuery('Collection').ids()] as EARS.EntityId[];
  projection.version = 2;
  applied.length = 0;
  const passing = catchUpTestProjections();
  // The pass's first unit resets, and its next applies the earliest chunk, before this runs
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(everyApplied(), 'already derived by the pass').toContain(earliest);
  const before = applied.length;
  engine().admin.transactWithoutHook(() => { untypedWrite(earliest).destroy(); });
  await passing;
  await catchUpTestProjections();
  expect(applied.slice(before).flat(), 'its destroy, after the pass').toContain(earliest);
});

it('reaches the end of a pass once when it writes the type it derives from, applying each once', async () => {
  engine().admin.transactWithoutHook(() => {
    for (let i = 0; i < 1200; i++) untypedCreate('Collection', { name: `held ${i}` });
  });
  await catchUpTestProjections();
  const count = untypedQuery('Collection').count();
  const writing: string[] = [];
  const rewriting = {
    from: ['Collection'],
    // What it derives is written back onto what it derives from, as notes write a note's link targets
    apply(ids: readonly string[]) {
      writing.push(...ids);
      if (writing.length > 3 * count) throw new Error('meeting its own writes again');
      for (const id of ids) untypedWrite(id as EARS.EntityId).set('description', 'derived');
    },
  };
  testPacks.projections.push({ name: 'test/feature/rewriting', projection: rewriting });
  await catchUpTestProjections();
  expect(writing.length, 'each once').toBe(count);
  writing.length = 0;
  await catchUpTestProjections();
  expect(writing, 'and nothing after').toEqual([]);
});

it('applies in the write what the write changed, and nothing for a write to anything else', () => {
  const second = aCollection();
  expect(applied).toEqual([[second]]);
  untypedCreate('Flow', { label: 'f', flowType: 'root' });
  expect(applied).toEqual([[second]]);
  expect(resets).toBe(0);
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
  expect([resets, applied.length]).toEqual([0, 0]);
});

it('applies a write it never saw, an admin load, without deriving everything', async () => {
  const loaded = 'Collection-loaded' as EARS.EntityId;
  engine().admin.bulkLoadAttr(loaded, 'name' as EARS.AttrKind, 'loaded');
  expect(applied, 'no hook sees a load').toEqual([]);
  await catchUpTestProjections();
  expect([resets, everyApplied()]).toEqual([0, [loaded]]);
});

it('catches up on a backlog in chunks, and a write behind one applies only its own', async () => {
  engine().admin.transactWithoutHook(() => {
    for (let i = 0; i < 1200; i++) untypedCreate('Collection', { name: `backlog ${i}` });
  });
  const mine = aCollection();
  expect(applied, 'its own, the backlog left to the catch-up').toEqual([[mine]]);
  applied.length = 0;
  await catchUpTestProjections();
  expect(resets).toBe(0);
  expect(applied.every((chunk) => chunk.length <= 500), 'no unit applies more than a chunk').toBe(true);
  expect(new Set(everyApplied()).size).toBe(1201);
});

it('derives everything again when its version changes', async () => {
  projection.version = 2;
  await catchUpTestProjections();
  expect(resets).toBe(1);
  expect(everyApplied(), 'every one again').toEqual([...untypedQuery('Collection').ids()]);
  applied.length = 0;
  await catchUpTestProjections();
  expect([resets, applied.length], 'once').toEqual([1, 0]);
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
  const other = { ...projection, apply: () => {} };
  testPacks.projections.push({ name: 'test/feature/other', projection: other });
  failing = true;
  engine().admin.transactWithoutHook(() => { aCollection(); });
  await expect(catchUpTestProjections()).resolves.toBeUndefined();
  failing = false;
  applied.length = 0;
  await catchUpTestProjections();
  expect(applied.length, 'the one that failed still had it to apply').toBe(1);
});
