import { nativePackDeclarationFixture } from '../../src/testing/index.ts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _createTestEngine } from '../../src/testing/index.ts';
import { findRelations, _bindEars, boundEars, untypedWrite } from '@apackdev/sdk/ears';
import { applyRecord, type ApplyRecord } from '../../src/utils/index.ts';

const { createFlowApplier } = await import('../../src/content/flow-applier.ts');
const { startTestRuntime, testPacks } = await import('../../src/testing/index.ts');
const { listenerTrigger, actionStep } = await import('../build/helpers/test-steps.ts');
// The registered steps the applier compiles flows with
startTestRuntime();
testPacks.steps.set(listenerTrigger.type, listenerTrigger);
testPacks.steps.set(actionStep.type, actionStep);
const declaration = nativePackDeclarationFixture({ id: 'repository-fixture', steps: [listenerTrigger, actionStep] });
for (const [type, step] of Object.entries(declaration.steps ?? {})) testPacks.stepDeclarations.set(type, {
  type, packId: declaration.id, origin: 'native', enabled: true, declaration: step,
});
const { contentPath } = await import('../../src/build/manifest.ts');

let tmp: string | undefined;
// The applier reads and writes the installed engine: a fresh one per test
beforeEach(() => {
  _bindEars(_createTestEngine());
});
afterEach(() => {
  _bindEars(undefined);
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
  vi.restoreAllMocks();
});

describe('flow applier', () => {
  /** A pack's compiled flows, one valid flow whose `contentHash` is its version */
  function compiledFlows(name: string, version = 'v1'): string {
    tmp ??= fs.mkdtempSync(path.join(os.tmpdir(), 'flow-applier-'));
    const file = contentPath(tmp, 'flows');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'content.json'), JSON.stringify({ version: 1, packId: 'demo', entries: [] }));
    fs.writeFileSync(file, JSON.stringify({
      [name]: {
        contentHash: `${name}-${version}`,
        tracks: [{ event: 'flow.entry', label: 'Flow Entry', exits: [[{ type: actionStep.type, action: 'Noop' }]] }],
      },
    }));
    return tmp;
  }

  /** The Flow entities with this label, through the installed engine's finder as the writer reads them */
  const flows = (label: string) =>
    (boundEars().query('Flow' as never).where('label', label).pickAll() as Array<{ id: string; label: string }>);

  /**
   * One apply, with the record `applyPacks` builds; with none it is an import.
   *
   * It declares `onUserEdit: 'offer'`, as the `flows` entry of every pack in this repo does: a flow is the
   * pack's, customised, so the user still wants its fixes. What the flag changes is only whether a decision
   * is recorded — the write is the same either way, which the `theirs` case below is the other half of.
   */
  const apply = (dir: string, record?: ApplyRecord) =>
    createFlowApplier({ onUserEdit: 'offer' }).apply({ compiledDir: dir, mode: 'replace-on-collision', ...(record && { applied: record }), log: () => {} });

  /** The record the next apply reads, as `appliedContent.record` merges it (see `applier.spec.ts`'s `after`) */
  const after = (previous: ApplyRecord): ApplyRecord => {
    const items = new Map(previous.before);
    for (const [key, item] of previous.written) items.set(key, item);
    for (const key of previous.removed) items.delete(key);
    return applyRecord(items);
  };

  /**
   * **The three parts a flow is made of**, read off the entities a moment after writing them — which is the
   * same read `driftedGraphParts` makes, so the two cannot describe different scopes.
   */
  it('records the flow, a part per node, and the wiring', () => {
    const record = applyRecord();
    apply(compiledFlows('Demo Flow'), record);

    const [[, item]] = [...record.written];
    const paths = Object.keys(item.parts).sort();
    expect(paths.filter((p) => !p.startsWith('node:'))).toEqual(['edges', 'fields']);
    expect(paths.filter((p) => p.startsWith('node:')).length, 'a part per compiled node').toBeGreaterThan(0);
    expect(item).toMatchObject({ entityType: 'Flow', contentHash: 'Demo Flow-v1' });
  });

  /**
   * **A rewired edge moves `edges` and nothing else**, which is the whole reason the wiring is its own part:
   * the stored digest can only say that something in the flow moved.
   */
  it('moves only `edges` when the wiring changes', async () => {
    const { driftedGraphParts } = await import('../../src/content/flow-applier.ts');
    const record = applyRecord();
    apply(compiledFlows('Demo Flow'), record);
    const [[, item]] = [...record.written];
    const flowId = flows('Demo Flow')[0].id as never;

    const nodeId = findRelations({ source: flowId, kind: 'contains' as never })[0].target;
    untypedWrite(flowId).link('transitions_to' as never, nodeId as never, { info: { sourceHandle: 'branch-9' } });

    expect(driftedGraphParts(item, flowId)).toEqual(['edges']);
  });

  /**
   * **A node added or removed is drift too**, which is why the comparison is over both sides' part paths and
   * not only the recorded ones: a node the user added has a path the record has never seen, and one they
   * removed has a recorded path the database no longer answers for.
   */
  it('reports a node the user added, and one they removed', async () => {
    const { driftedGraphParts } = await import('../../src/content/flow-applier.ts');
    const record = applyRecord();
    apply(compiledFlows('Demo Flow'), record);
    const [[, item]] = [...record.written];
    const flowId = flows('Demo Flow')[0].id as never;
    const nodeId = findRelations({ source: flowId, kind: 'contains' as never })[0].target;

    const added = boundEars().create('Node' as never, { label: 'mine' }).id();
    untypedWrite(flowId).link('contains' as never, added as never);
    // Both, and that is right: a node arrives with the `contains` edge that holds it, so the wiring moved too
    expect(driftedGraphParts(item, flowId), 'a node the user added').toEqual(['edges', `node:${added}`]);

    untypedWrite(flowId).unlink('contains' as never, added as never);
    untypedWrite(flowId).unlink('contains' as never, nodeId as never);
    expect(driftedGraphParts(item, flowId), 'a node the user removed, and the wiring that named it')
      .toEqual(['edges', `node:${nodeId}`]);
  });

  /**
   * **A flow an applier wrote agrees with itself**: every part it recorded still matches what the entity holds,
   * so nothing reads as the user's the moment it was written. The companion of the two cases above — without
   * it they would both pass for a derivation that reported constants.
   */
  it('records parts that agree with the database it just wrote', async () => {
    const { driftedGraphParts } = await import('../../src/content/flow-applier.ts');
    const record = applyRecord();
    apply(compiledFlows('Demo Flow'), record);

    const [[, item]] = [...record.written];
    expect(driftedGraphParts(item, flows('Demo Flow')[0].id as never)).toEqual([]);
  });

  /** And re-applying unchanged content records the same parts, so a second read agrees with the first */
  it('records the same parts for the same content, applied twice', () => {
    const first = applyRecord();
    apply(compiledFlows('Demo Flow'), first);
    const second = after(first);

    apply(compiledFlows('Demo Flow', 'v2'), second);

    const [key] = [...first.written.keys()];
    expect(second.written.get(key)!.parts, 'a part moved for a flow whose content did not')
      .toEqual(first.written.get(key)!.parts);
  });

  /**
   * **A flow is destroyed rather than trashed, so the applied content is all there is to go on.** The generic
   * writer can read a trashed entity; `flowRepository.deleteFlow` ends in `destroy()`, and then what says the
   * user deleted this one is that the last apply wrote it and there is nothing there now.
   */
  it('leaves a deleted flow deleted when the last apply wrote it', async () => {
    const { flowRepository } = await import('../../src/repositories/index.ts');
    const first = applyRecord();
    expect(apply(compiledFlows('Demo Flow'), first)).toMatchObject({ created: 1 });
    flowRepository.deleteFlow(flows('Demo Flow')[0].id as never, { allowRoot: true });
    expect(flows('Demo Flow'), 'a destroyed flow leaves nothing behind, which is the premise').toEqual([]);

    const counts = apply(compiledFlows('Demo Flow', 'v2'), after(first));

    expect(counts).toMatchObject({ created: 0, skipped: 1 });
    expect(flows('Demo Flow'), 'the apply created the flow the user deleted').toEqual([]);
  });

  /** And an import carrying no record puts it back, which is what asking for a pack's data back is */
  it('writes a deleted flow again for an import with no record', async () => {
    const { flowRepository } = await import('../../src/repositories/index.ts');
    apply(compiledFlows('Demo Flow'));
    flowRepository.deleteFlow(flows('Demo Flow')[0].id as never, { allowRoot: true });

    const counts = apply(compiledFlows('Demo Flow', 'v2'));

    expect(counts).toMatchObject({ created: 1 });
    expect(flows('Demo Flow').length, 'the data the user asked for was not put back').toBe(1);
  });

  /**
   * **A flow with the user's edit and a newer version is named rather than silently frozen**, and the parts
   * say which piece they changed. One digest over a thirty-step flow could only say that something in it
   * moved, which is a freeze with nothing to explain it.
   */
  it('names the parts of an edited flow a newer version would have replaced', () => {
    const first = applyRecord();
    apply(compiledFlows('Demo Flow'), first);
    const flowId = flows('Demo Flow')[0].id as never;
    untypedWrite(flowId).set('description' as never, 'mine');

    const second = after(first);
    const counts = apply(compiledFlows('Demo Flow', 'v2'), second);

    expect(counts).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect([...second.offers.values()]).toEqual([{ kind: 'update', parts: ['fields'], contentHash: expect.any(String) }]);
  });

  /** And a `theirs` flows entry records none of it: the user's version stays, and nothing asks them */
  it('records no decision for a `theirs` flows entry the user edited', () => {
    const first = applyRecord();
    const theirs = (dir: string, record?: ApplyRecord) =>
      createFlowApplier().apply({ compiledDir: dir, mode: 'replace-on-collision', ...(record && { applied: record }), log: () => {} });
    theirs(compiledFlows('Demo Flow'), first);
    untypedWrite(flows('Demo Flow')[0]!.id as never).set('description' as never, 'mine');

    const second = after(first);
    theirs(compiledFlows('Demo Flow', 'v2'), second);

    expect([...second.offers]).toEqual([]);
    expect(flows('Demo Flow').length).toBe(1);
  });

  /**
   * **A flow the pack still ships is never removed, however the run ended up skipping it.** An entry that
   * fails to validate is the worst case: the loop reports the error and moves on, and if the key it never
   * reached read as content the pack had dropped, shipping one broken flow would delete the user's copy of
   * exactly that flow.
   */
  it('keeps a flow whose new version fails to validate', () => {
    const first = applyRecord();
    apply(compiledFlows('Demo Flow'), first);
    const flowId = flows('Demo Flow')[0].id;

    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-applier-broken-'));
    fs.writeFileSync(path.join(broken, 'content.json'), JSON.stringify({ version: 1, packId: 'demo', entries: [] }));
    fs.writeFileSync(contentPath(broken, 'flows'), JSON.stringify({
      'Demo Flow': { contentHash: 'Demo Flow-v2', tracks: [{ event: 'flow.entry', label: 'Flow Entry', exits: [[{ type: 'no_such_step' }]] }] },
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const second = after(first);
    const counts = apply(broken, second);

    expect(counts.errors).toEqual([expect.stringMatching(/^Flow "Demo Flow" is invalid: /)]);
    expect(flows('Demo Flow').map((flow) => flow.id), 'the flow the user had').toEqual([flowId]);
    expect([...second.removed], 'a flow the content still declares was removed').toEqual([]);
    fs.rmSync(broken, { recursive: true, force: true });
  });

  /** Content the pack dropped: removed while it is ours, kept and flagged once the user has edited it */
  it('removes a flow the content no longer declares, unless the user edited it', () => {
    const first = applyRecord();
    apply(compiledFlows('Demo Flow'), first);
    const [key] = [...first.written.keys()];

    const emptied = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-applier-none-'));
    fs.writeFileSync(path.join(emptied, 'content.json'), JSON.stringify({ version: 1, packId: 'demo', entries: [] }));
    fs.writeFileSync(contentPath(emptied, 'flows'), JSON.stringify({}));

    const second = after(first);
    apply(emptied, second);
    expect(flows('Demo Flow'), 'a flow the pack dropped and nobody edited').toEqual([]);
    expect([...second.removed]).toEqual([key]);

    // And again with the user's edit on it
    const third = applyRecord();
    apply(compiledFlows('Demo Flow'), third);
    untypedWrite(flows('Demo Flow')[0].id as never).set('description' as never, 'mine');
    const fourth = after(third);
    apply(emptied, fourth);
    expect(flows('Demo Flow').length, 'a flow the user edited was removed with the content').toBe(1);
    expect([...fourth.offers.values()]).toEqual([{ kind: 'removed', parts: ['fields'] }]);
    fs.rmSync(emptied, { recursive: true, force: true });
  });

  /**
   * **The `edges` part filters to the kinds a compiled flow is made of**, so that a relation a running app
   * links from one of a flow's nodes is not read as the user having rewired it. What makes the filter right
   * is that the compiler emits nothing else, which is asked of the compiler's own output here: add a third
   * kind to `flow-compiler.ts` and this fails rather than the filter silently dropping it.
   */
  it('keeps the short code of a flow it deletes only to write again, rather than numbering it anew', () => {
    _bindEars(_createTestEngine({ rowRules: { Flow: { required: [], shortCode: 'FLW' } } }));
    const dir = compiledFlows('Demo Flow');
    apply(dir);
    const codeOf = () => (flows('Demo Flow') as Array<{ shortCode?: string }>).map((flow) => flow.shortCode);
    expect(codeOf()).toEqual(['FLW-1']);
    // A number is never handed out twice, so a flow numbered afresh here would be FLW-2
    createFlowApplier({ onUserEdit: 'offer' }).apply({ compiledDir: dir, mode: 'wipe-and-replace', log: () => {} });
    expect(codeOf()).toEqual(['FLW-1']);
  });

  it('filters the wiring to the relation kinds a compiled flow holds', async () => {
    const { GRAPH_REL_KINDS } = await import('../../src/content/flow-applier.ts');
    const { compile } = await import('../../src/build/compilers/flow-compiler.ts');
    const dsl = JSON.parse(fs.readFileSync(contentPath(compiledFlows('Demo Flow'), 'flows'), 'utf-8')) as Record<string, never>;

    const compiled = compile(dsl, { actions: new Map(), prompts: new Map() });
    const kinds = [...new Set(compiled.relation.map((relation) => relation.kind))];

    expect(kinds.length, 'the compiler emitted no relations, so this checks nothing').toBeGreaterThan(0);
    expect(kinds.filter((kind) => !GRAPH_REL_KINDS.includes(kind)), 'a kind the edges part would drop').toEqual([]);
  });

  it('reports an invalid flow as an apply error instead of skipping it silently', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-applier-'));
    const file = contentPath(tmp, 'flows');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'content.json'), JSON.stringify({ version: 1, packId: 'demo', entries: [] }));
    fs.writeFileSync(file, JSON.stringify({
      'Broken Flow': { tracks: [{ event: 'flow.entry', label: 'Flow Entry', exits: [[{ type: 'no_such_step' }]] }] },
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const applier = createFlowApplier();
    const counts = applier.apply({ compiledDir: tmp, mode: 'replace-on-collision', log: () => {} });

    expect(counts.errors).toEqual([expect.stringMatching(/^Flow "Broken Flow" is invalid: /)]);
    expect(counts.created).toBe(0);
  });

});
