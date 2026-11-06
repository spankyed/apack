// Projections run in the unit of a write that changes what they derive from: what's derived commits with what caused it,
// a failure undoes both, and a write to anything else doesn't run them.
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { EARS, EarsEngine } from '@apackdev/ears';
import { _catchUpProjections } from '../../src/runtime/projections.ts';
import { resetTestData, startTestRuntime, testPacks } from '../../src/testing/index.ts';
import { boundEars, untypedCreate, untypedQuery, untypedWrite } from '../../src/ears/index.ts';

startTestRuntime();

const applied: string[][] = [];
let rebuilds = 0;
let failing = false;
const projection = {
  from: ['Collection'],
  apply(ids: readonly string[]) {
    if (failing) throw new Error('the projection failed');
    applied.push([...ids]);
  },
  rebuild() {
    if (failing) throw new Error('the projection failed');
    rebuilds++;
  },
};

beforeEach(() => {
  resetTestData();
  applied.length = 0;
  rebuilds = 0;
  failing = false;
  testPacks.projections.push({ name: 'test/feature/derived', projection });
});
afterEach(() => { testPacks.projections.length = 0; });

const aCollection = () => untypedCreate('Collection', { name: 'c' }).id() as EARS.EntityId;

it('rebuilds on the first write it sees, having read nothing yet, and applies each one after', () => {
  aCollection();
  expect([rebuilds, applied.length]).toEqual([1, 0]);
  const second = aCollection();
  expect(applied).toEqual([[second]]);
  untypedWrite(second).set('name', 'renamed');
  expect(applied).toEqual([[second], [second]]);
});

it('does not run for a write to anything else', () => {
  aCollection();
  rebuilds = 0;
  untypedCreate('Flow', { label: 'f', flowType: 'root' });
  expect([rebuilds, applied.length]).toEqual([0, 0]);
});

it('undoes the write when it fails', () => {
  failing = true;
  expect(() => aCollection()).toThrow('the projection failed');
  expect(untypedQuery('Collection').count()).toBe(0);
});

it('has nothing to do catching up on its own process\'s commits', () => {
  aCollection();
  aCollection();
  applied.length = 0;
  rebuilds = 0;
  _catchUpProjections(boundEars() as EarsEngine);
  expect([rebuilds, applied.length]).toEqual([0, 0]);
});

it('rebuilds catching up when it has read nothing yet', () => {
  untypedCreate('Flow', { label: 'f', flowType: 'root' });
  _catchUpProjections(boundEars() as EarsEngine);
  expect(rebuilds).toBe(1);
});

it('rebuilds catching up after a commit that did not say what it changed, its own process\'s included', () => {
  aCollection();
  rebuilds = 0;
  const engine = boundEars() as EarsEngine;
  engine.admin.bulkLoadAttr(aCollection(), 'name' as EARS.AttrKind, 'loaded');
  rebuilds = 0;
  _catchUpProjections(engine);
  expect(rebuilds).toBe(1);
});

it('keeps catching up the others when one fails, and its cursor where it was', () => {
  const second = { ...projection, rebuild() { rebuilds += 10; }, apply() {} };
  testPacks.projections.push({ name: 'test/feature/other', projection: second });
  failing = true;
  untypedCreate('Flow', { label: 'f', flowType: 'root' });
  expect(() => _catchUpProjections(boundEars() as EarsEngine)).not.toThrow();
  expect(rebuilds, 'the other rebuilt').toBe(10);
  failing = false;
  _catchUpProjections(boundEars() as EarsEngine);
  expect(rebuilds, 'the one that failed still had nothing read, and rebuilt now').toBe(11);
});
