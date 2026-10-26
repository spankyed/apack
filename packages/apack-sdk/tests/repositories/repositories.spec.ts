import { nativePackDeclarationFixture } from '../../src/testing/index.ts';
// The repositories of the SDK's entities, on the in-memory runtime: imported flows with their root role,
// nodes and edges, step results on RunNodes, and actions and prompts
import * as os from 'node:os';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEarsEngine } from '@apackdev/ears';
import { findRelations, _bindEars, boundEars, untypedCreate, untypedQuery } from '@apackdev/sdk/ears';
import { actionRepository, flowRepository, promptRepository } from '../../src/repositories/index.ts';
import { compile as compileFlowDSL } from '../../src/build/compilers/flow-compiler.ts';
import { resetTestData, startTestRuntime, testPacks } from '../../src/testing/index.ts';
import { EARS } from '../../src/types/entities.ts';
import { actionStep, listenerTrigger, llmStep } from '../build/helpers/test-steps.ts';

process.env.APACK_ENV ??= 'test';
process.env.APACK_USER_DATA_DIR ??= os.tmpdir();
startTestRuntime();

/** The llm step with the node data a native fixture declares */
const llm = { ...llmStep, node: { label: 'LLM' } };

beforeAll(() => {
  testPacks.steps.set(listenerTrigger.type, listenerTrigger);
  testPacks.steps.set(actionStep.type, actionStep);
  testPacks.steps.set(llm.type, llm);
  const declaration = nativePackDeclarationFixture({ id: 'repository-fixture', steps: [listenerTrigger, actionStep, llm] });
  for (const [type, step] of Object.entries(declaration.steps ?? {})) testPacks.stepDeclarations.set(type, {
    type, packId: declaration.id, origin: 'native', enabled: true, declaration: step,
  });
});

beforeEach(() => resetTestData());

/** Imports a root flow whose entry runs the action, and returns its id */
function importRootFlow(actionId: EARS.EntityId): EARS.EntityId {
  const compiled = compileFlowDSL(
    { 'Root Flow': { root: true, tracks: [{ event: 'flow.entry', exits: [[{ type: 'action', action: 'Greet' }]] }] } },
    { actions: new Map([['Greet', actionId]]) },
  );
  const { flowIds: [flowId] } = flowRepository.importFromDSL(compiled);
  return flowId;
}

describe('flowRepository', () => {
  it('imports compiled flows with the root role, their nodes, edges and related actions', () => {
    const action = actionRepository.create({ label: 'Greet', actionFn: 'return 1' });
    const flowId = importRootFlow(action.id);

    expect(flowRepository.rootFlow()).toBe(flowId);
    const nodes = flowRepository.flowNodes(flowId);
    expect(nodes.map((node) => node.nodeType).sort()).toEqual(['action', 'listener']);
    const actionNode = nodes.find((node) => node.nodeType === 'action')!;
    expect(actionNode.actionId).toBe(action.id);
    expect(flowRepository.getNodeActionId(actionNode.id)).toBe(action.id);
    expect(flowRepository.flowEdges(flowId)).toEqual([expect.objectContaining({ kind: EARS.RelKind.TRANSITIONS_TO, target: actionNode.id })]);
  });

  it('changes a node\'s related action only when the update names it', () => {
    const action = actionRepository.create({ label: 'Greet', actionFn: 'return 1' });
    const other = actionRepository.create({ label: 'Wave', actionFn: 'return 2' });
    const actionNode = flowRepository.flowNodes(importRootFlow(action.id)).find((node) => node.nodeType === 'action')!;

    flowRepository.updateNode(actionNode.id, { label: 'Renamed' });
    expect(flowRepository.getNodeActionId(actionNode.id)).toBe(action.id);

    flowRepository.updateNode(actionNode.id, { actionId: other.id });
    expect(flowRepository.getNodeActionId(actionNode.id)).toBe(other.id);

    flowRepository.updateNode(actionNode.id, { actionId: undefined });
    expect(flowRepository.getNodeActionId(actionNode.id)).toBeUndefined();
    // The node no longer names the action it was linked to
    expect(flowRepository.node(actionNode.id)?.actionId).toBeUndefined();
  });

  it('keeps the root flow unless deleting it is allowed, then removes its nodes and relations', () => {
    const flowId = importRootFlow(actionRepository.create({ label: 'Greet', actionFn: 'return 1' }).id);
    const nodeIds = flowRepository.flowNodes(flowId).map((node) => node.id);

    expect(() => flowRepository.deleteFlow(flowId)).toThrow('Cannot delete the root flow');
    flowRepository.deleteFlow(flowId, { allowRoot: true });

    expect(flowRepository.rootFlow()).toBeUndefined();
    expect(untypedQuery(EARS.Entity.Flow).ids()).toEqual([]);
    for (const id of nodeIds) expect(untypedQuery.ids([id]).count()).toBe(0);
    expect(findRelations({ source: flowId })).toEqual([]);
  });

  it('moves the root role to the flow granted it', () => {
    const first = flowRepository.createFlow({ label: 'First' });
    const second = flowRepository.createFlow({ label: 'Second' });
    flowRepository.grantRootFlowRole(first.id);
    flowRepository.grantRootFlowRole(second.id);
    expect(untypedQuery.all().withRole(EARS.RoleKind.ROOT_FLOW).ids()).toEqual([second.id]);
  });

  it("connects nodes, refusing a trigger target and a busy handle, and renumbers a node's handles", () => {
    const flow = flowRepository.createFlow();
    const entry = flowRepository.createNode(flow.id, { nodeType: 'listener', label: 'Entry' });
    const step = flowRepository.createNode(flow.id, { nodeType: 'action' });
    const other = flowRepository.createNode(flow.id, { nodeType: 'action' });
    expect(step.label).toBe('Action');

    expect(() => flowRepository.createEdge(step.id, entry.id)).toThrow('Trigger nodes cannot receive incoming connections');
    flowRepository.createEdge(step.id, other.id, { sourceHandle: 'case-0' });
    expect(() => flowRepository.createEdge(step.id, other.id, { sourceHandle: 'case-0' })).toThrow('Edge already exists');

    flowRepository.reindexHandles(step.id, 'case', 0, 1);
    expect(findRelations({ source: step.id, kind: EARS.RelKind.TRANSITIONS_TO }).map((rel) => (rel.info as { sourceHandle: string }).sourceHandle)).toEqual(['case-1']);

    flowRepository.deleteNode(other.id);
    expect(flowRepository.flowEdges(flow.id)).toEqual([]);
    expect(flowRepository.flowNodes(flow.id).map((node) => node.id).sort()).toEqual([entry.id, step.id].sort());
  });

  it('moves an edge in place with its handles, and refuses a move that isn\'t allowed, leaving the edge as it was', () => {
    const flow = flowRepository.createFlow();
    const entry = flowRepository.createNode(flow.id, { nodeType: 'listener', label: 'Entry' });
    const a = flowRepository.createNode(flow.id, { nodeType: 'action' });
    const b = flowRepository.createNode(flow.id, { nodeType: 'action' });
    const c = flowRepository.createNode(flow.id, { nodeType: 'action' });
    const { relId } = flowRepository.createEdge(a.id, b.id, { sourceHandle: 'case-0' });
    flowRepository.createEdge(a.id, c.id, { sourceHandle: 'case-1' });
    const edges = () => findRelations({ source: a.id, kind: EARS.RelKind.TRANSITIONS_TO })
      .map((rel) => ({ id: rel.id, target: rel.target, sourceHandle: (rel.info as { sourceHandle?: string }).sourceHandle }));

    // Onto another handle and target: the same edge, its own handle not counted as busy
    flowRepository.updateEdge(relId, { source: a.id, target: c.id, sourceHandle: 'case-2' });
    expect(edges()).toContainEqual({ id: relId, target: c.id, sourceHandle: 'case-2' });
    flowRepository.updateEdge(relId, { source: a.id, target: c.id, sourceHandle: 'case-2' });

    const before = edges();
    expect(() => flowRepository.updateEdge(relId, { source: a.id, target: entry.id, sourceHandle: 'case-2' }))
      .toThrow('Trigger nodes cannot receive incoming connections');
    expect(() => flowRepository.updateEdge(relId, { source: a.id, target: b.id, sourceHandle: 'case-1' }))
      .toThrow('Source handle already has an outgoing connection');
    expect(edges()).toEqual(before);
  });

  // Two edges between the same pair of nodes, one per handle, are two edges: listed apart and removed together
  it('lists two edges between the same two nodes on different handles, and deletes both with the node', () => {
    const sdkTypes = new Set<string>(Object.values(EARS.Entity));
    _bindEars(createEarsEngine({ isRelationKind: () => true, isRole: () => true, isEntityType: (name) => sdkTypes.has(name) }));
    const flow = flowRepository.createFlow();
    const a = flowRepository.createNode(flow.id, { nodeType: 'action' });
    const b = flowRepository.createNode(flow.id, { nodeType: 'action' });
    flowRepository.createEdge(a.id, b.id, { sourceHandle: 'case-0' });
    flowRepository.createEdge(a.id, b.id, { sourceHandle: 'case-1' });

    expect(flowRepository.flowEdges(flow.id).map(({ source, target, sourceHandle }) => ({ source, target, sourceHandle })).sort((x, y) => x.sourceHandle!.localeCompare(y.sourceHandle!)))
      .toEqual([
        { source: a.id, target: b.id, sourceHandle: 'case-0' },
        { source: a.id, target: b.id, sourceHandle: 'case-1' },
      ]);

    const handleEdges = findRelations({ source: a.id, kind: EARS.RelKind.TRANSITIONS_TO }).map((rel) => rel.id);
    expect(handleEdges).toHaveLength(2);
    flowRepository.deleteNode(b.id);
    expect(findRelations({ source: a.id, kind: EARS.RelKind.TRANSITIONS_TO })).toEqual([]);
    expect(flowRepository.flowEdges(flow.id)).toEqual([]);
  });

  describe('importing a flow again', () => {
    const demo = (steps: string[], root = false) => compileFlowDSL(
      { Demo: { ...(root && { root: true }), tracks: [{ event: 'flow.entry', exits: [steps.map((action) => ({ type: 'action', action }))] }] } },
      { actions: actionIds() },
    );
    let ids: Map<string, EARS.EntityId>;
    const actionIds = () => ids;
    beforeEach(() => {
      ids = new Map([
        ['Greet', actionRepository.create({ label: 'Greet', actionFn: 'return 1' }).id],
        ['Wave', actionRepository.create({ label: 'Wave', actionFn: 'return 2' }).id],
      ]);
    });
    const nodeIds = (flowId: EARS.EntityId) => flowRepository.flowNodes(flowId).map((node) => node.id).sort();
    const edgeIds = (flowId: EARS.EntityId) => flowRepository.flowEdges(flowId).map((edge) => edge.id).sort();
    const rows = (flowId: EARS.EntityId) => [flowId, ...nodeIds(flowId)].map((id) => [id, boundEars().getRow(id)]);

    it('refuses a file linking from something it does not write, before changing anything', () => {
      const { flowIds: [flowId] } = flowRepository.importFromDSL(demo(['Greet', 'Wave']));
      const oneStep = demo(['Greet']);
      const broken = { ...oneStep, relation: [...oneStep.relation, { source: 'Node-missing', kind: EARS.RelKind.TRANSITIONS_TO, target: flowId }] };
      expect(() => flowRepository.importFromDSL(broken as typeof oneStep)).toThrow(/links from Node-missing, which it doesn't write/);
      expect(nodeIds(flowId)).toHaveLength(3);
    });

    it('changes nothing when the file is the same', () => {
      const { flowIds: [flowId] } = flowRepository.importFromDSL(demo(['Greet', 'Wave']));
      const before = { rows: rows(flowId), edges: edgeIds(flowId), relations: findRelations({ source: flowId }).map((r) => r.id) };

      expect(flowRepository.importFromDSL(demo(['Greet', 'Wave'])).flowIds).toEqual([flowId]);
      expect({ rows: rows(flowId), edges: edgeIds(flowId), relations: findRelations({ source: flowId }).map((r) => r.id) }).toEqual(before);
    });

    it('removes a dropped node with its edges, and keeps the ids of what stays', () => {
      const { flowIds: [flowId] } = flowRepository.importFromDSL(demo(['Greet', 'Wave']));
      const before = nodeIds(flowId);
      expect(before).toHaveLength(3);
      const greetNode = flowRepository.flowNodes(flowId).find((node) => node.actionId === ids.get('Greet'))!;
      const kept = flowRepository.flowEdges(flowId).find((edge) => edge.target === greetNode.id)!;

      flowRepository.importFromDSL(demo(['Greet']));
      const after = nodeIds(flowId);
      expect(after).toHaveLength(2);
      expect(before).toEqual(expect.arrayContaining(after));
      for (const gone of before.filter((id) => !after.includes(id))) expect(untypedQuery.ids(gone).exists()).toBe(false);
      expect(untypedQuery(EARS.Entity.Node).count()).toBe(2);
      expect(edgeIds(flowId)).toEqual([kept.id]);
    });

    it('keeps what points into the flow and its nodes, and the fields the file does not declare', () => {
      const { flowIds: [flowId] } = flowRepository.importFromDSL(demo(['Greet', 'Wave']));
      const greetNode = flowRepository.flowNodes(flowId).find((node) => node.actionId === ids.get('Greet'))!;
      // Another flow's node, naming the flow and wired to one of its nodes
      const outside = untypedCreate(EARS.Entity.Node, { nodeType: 'subflow', label: 'Run Demo' }).link(EARS.RelKind.INSTANCE_OF, flowId).link(EARS.RelKind.TRANSITIONS_TO, greetNode.id).id();
      boundEars().write(flowId).set('contentKey', 'pack:flows/Demo').set('description', 'mine');

      flowRepository.importFromDSL(demo(['Greet']));
      expect(findRelations({ source: outside }).map((r) => [r.kind, r.target]).sort()).toEqual(
        [[EARS.RelKind.INSTANCE_OF, flowId], [EARS.RelKind.TRANSITIONS_TO, greetNode.id]].sort(),
      );
      expect(boundEars().getRow(flowId)).toMatchObject({ contentKey: 'pack:flows/Demo', description: 'mine', label: 'Demo' });
    });

    it('keeps a step\'s node when its type changes, but none of the old type\'s fields', () => {
      const flow = (step: { type: string } & Record<string, unknown>) => compileFlowDSL(
        { Demo: { tracks: [{ event: 'flow.entry', exits: [[{ label: 'S', ...step }]] }] } },
        { actions: actionIds(), prompts: new Map() },
      );
      const { flowIds: [flowId] } = flowRepository.importFromDSL(flow({ type: 'action', action: 'Greet', params: { n: 1 } }));
      const before = flowRepository.flowNodes(flowId).find((node) => node.nodeType === 'action')!;
      expect(before).toMatchObject({ actionId: ids.get('Greet'), params: { n: 1 } });

      flowRepository.importFromDSL(flow({ type: 'llm', model: 'x:y' }));
      const after = boundEars().getRow(before.id) as Record<string, unknown>;
      expect(after).toMatchObject({ nodeType: 'llm', model: 'x:y', label: 'S' });
      expect(after).not.toHaveProperty('actionId');
      expect(after).not.toHaveProperty('params');
    });

    it('keeps the root role when the file does not say root, and grants it when it does', () => {
      const { flowIds: [flowId] } = flowRepository.importFromDSL(demo(['Greet'], true));
      expect(flowRepository.rootFlow()).toBe(flowId);

      flowRepository.importFromDSL(demo(['Greet', 'Wave']));
      expect(flowRepository.rootFlow()).toBe(flowId);
    });

    it('leaves everything as it was when the import throws part way', () => {
      const { flowIds: [flowId] } = flowRepository.importFromDSL(demo(['Greet', 'Wave']));
      const before = { rows: rows(flowId), edges: edgeIds(flowId) };
      const oneStep = demo(['Greet']);
      // A row of a type nothing registers, which fails after the dropped node and its edges are gone
      const broken = { ...oneStep, entity: [...oneStep.entity, { id: 'Unknown-1', entityType: 'Unknown' }] };

      expect(() => flowRepository.importFromDSL(broken as typeof oneStep)).toThrow(/not a registered entity type/);
      expect({ rows: rows(flowId), edges: edgeIds(flowId) }).toEqual(before);
      expect(untypedQuery(EARS.Entity.Node).count()).toBe(3);
    });
  });
});

describe('actionRepository and promptRepository', () => {
  it('create, find by label, update and soft-delete', () => {
    const action = actionRepository.create({ label: 'Greet', actionFn: 'return 1' });
    const prompt = promptRepository.create({ label: 'Hello', templateFn: 'return "hi"' });
    expect(action).toMatchObject({ entityType: 'Action', input: {}, shortCode: expect.stringMatching(/^ACT/) });
    expect(actionRepository.byLabel('Greet')?.id).toBe(action.id);
    expect(promptRepository.byLabel('Hello')?.id).toBe(prompt.id);

    actionRepository.update(action.id, { description: 'Says hi' });
    expect(actionRepository.byId(action.id)?.description).toBe('Says hi');

    actionRepository.delete(action.id);
    promptRepository.delete(prompt.id);
    expect(actionRepository.all()).toEqual([]);
    expect(promptRepository.all()).toEqual([]);
    expect(untypedQuery.withTrashed.ids([action.id]).pickOne(['trashedAt'])?.trashedAt).toEqual(expect.any(Number));
  });

  it('refuse an action or prompt without its label or body, and a missing id', () => {
    expect(() => actionRepository.create({ label: ' ', actionFn: 'return 1' })).toThrow('Label is required');
    expect(() => promptRepository.create({ label: 'P', templateFn: '' })).toThrow('Template is required');
    expect(() => actionRepository.update('Action-missing' as EARS.EntityId, {})).toThrow('Action Action-missing not found');
    expect(() => promptRepository.delete('Prompt-missing' as EARS.EntityId)).toThrow('Prompt Prompt-missing not found');
  });
});

it('refuses new nodes with unavailable or unknown providers before writing data', () => {
  const flow = flowRepository.createFlow(); const listener = testPacks.steps.get('listener')!;
  try {
    testPacks.steps.delete('listener');
    expect(() => flowRepository.createNode(flow.id, { nodeType: 'listener' })).toThrow('no active backend');
    expect(() => flowRepository.createNode(flow.id, { nodeType: 'missing' })).toThrow('no active backend');
    expect(flowRepository.flowNodes(flow.id)).toEqual([]);
  } finally { testPacks.steps.set('listener', listener); }
});

it.each(['retire', 'replace'] as const)('refuses writes when trigger validation can %s its provider', change => {
  const flow = flowRepository.createFlow(); const listener = testPacks.steps.get('listener')!;
  const replacement = { ...listener };
  const validating = { ...listener, trigger: { ...listener.trigger!, validate: () => {
    if (change === 'retire') testPacks.steps.delete('listener');
    else testPacks.steps.set('listener', replacement);
    return { valid: true, errors: [] };
  } } };
  try {
    testPacks.steps.set('listener', validating);
    expect(() => flowRepository.createNode(flow.id, { nodeType: 'listener' })).toThrow('backend changed while validating');
    expect(flowRepository.flowNodes(flow.id)).toEqual([]);
  } finally { testPacks.steps.set('listener', listener); }
});


it('retains declared trigger connection rules after its provider is unavailable', () => {
  const flow = flowRepository.createFlow();
  const listener = flowRepository.createNode(flow.id, { nodeType: 'listener' });
  const action = flowRepository.createNode(flow.id, { nodeType: 'action' });
  const provider = testPacks.steps.get('listener')!;
  try {
    testPacks.steps.delete('listener');
    expect(() => flowRepository.createEdge(action.id, listener.id)).toThrow('Trigger nodes cannot receive incoming connections');
    expect(flowRepository.flowEdges(flow.id)).toEqual([]);
  } finally { testPacks.steps.set('listener', provider); }
});


it('keeps declared relation fields available when updating a node without its compiler provider', () => {
  const first = actionRepository.create({ label: 'First', actionFn: 'return 1' });
  const next = actionRepository.create({ label: 'Next', actionFn: 'return 2' });
  const flow = flowRepository.createFlow();
  const node = flowRepository.createNode(flow.id, { nodeType: 'action', actionId: first.id });
  const provider = testPacks.steps.get('action')!;
  try {
    testPacks.steps.delete('action');
    flowRepository.updateNode(node.id, { actionId: next.id });
    expect(flowRepository.getNodeActionId(node.id)).toBe(next.id);
    expect(flowRepository.node(node.id)?.actionId).toBe(next.id);
  } finally { testPacks.steps.set('action', provider); }
});
