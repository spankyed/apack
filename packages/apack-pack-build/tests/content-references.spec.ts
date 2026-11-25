import { describe, expect, it } from 'vitest';
import { flowContentReferences } from '../src/compilers/flow-references.ts';
import { inspectContentReferences, findContentDependents } from '../src/content-references.ts';
import { parseContentIndex } from '@apackdev/pack-format';
import type { StepDefinition } from '@apackdev/sdk/steps';

describe('compiled content references', () => {
  it('projects custom, nested and computed DSL references without evaluating their targets', () => {
    const steps: StepDefinition[] = [
      { type: 'custom', dsl: { references: { choice: 'actions' } } },
      { type: 'branch', build: {
        compile: () => ({ entity: {}, relations: [] }), validate: () => [], getLabel: () => '',
        branches: node => [{ key: 'children', steps: node.children as Record<string, unknown>[] }],
      } },
      { type: 'start', kind: 'trigger', trigger: { trackField: 'event', compile: () => ({}), decompile: () => ({}) },
        dsl: { references: { initial: 'prompts' } } },
    ];
    const references = flowContentReferences({ Demo: [{ event: 'manual', initial: 'Greeting', exits: [[
      { type: 'custom', choice: 'Send' },
      { type: 'custom' },
      { type: 'branch', children: [{ type: 'custom', choice: { toString() { throw new Error('must not evaluate'); } } }] },
    ]] }] }, steps);
    expect(references).toEqual([
      { item: 'Demo', path: 'Demo[0].initial', kind: 'static', target: { key: 'prompts', item: 'Greeting' } },
      { item: 'Demo', path: 'Demo[0].exits[0][0].choice', kind: 'static', target: { key: 'actions', item: 'Send' } },
      { item: 'Demo', path: 'Demo[0].exits[0][2].children[0].choice', kind: 'dynamic', target: { key: 'actions' } },
    ]);
    const index = parseContentIndex({ version: 1, packId: 'demo', entries: [
      { key: 'flows', written: true, count: 1, items: [{ key: 'Demo' }], references },
      { key: 'actions', written: true, count: 1, items: [{ key: 'Send' }] },
    ] });
    expect(inspectContentReferences(index).map(reference => reference.status)).toEqual(['not-indexed', 'indexed', 'dynamic']);
    expect(findContentDependents(index, { key: 'actions', item: 'Send' })).toHaveLength(1);
    index.entries[1].items = [{ key: 'Renamed' }];
    expect(findContentDependents(index, { key: 'actions', item: 'Send' })[0].status).toBe('not-indexed');
  });

  it('rejects references with unknown source items or malformed target identities', () => {
    const index = (reference: unknown) => ({ version: 1, packId: 'demo', entries: [
      { key: 'flows', written: true, count: 1, items: [{ key: 'Demo' }], references: [reference] },
    ] });
    expect(() => parseContentIndex(index({ item: 'Unknown', path: 'x', kind: 'static', target: { key: 'actions', item: 'Send' } })))
      .toThrow(/Reference source.*Unknown/);
    expect(() => parseContentIndex(index({ item: 'Demo', path: 'x', kind: 'static', target: { key: 'actions' } }))).toThrow();
    expect(() => parseContentIndex(index({ item: 'Demo', path: 'x', kind: 'dynamic', target: { key: 'actions', item: 'Send' } }))).toThrow();
  });
});
