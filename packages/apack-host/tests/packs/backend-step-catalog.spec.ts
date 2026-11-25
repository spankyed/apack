import { afterEach, expect, it, vi } from 'vitest';
import { startTestRuntime, resetTestData, nativePackDeclarationFixture } from '@apackdev/sdk/testing';
import { getStepBinding, getStepDeclaration, stepRegistry, type StepDefinition, type TriggerFacet } from '@apackdev/sdk/steps';
import { captureStepBinding } from '../../src/packs/step-bindings.ts';
import { actionRepository, flowRepository } from '@apackdev/sdk/repositories';
import { _declarationRevision, type PackManifest } from '@apackdev/pack-format';
import { createPackRegistry, type PackOrigin } from '../../src/packs/registry.ts';

// Backend reader tests use actual registry admission and an in-memory engine.
const registry = createPackRegistry();
startTestRuntime({ packs: registry });
afterEach(() => {
  if (registry.step('memo')) registry.unregisterPack('author');
  registry.catalog.setNative([]); registry.catalog.setSources([]); resetTestData();
});
function provider() {
  const handler = vi.fn(); const conditions = [{ label: 'First' }];
  const step: StepDefinition = { type: 'memo', node: { label: 'Memo', defaults: { conditions } }, runtime: { handler } };
  return { handler, conditions, step };
}

function editableTrigger() {
  const validate = vi.fn<NonNullable<TriggerFacet['validate']>>(() => ({ valid: true, errors: [] }));
  const step: StepDefinition = {
    type: 'memo', kind: 'trigger', node: { label: 'Memo' },
    trigger: { trackField: 'memo', compile: () => ({}), decompile: () => ({}), validate },
  };
  registry.catalog.setNative([nativePackDeclarationFixture({ id: 'author', steps: [step] })]);
  registry.registerPack({ id: 'author', steps: [step] });
  const flow = flowRepository.createFlow();
  const node = flowRepository.createNode(flow.id, { nodeType: 'memo', eventType: 'initial' });
  const before = flowRepository.node(node.id);
  validate.mockClear();
  return { validate, step, node, before };
}

it.each(['unloaded', 'changed declaration', 'missing declaration'] as const)(
  'refuses node updates with a %s provider without skipping its declared validator', state => {
    const f = editableTrigger();
    if (state === 'unloaded') registry.unregisterPack('author');
    else if (state === 'missing declaration') registry.catalog.setNative([]);
    else registry.catalog.setNative([nativePackDeclarationFixture({ id: 'author', steps: [{ ...f.step, node: { label: 'New revision' } }] })]);

    expect(() => flowRepository.updateNode(f.node.id, { label: 'Changed', eventType: 'updated' }))
      .toThrow(state === 'missing declaration' ? 'no declaration for editing' : 'no active backend');
    expect(f.validate).not.toHaveBeenCalled();
    expect(flowRepository.node(f.node.id)).toEqual(f.before);
  },
);

it.each(['retire', 'replace', 'change declaration'] as const)('refuses node updates when validation can %s its provider', change => {
  const f = editableTrigger();
  f.validate.mockImplementationOnce(() => {
    if (change === 'retire') registry.unregisterPack('author');
    else if (change === 'replace') registry.replacePack({ id: 'author', steps: [{ ...f.step }] });
    else registry.catalog.setNative([nativePackDeclarationFixture({ id: 'author', steps: [{ ...f.step, node: { label: 'New revision' } }] })]);
    return { valid: true, errors: [] };
  });

  expect(() => flowRepository.updateNode(f.node.id, { label: 'Changed', eventType: 'updated' })).toThrow('backend changed while validating');
  expect(f.validate).toHaveBeenCalledOnce();
  expect(flowRepository.node(f.node.id)).toEqual(f.before);
});

it('preserves node fields when the accepted validator rejects an update', () => {
  const f = editableTrigger();
  f.validate.mockReturnValueOnce({ valid: false, errors: ['Invalid memo'] });
  expect(() => flowRepository.updateNode(f.node.id, { label: 'Changed', eventType: 'updated' })).toThrow('Invalid memo node: Invalid memo');
  expect(f.validate).toHaveBeenCalledOnce();
  expect(flowRepository.node(f.node.id)).toEqual(f.before);
});

it.each(['action', null, ''] as const)('refuses changing a node type to %s before validation or writes', nodeType => {
  const f = editableTrigger();
  // The public repository also receives untyped input from authored code and RPC callers.
  const updates = JSON.parse(JSON.stringify({ nodeType, eventType: 'updated' }));
  expect(() => flowRepository.updateNode(f.node.id, updates)).toThrow("A node's type cannot be changed");
  expect(f.validate).not.toHaveBeenCalled();
  expect(flowRepository.node(f.node.id)).toEqual(f.before);
});

it('accepts a full-node update with the same type and validates before changing fields', () => {
  const f = editableTrigger();
  flowRepository.updateNode(f.node.id, { ...f.node, label: 'Updated', eventType: 'updated' });
  expect(f.validate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ nodeType: 'memo', label: 'Updated' }));
  expect(flowRepository.node(f.node.id)).toMatchObject({ label: 'Updated', eventType: 'updated' });
});

it('edits fields and relations without an active provider when no validator is declared', () => {
  const f = provider();
  f.step.build = { compile: () => ({ entity: {}, relations: [] }), validate: () => [], getLabel: () => 'Memo',
    relation: { field: 'memoId', targetEntity: 'Action' } };
  registry.catalog.setNative([nativePackDeclarationFixture({ id: 'author', steps: [f.step] })]);
  registry.registerPack({ id: 'author', steps: [f.step] });
  const first = actionRepository.create({ label: 'First', actionFn: 'return 1' });
  const next = actionRepository.create({ label: 'Next', actionFn: 'return 2' });
  const flow = flowRepository.createFlow();
  const node = flowRepository.createNode(flow.id, { nodeType: 'memo', memoId: first.id });
  registry.unregisterPack('author');
  flowRepository.updateNode(node.id, { label: 'Updated', memoId: next.id });
  expect(flowRepository.node(node.id)).toMatchObject({ label: 'Updated', memoId: next.id });
  expect(flowRepository.getNodeActionId(node.id)).toBe(next.id);
  expect(f.handler).not.toHaveBeenCalled();
  const before = flowRepository.node(node.id);
  expect(() => flowRepository.updateNode(node.id, { nodeType: 'action' })).toThrow("A node's type cannot be changed");
  expect(flowRepository.node(node.id)).toEqual(before);
});

it.each(['create', 'update'] as const)('refuses a validator changing node type during %s', operation => {
  const f = editableTrigger();
  f.validate.mockImplementationOnce(node => {
    node.nodeType = 'action';
    return { valid: true, errors: [] };
  });
  const flow = flowRepository.createFlow();
  expect(() => operation === 'create'
    ? flowRepository.createNode(flow.id, { nodeType: 'memo' })
    : flowRepository.updateNode(f.node.id, { label: 'Changed' })).toThrow("A node's type cannot be changed");
  expect(flowRepository.node(f.node.id)).toEqual(f.before);
  expect(flowRepository.flowNodes(flow.id)).toEqual([]);
});

it('retains native declaration defaults after runtime unload without invoking the provider', () => {
  const f = provider(); const declaration = nativePackDeclarationFixture({ id: 'author', steps: [f.step] });
  registry.catalog.setNative([declaration]);
  registry.registerPack({ id: 'author', steps: [f.step] });
  const binding = getStepBinding('memo')!;
  expect(binding.packId).toBe('author'); expect(binding.registrationId).toBeTruthy();
  expect(binding.declarationRevision).toBeUndefined(); expect(binding.buildRevision).toBeUndefined();
  registry.unregisterPack('author');
  expect(getStepDeclaration('memo')?.declaration.node.label).toBe('Memo');
  expect(stepRegistry.createNodeDefaults('memo')).toEqual({ nodeType: 'memo', label: 'Memo', conditions: [{ label: 'First' }] });
  expect(getStepBinding('memo')).toBeUndefined(); expect(f.handler).not.toHaveBeenCalled();
  const flow = flowRepository.createFlow();
  expect(() => flowRepository.createNode(flow.id, { nodeType: 'memo' })).toThrow('no active backend');
  expect(flowRepository.flowNodes(flow.id)).toEqual([]);
});

it('publishes a replacement runtime atomically and preserves the accepted provider after rejection', () => {
  const f = provider();
  registry.catalog.setNative([nativePackDeclarationFixture({ id: 'author', steps: [f.step] })]);
  registry.registerPack({ id: 'author', steps: [f.step] });
  const original = getStepBinding('memo')!;
  expect(() => registry.replacePack({ id: 'author', steps: [{ ...f.step, node: { label: 'Wrong' } }] }))
    .toThrow();
  expect(getStepBinding('memo')).toBe(original);
  const next = provider();
  registry.replacePack({ id: 'author', steps: [next.step] });
  const replaced = getStepBinding('memo')!;
  expect(replaced.registrationId).not.toBe(original.registrationId);
  expect(replaced.binding.runtime!.handler).toBe(next.handler);
  const flow = flowRepository.createFlow();
  expect(flowRepository.createNode(flow.id, { nodeType: 'memo' })).toMatchObject({ label: 'Memo', conditions: [{ label: 'First' }] });
  expect(f.handler).not.toHaveBeenCalled(); expect(next.handler).not.toHaveBeenCalled();
});

it('owns accepted source origin/declarations before caller mutation and refuses a later declaration revision', () => {
  const f = provider();
  const manifest: PackManifest = { id: 'author', name: 'Author', version: '1.0.0', extensions: { steps: {
    memo: { node: { label: 'Memo', defaults: { conditions: [{ label: 'First' }] } }, runtime: { handler: 'src/provider.ts#handler' } },
  } } };
  const revision = _declarationRevision(manifest);
  registry.catalog.setSources([{ manifest, dir: '/source/author', declarationRevision: revision }]);
  const origin: PackOrigin = { id: manifest.id, name: manifest.name, version: manifest.version, dir: '/source/author', declarationRevision: revision, manifest };
  registry.registerPack({ id: 'author', declarationRevision: revision, steps: [f.step] }, origin);
  const accepted = getStepBinding('memo')!;
  manifest.extensions!.steps!.memo.node.label = 'Mutated'; origin.declarationRevision = 'mutated';
  expect(getStepBinding('memo')).toBe(accepted);
  expect(registry.packOrigin('author')?.declarationRevision).toBe(revision);
  expect(registry.packOrigin('author')?.manifest?.extensions?.steps?.memo.node.label).toBe('Memo');
  const next = { ...manifest, extensions: { steps: { memo: { ...manifest.extensions!.steps!.memo, node: { label: 'Next' } } } } };
  registry.catalog.setSources([{ manifest: next, dir: origin.dir, declarationRevision: _declarationRevision(next) }]);
  expect(getStepBinding('memo')).toBeUndefined(); expect(stepRegistry.createNodeDefaults('memo').label).toBe('Next');
  expect(f.handler).not.toHaveBeenCalled();
});


it('owns relation and trigger data while retaining executable callback identity', () => {
  const compile = vi.fn(() => ({ entity: {}, relations: [] }));
  const validate = vi.fn(() => []);
  const compileTrigger = vi.fn(() => ({}));
  const relation = { field: 'memoId', targetEntity: 'Memo' };
  const queryFields = ['memoId'];
  const step: StepDefinition = { type: 'memo', build: {
    compile, validate, getLabel: () => 'Memo', relation,
  }, trigger: { trackField: 'memo', compile: compileTrigger, decompile: () => ({}), queryFields } };
  const accepted = captureStepBinding(step);
  relation.field = 'mutated'; queryFields.push('mutated');
  expect(accepted.build!.relation).toEqual({ field: 'memoId', targetEntity: 'Memo' });
  expect(accepted.trigger!.queryFields).toEqual(['memoId']);
  expect(Reflect.set(accepted.build!, 'compile', vi.fn())).toBe(false);
  expect(Reflect.set(accepted.trigger!, 'trackField', 'mutated')).toBe(false);
  expect(accepted.build!.compile).toBe(compile);
  expect(accepted.build!.validate).toBe(validate);
  expect(accepted.trigger!.compile).toBe(compileTrigger);
  expect(compile).not.toHaveBeenCalled(); expect(compileTrigger).not.toHaveBeenCalled();
});
