// Flows someone edited or renamed survive a content change. Each apply records what it wrote for every flow
// — a hash for its own fields, one per node, one for the wiring — and a changed contentHash replaces only a
// flow whose every part still holds what we wrote. A flow is found by its content key, not its label.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CONTENT_INDEX_FILE, contentFile } from '@apackdev/sdk/build';
import { createFlowApplier, createFormatApplier } from '@apackdev/sdk/content';
import { importCompiledContent, type ApplyRecord } from '@apackdev/sdk/utils';
import { registerPack, unregisterPack } from '@apackdev/testing/harness';
import { query } from '#generated/ears.ts';
import { dropAttribute } from '@apackdev/sdk/testing';
import { findRelations, untypedWrite } from '@apackdev/sdk/ears';
import { repository } from '#generated/repository.ts';
import { PACK_DIR, applyAfter, resetDatabase } from './harness.ts';
import type { EARS } from '@apackdev/sdk';

type FlowRow = { id: EARS.EntityId; label: string; contentHash?: string };
const flow = (label: string) => query('Flow').where('label', label).pickAll() as FlowRow[];
const nodesOf = (label: string) => repository.flowsQueries.flowNodes(flow(label)[0].id);

const dirs: string[] = [];
// Another installed pack applying flows: its own appliers read the content it compiled
registerPack({
  id: 'other-pack',
  appliers: [createFormatApplier({ key: 'actions', entities: ['Action'], identity: ['label'] }), createFormatApplier({ key: 'prompts', entities: ['Prompt'], identity: ['label'] }), createFlowApplier()],
});
afterAll(() => {
  unregisterPack('other-pack');
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * default-setup's compiled actions, prompts and flows; `changed` flows get a new contentHash (per `version`), as a changed source would.
 * `only` keeps just those flows, and `packId` names another pack that compiled them.
 */
function compiled(changed: string[] = [], version = 'changed', { only, packId = 'default-setup' }: { only?: string[]; packId?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-content-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, CONTENT_INDEX_FILE), JSON.stringify({ version: 1, packId, entries: [] }));
  const contentDir = path.join(PACK_DIR, 'dist', 'runtime', 'content');
  for (const key of ['actions', 'prompts']) fs.copyFileSync(path.join(contentDir, contentFile(key)), path.join(dir, contentFile(key)));
  const all = JSON.parse(fs.readFileSync(path.join(contentDir, contentFile('flows')), 'utf-8')) as Record<string, { contentHash?: string }>;
  const flows = only ? Object.fromEntries(only.map((name) => [name, all[name]])) : all;
  for (const name of changed) flows[name] = { ...flows[name], contentHash: `${version}-${flows[name].contentHash}` };
  fs.writeFileSync(path.join(dir, contentFile('flows')), JSON.stringify(flows));
  return dir;
}

/**
 * **An apply, with the record carried from the run before**, which is how the app's boot runs it: the merge
 * reads what the last apply wrote for a flow, and that is what says whether the user has since changed it.
 */
let applied: ApplyRecord | undefined;
const contentFlows = (dir: string) => {
  applied = applyAfter(applied);
  return importCompiledContent({ compiledDir: dir, mode: 'replace-on-collision', applied }).flows;
};
/** The same run as an **import**: no record, which is the user asking for the pack's flows back */
const importFlows = (dir: string) => importCompiledContent({ compiledDir: dir, mode: 'replace-on-collision' }).flows;
/** An apply whose record has never seen this pack, which is what an upgrade from an older version is */
const applyUnrecorded = (dir: string) => {
  applied = applyAfter();
  return importCompiledContent({ compiledDir: dir, mode: 'replace-on-collision', applied }).flows;
};

beforeEach(() => {
  resetDatabase();
  applied = undefined;
  contentFlows(compiled());
});

describe('re-applying edited flows', () => {
  it('replaces a changed flow nobody edited, and still tracks it after', () => {
    const counts = contentFlows(compiled(['Codex', 'Claude Code']));
    expect(counts).toMatchObject({ updated: 2 });
    expect(counts.errors).toBeUndefined();
    expect(flow('Codex')[0].contentHash).toMatch(/^changed-/);
    // Tracked again: an edit after this replacement is detected
    repository.flowsCommands.updateNode(nodesOf('Codex')[0].id, { description: 'My note' });
    expect(contentFlows(compiled(['Codex', 'Claude Code'], 'changed-again'))).toMatchObject({ updated: 1 });
    expect(flow('Codex')[0].contentHash).not.toMatch(/^changed-again-/);
  });

  it("leaves a flow alone when one of its nodes was edited, and still replaces the others", () => {
    const node = nodesOf('Codex')[0];
    repository.flowsCommands.updateNode(node.id, { description: 'My note' });
    const counts = contentFlows(compiled(['Codex', 'Claude Code']));
    expect(counts).toMatchObject({ updated: 1 });
    expect(repository.flowsQueries.node(node.id)).toMatchObject({ description: 'My note' });
    expect(flow('Codex')[0].contentHash).not.toMatch(/^changed-/);
  });

  it("runs the flows a replaced flow's subflows name, when this content doesn't replace those flows", () => {
    expect(contentFlows(compiled(['Root Flow']))).toMatchObject({ updated: 1 })
    const subflowRefs = nodesOf('Root Flow').filter((node) => node.nodeType === 'subflow').map((node) => (node as { flowRef?: string }).flowRef)
    expect(subflowRefs.sort()).toEqual(['Claude Code', 'Codex', 'Command Listener', 'Onboarding Flow'].map((label) => flow(label)[0].id).sort())
  });

  it('leaves a flow alone when a node was removed from it', () => {
    repository.flowsCommands.deleteNode(nodesOf('Codex').at(-1)!.id);
    expect(contentFlows(compiled(['Codex']))).toMatchObject({ updated: 0 });
  });

  it("finds a renamed flow instead of applying a copy, and leaves it as renamed", () => {
    repository.flowsCommands.updateFlowLabel(flow('Codex')[0].id, 'My Codex');
    const counts = contentFlows(compiled(['Codex']));
    expect(counts.created).toBe(0);
    expect(flow('Codex')).toEqual([]);
    expect(flow('My Codex')).toHaveLength(1);
  });

  it("doesn't count relations stored in another order as an edit", () => {
    // Relinking a transition (as loading relations from disk in another order would) keeps its content
    const [transition] = nodesOf('Codex').flatMap((node) => findRelations({ source: node.id, kind: 'transitions_to' }));
    untypedWrite(transition.source)
      .unlink('transitions_to', transition.target)
      .link('transitions_to', transition.target, { info: transition.info });
    expect(contentFlows(compiled(['Codex']))).toMatchObject({ updated: 1 });
  });

  /**
   * **A flow we wrote with no recorded parts is adopted**, not frozen: every flow written before anything
   * recorded which part of one we wrote is in that state, and freezing them would mean a user who upgrades
   * never gets a fix to one again. The write records its parts, so the next apply can see an edit.
   */
  it('adopts a flow whose parts were never recorded, and tracks it from then on', () => {
    expect(applyUnrecorded(compiled(['Codex']))).toMatchObject({ updated: 1 });
    expect(flow('Codex')[0].contentHash).toMatch(/^changed-/);

    repository.flowsCommands.updateNode(nodesOf('Codex')[0].id, { description: 'My note' });
    expect(contentFlows(compiled(['Codex'], 'changed-again'))).toMatchObject({ updated: 0 });
  });

  it("points a replaced flow's subflow steps at a written flow the user renamed", () => {
    const codex = flow('Codex')[0].id;
    repository.flowsCommands.updateFlowLabel(codex, 'My Codex');
    expect(contentFlows(compiled(['Root Flow']))).toMatchObject({ updated: 1, created: 0 });
    const refs = nodesOf('Root Flow').filter((node) => node.nodeType === 'subflow').map((node) => (node as { flowRef?: string }).flowRef);
    expect(refs).toContain(codex);
    expect(refs).not.toContain('Codex');
  });

  it("points a replaced flow's subflow steps at the written flow, not a user's flow with its label", () => {
    const codex = flow('Codex')[0].id;
    const mine = repository.flowsCommands.createFlow({ label: 'Codex' }).id;
    expect(contentFlows(compiled(['Root Flow']))).toMatchObject({ updated: 1 });
    const refs = nodesOf('Root Flow').filter((node) => node.nodeType === 'subflow').map((node) => (node as { flowRef?: string }).flowRef);
    expect(refs).toContain(codex);
    expect(refs).not.toContain(mine);
  });

  it("runs a user's flow with a written flow's name when the apply left that flow alone for it", () => {
    repository.flowsCommands.deleteFlow(flow('Codex')[0].id);
    const mine = repository.flowsCommands.createFlow({ label: 'Codex' }).id;
    const counts = contentFlows(compiled(['Root Flow', 'Codex']));
    expect(counts).toMatchObject({ updated: 1, created: 0 });
    expect(counts.errors).toBeUndefined();
    const refs = nodesOf('Root Flow').filter((node) => node.nodeType === 'subflow').map((node) => (node as { flowRef?: string }).flowRef);
    expect(refs).toContain(mine);
    expect(refs).not.toContain('Codex');
  });
});

describe('a flow the user deleted', () => {
  /**
   * **A flow is destroyed, not trashed** (`flowRepository.deleteFlow` ends in `destroy()`), so there is no
   * entity left carrying its key and the rule that leaves a trashed note alone has nothing to read. What
   * answers for it is the applied content: a key the last apply wrote with nothing behind it now is theirs.
   *
   * The second apply gives Codex a new `contentHash`, which is what would otherwise bring it back — an apply
   * of unchanged content skips every flow and would pass without the rule.
   */
  it('is not written again, given what the last apply wrote', () => {
    repository.flowsCommands.deleteFlow(flow('Codex')[0].id);
    expect(flow('Codex'), 'a destroyed flow leaves nothing behind, which is the premise').toEqual([]);

    // Root Flow changes in the same run, so an apply that wrote nothing at all would fail here rather than
    // pass the assertion below. The exemptions are in apack-sdk's flow-applier spec
    const counts = contentFlows(compiled(['Codex', 'Root Flow']));

    expect(flow('Codex'), 'the apply created the flow the user deleted').toEqual([]);
    expect(counts).toMatchObject({ created: 0, updated: 1 });
  });

  /** And an import carries no record, so asking for the pack's flows back puts it back */
  it('is written again by an import, which reads no record', () => {
    repository.flowsCommands.deleteFlow(flow('Codex')[0].id);

    expect(importFlows(compiled(['Codex']))).toMatchObject({ created: 1 });
    expect(flow('Codex')).toHaveLength(1);
  });
});

describe('a flow whose name another flow already has', () => {
  const graph = (label: string) => ({ row: flow(label)[0], nodes: nodesOf(label) });

  it("isn't written over another pack's flow: the other flow is left as it is, and the apply reports it", () => {
    const before = graph('Codex');
    const counts = contentFlows(compiled(['Codex'], 'other', { only: ['Codex'], packId: 'other-pack' }));
    expect(counts).toMatchObject({ created: 0, updated: 0 });
    expect(counts.errors).toEqual(['Flow "Codex": a flow with this name already exists (written by default-setup)']);
    expect(graph('Codex')).toEqual(before);
    // default-setup still owns and updates its flow
    expect(contentFlows(compiled(['Codex']))).toMatchObject({ updated: 1 });
    expect(flow('Codex')[0].contentHash).toMatch(/^changed-/);
  });

  it("isn't written over a user's flow with the ids the apply would write", () => {
    // A user's flow that has the compiled flow's ids, under another name
    const codex = flow('Codex')[0].id;
    for (const attr of ['contentHash', 'contentKey']) dropAttribute(codex, attr);
    repository.flowsCommands.updateFlowLabel(codex, 'My Codex');
    const before = graph('My Codex');
    // An import: with the record carried forward, a flow of ours that is no longer there reads as one the
    // user deleted and the apply stops before the collision check — the same outcome, a different sentence
    const counts = importFlows(compiled(['Codex']));
    expect(counts.created).toBe(0);
    expect(counts.errors).toEqual(['Flow "Codex": a flow with this name already exists (created by the user)']);
    expect(graph('My Codex')).toEqual(before);
    expect(flow('Codex')).toEqual([]);
  });

  it("leaves a user's flow with the name alone", () => {
    const pack = compiled(['Codex'], 'other', { only: ['Codex'], packId: 'other-pack' });
    // No default-setup flows: only the actions and prompts flows use
    resetDatabase();
    contentFlows(compiled([], 'changed', { only: [] }));
    const mine = repository.flowsCommands.createFlow({ label: 'Codex' }).id;
    const before = graph('Codex');
    expect(contentFlows(pack)).toMatchObject({ created: 0, skipped: 1 });
    expect(flow('Codex')).toEqual([before.row]);
    expect(before.row.id).toBe(mine);
    expect(nodesOf('Codex')).toEqual(before.nodes);
  });
});
