// services.runHistory: one implementation over the run history's database — the app's, opened by `openRunHistory`, and
// the test runtime's in a temporary directory — so every case runs against both, and the test double can't drift from
// what the app runs
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { EARS } from '@apackdev/ears';
import { openEnvironment } from '@apackdev/ears/lmdb';
import type { RunHistory, RunNode, RunNodeId, RunNodeStart } from '@apackdev/sdk/services';
import { _openTestRunHistory } from '@apackdev/sdk/testing';
import { openRunHistory, type RunsDatabase } from '../../src/database/open.ts';
import { createRunHistory, RUN_HISTORY_RETENTION_MS } from '../../src/services/run-history.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-history-'));
const open: RunsDatabase[] = [];
afterEach(() => { for (const runs of open.splice(0)) runs.database.close(); });
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** The app's run history at a directory of its own */
const onDisk = (dir = path.join(fs.mkdtempSync(path.join(root, 'case-')), 'run-history')): RunsDatabase => {
  const runs = openRunHistory(dir);
  open.push(runs);
  return runs;
};

const STORES: Record<string, () => RunHistory> = {
  'on disk': () => createRunHistory(onDisk().engine),
  'of the test runtime': () => {
    const runs = _openTestRunHistory();
    open.push(runs);
    return createRunHistory(runs.engine);
  },
};

/** Starts a node and returns its id */
function node(history: RunHistory, fields: { kind: RunNode['kind'] } & Record<string, unknown>): RunNodeId {
  return history.start({ label: fields.kind, ...fields } as RunNodeStart).id;
}

let made = 0;
/** A node as a run long ago left it, written to the database directly: times a running app would never give it */
function recorded(runs: RunsDatabase, fields: { kind: RunNode['kind']; startedAt: number; parentId?: RunNodeId } & Record<string, unknown>): RunNodeId {
  const id = `RunNode-old${String(made++).padStart(6, '0')}` as RunNodeId;
  const parent = fields.parentId === undefined ? undefined : runs.engine.getRow(fields.parentId as unknown as EARS.EntityId);
  runs.engine.create('RunNode', { label: fields.kind, status: 'completed', ...fields, id: id as unknown as EARS.EntityId, rootId: (parent?.rootId as string | undefined) ?? id });
  return id;
}

describe.each(Object.keys(STORES))('the run history %s', (where) => {
  const fresh = STORES[where];

  it('builds a tree with each node once, under its own parent', () => {
    const history = fresh();
    const session = node(history, { kind: 'flow' });
    const event = node(history, { kind: 'event', parentId: session });
    const s1 = node(history, { kind: 'step', parentId: event });
    const s2 = node(history, { kind: 'step', parentId: s1 });
    const s3 = node(history, { kind: 'step', parentId: s2 });
    const shape = (tree: { id: string; children: unknown[] }): unknown => [tree.id, (tree.children as typeof tree[]).map(shape)];
    // A chain, not a fan: each node appears once, under the node it ran under
    expect(shape(history.tree(event)!)).toEqual([event, [[s1, [[s2, [[s3, []]]]]]]]);
    expect(history.get(s3)?.rootId).toBe(session);
  });

  it('lists a node\'s children in the order they began, and pages them', () => {
    const history = fresh();
    const parent = node(history, { kind: 'flow' });
    const children = Array.from({ length: 4 }, () => node(history, { kind: 'event', parentId: parent }));
    expect(history.findChildren(parent).map((child) => child.id)).toEqual(children);
    expect(history.findChildren(parent, { limit: 2, cursor: children[1] }).map((child) => child.id)).toEqual(children.slice(2));
    expect(history.findChildren(parent, { reverse: true, limit: 1 }).map((child) => child.id)).toEqual([children[3]]);
  });

  it('finds flow runs newest first, of one flow or of every flow', () => {
    const history = fresh();
    const session = node(history, { kind: 'flow', flowId: 'Flow-root' });
    const first = node(history, { kind: 'flow', flowId: 'Flow-a', parentId: session });
    node(history, { kind: 'step', flowId: 'Flow-a', parentId: first });
    const second = node(history, { kind: 'flow', flowId: 'Flow-b', parentId: session });
    expect(history.findRuns({ flowId: 'Flow-a' }).map((run) => run.id)).toEqual([first]);
    expect(history.findRuns().map((run) => run.id)).toEqual([second, first, session]);
    // What a record carries only to be found by is not part of the node
    expect(Object.keys(history.get(first)!)).not.toContain('runOf');
  });

  it('marks every node still active as stopped', () => {
    const history = fresh();
    const session = node(history, { kind: 'flow' });
    const done = node(history, { kind: 'step', parentId: session });
    history.finish(done, 'completed');
    history.stopActive();
    expect(history.get(session)).toMatchObject({ status: 'stopped', completedAt: expect.any(Number) });
    expect(history.get(done)?.status).toBe('completed');
  });

  it('drops a node whose parent it does not hold, and ignores a write to one it does not hold', () => {
    const history = fresh();
    const orphan = node(history, { kind: 'step', parentId: 'RunNode-missing' });
    expect(history.get(orphan)).toBeUndefined();
    history.update('RunNode-missing', { label: 'x' });
    history.finish('RunNode-missing', 'completed');
    expect(history.get('RunNode-missing')).toBeUndefined();
  });

  it('starts a node now and active, under its parent\'s root, and ends it now with its status', () => {
    const history = fresh();
    const session = history.start({ kind: 'flow', label: 'Session' });
    const step = history.start({ kind: 'step', label: 'Step', stepNodeType: 'llm', parentId: session.id, input: { text: 'x'.repeat(20_000) } });
    // Returned as stored: bounded, as every read of it is — nothing runs on a run node
    expect(step).toEqual(history.get(step.id));
    expect(step).toMatchObject({ status: 'active', rootId: session.id, startedAt: expect.any(Number), input: { text: { _truncated: true } } });
    history.finish(step.id, 'failed');
    expect(history.get(step.id)).toMatchObject({ status: 'failed', completedAt: expect.any(Number) });
  });

  it('bounds a long result once, however often the node is written after', () => {
    const history = fresh();
    const step = node(history, { kind: 'flow' });
    history.update(step, { result: { text: 'x'.repeat(20_000) } });
    history.update(step, { label: 'Renamed' });
    history.finish(step, 'completed');
    const text = (history.get(step)!.result as { text: { value: unknown; _truncated?: boolean } }).text;
    expect(text._truncated).toBe(true);
    expect(typeof text.value).toBe('string');
  });

  it('stores what a step returned in a form the store can hold', () => {
    const history = fresh();
    const step = node(history, { kind: 'flow' });
    history.update(step, { result: { count: 10n } });
    expect(history.get(step)).toMatchObject({ result: { count: '10' } });
  });
});

describe('the app\'s run history', () => {
  it('stops what the last session left active as it opens', () => {
    const dir = path.join(fs.mkdtempSync(path.join(root, 'case-')), 'run-history');
    const first = openRunHistory(dir);
    const left = node(createRunHistory(first.engine), { kind: 'flow' });
    first.database.close();

    expect(createRunHistory(onDisk(dir).engine).get(left)?.status).toBe('stopped');
  });

  it('removes a session that ended past the retention period, with everything it ran', () => {
    const dir = path.join(fs.mkdtempSync(path.join(root, 'case-')), 'run-history');
    const runs = openRunHistory(dir);
    const old = Date.now() - RUN_HISTORY_RETENTION_MS - 60_000;
    const session = recorded(runs, { kind: 'flow', startedAt: old, completedAt: old });
    const event = recorded(runs, { kind: 'event', parentId: session, startedAt: old });
    const subflow = recorded(runs, { kind: 'flow', parentId: event, startedAt: old });
    const step = recorded(runs, { kind: 'step', parentId: subflow, startedAt: old });
    runs.database.close();

    const history = createRunHistory(onDisk(dir).engine);
    expect([session, event, subflow, step].map((id) => history.get(id))).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('keeps a running session and one that ended within the period whole, their oldest nodes included', () => {
    const dir = path.join(fs.mkdtempSync(path.join(root, 'case-')), 'run-history');
    const runs = openRunHistory(dir);
    const old = Date.now() - RUN_HISTORY_RETENTION_MS - 60_000;
    // A long session: it started before the period and ended within it, so what it ran first is as old as it is
    const ended = recorded(runs, { kind: 'flow', startedAt: old, completedAt: Date.now() });
    const endedStep = recorded(runs, { kind: 'step', parentId: ended, startedAt: old });
    const running = recorded(runs, { kind: 'flow', status: 'active', startedAt: old });
    const runningStep = recorded(runs, { kind: 'step', parentId: running, startedAt: old });
    runs.database.close();

    const history = createRunHistory(onDisk(dir).engine);
    expect([ended, endedStep, running, runningStep].every((id) => history.get(id) !== undefined)).toBe(true);
  });

  it('moves files it cannot read aside and starts a new history, rather than keeping the app from starting', () => {
    const dir = path.join(fs.mkdtempSync(path.join(root, 'case-')), 'run-history');
    // Files elmdb can't read where the history should be: lmdb-js's, as a record store from before left them
    openEnvironment(dir).root.close();
    expect(() => openRunHistory(dir, { readOnly: true })).toThrow(/isn't a file this LMDB reads/);

    const history = createRunHistory(onDisk(dir).engine);
    expect(history.get(node(history, { kind: 'flow' }))).toBeDefined();
    const aside = fs.readdirSync(path.dirname(dir)).filter((name) => name.startsWith('run-history.unreadable-'));
    expect(aside).toHaveLength(1);
    expect(fs.existsSync(path.join(path.dirname(dir), aside[0], 'data.mdb'))).toBe(true);
  });
});
