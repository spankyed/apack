import { expect, it } from 'vitest';
import { ManifestSchema } from '@apackdev/sdk/build';
import { backendBindingProblem } from '../../src/packs/declaration-binding.ts';

const manifest = ManifestSchema.parse({
  id: 'contributions', name: 'Contributions', version: '1.0.0',
  data: { entities: { Item: {} }, relations: { item_link: {} } },
  extensions: {
    steps: { execute: { node: { label: 'Execute' }, build: { compile: 'build.ts#compile', validate: 'build.ts#validate', getLabel: 'build.ts#getLabel' }, runtime: { handler: 'runtime.ts#handler', waits: true } } },
    blocks: { answer: { kind: 'input', be: 'block.ts#block' } },
    artifacts: { item: { icon: 'File' } },
  },
  content: { writers: { Item: 'writer.ts#writer' }, sources: { items: { applier: 'items.ts' } } },
  migrations: { app: { '1.0.0': { description: 'Initialize', up: 'migration.ts#up' } } },
  lifecycle: { onInit: 'hooks.ts#onInit' },
});

function binding(): Record<string, unknown> {
  return {
    ears: { entities: { Item: 'Item' }, relKinds: { ITEM_LINK: 'item_link' }, roles: {} },
    steps: [{ type: 'execute', node: { label: 'Execute' }, build: { compile() {}, validate() {}, getLabel() {} }, runtime: { handler() {}, waits: true } }],
    blocks: [{ type: 'answer', kind: 'input', be: {} }], artifacts: [{ type: 'item' }],
    contentWriters: { Item: {} }, appliers: [{ key: 'items', apply() {} }],
    migrations: { app: [{ target: '1.0.0', description: 'Initialize', up() {} }] },
    lifecycle: { onInit() {} },
  };
}

it('accepts the declared backend contributions', () => {
  expect(backendBindingProblem(manifest, binding())).toBeUndefined();
});

it.each(['steps', 'blocks', 'artifacts', 'appliers'])('refuses missing, extra and duplicate %s', field => {
  const key = field === 'appliers' ? 'key' : 'type';
  const original = binding()[field] as Record<string, unknown>[];
  for (const entries of [[], [...original, { [key]: 'ghost' }], [...original, original[0]], null]) {
    expect(backendBindingProblem(manifest, { ...binding(), [field]: entries }))
      .toBe(`Pack "contributions" runtime ${field} does not match its accepted declarations`);
  }
});

it.each([
  ['ears.entities', { ears: { entities: { Item: 'Other' }, relKinds: { ITEM_LINK: 'item_link' }, roles: {} } }],
  ['ears.relKinds', { ears: { entities: { Item: 'Item' }, relKinds: {}, roles: {} } }],
  ['contentWriters', { contentWriters: { Other: {} } }],
  ['artifacts.item.fe', { artifacts: [{ type: 'item', fe: {} }] }],
  ['blocks.answer.kind', { blocks: [{ type: 'answer', kind: 'display', be: {} }] }],
  ['blocks.answer.be', { blocks: [{ type: 'answer', kind: 'input' }] }],
  ['blocks.answer.be', { blocks: [{ type: 'answer', kind: 'input', be: null }] }],
  ['blocks.answer.fe', { blocks: [{ type: 'answer', kind: 'input', be: {}, fe: {} }] }],
  ['steps.execute.kind', { steps: [{ type: 'execute', kind: 'trigger' }] }],
  ['steps.execute.node', { steps: [{ type: 'execute', build: {} }] }],
  ['steps.execute.node', { steps: [{ type: 'execute', node: null, build: {} }] }],
  ['steps.execute.build', { steps: [{ type: 'execute', node: { label: 'Execute' } }] }],
  ['steps.execute.node', { steps: [{ type: 'execute', node: { label: 'Different' }, build: { compile() {}, validate() {}, getLabel() {} }, runtime: { handler() {}, waits: true } }] }],
  ['steps.execute.node', { steps: [{ type: 'execute', node: { label: 'Execute', defaults: { foreign: true } }, build: { compile() {}, validate() {}, getLabel() {} }, runtime: { handler() {}, waits: true } }] }],
  ['steps.execute.fe', { steps: [{ type: 'execute', fe: {} }] }],
  ['steps.execute.runtime', { steps: [{ type: 'execute', node: { label: 'Execute' }, build: { compile() {}, validate() {}, getLabel() {} } }] }],
  ['steps.execute.runtime.handler', { steps: [{ type: 'execute', node: { label: 'Execute' }, build: { compile() {}, validate() {}, getLabel() {} }, runtime: { waits: true } }] }],
  ['steps.execute.runtime.waits', { steps: [{ type: 'execute', node: { label: 'Execute' }, build: { compile() {}, validate() {}, getLabel() {} }, runtime: { handler() {} } }] }],
  ['migrations.app', { migrations: { app: [] } }],
  ['migrations.app.1.0.0', { migrations: { app: [{ target: '1.0.0', description: 'Initialize' }] } }],
  ['migrations', { migrations: { unknown: [] } }],
  ['lifecycle', { lifecycle: undefined }],
  ['lifecycle.onInit', { lifecycle: { onInit: true } }],
] as const)('refuses mismatched %s', (path, change) => {
  expect(backendBindingProblem(manifest, { ...binding(), ...change }))
    .toBe(`Pack "contributions" runtime ${path} does not match its accepted declarations`);
});

it('does not admit a malformed handler when only runtime flags are declared', () => {
  const declaration = ManifestSchema.parse({ id: 'flags', name: 'Flags', version: '1.0.0',
    extensions: { steps: { wait: { node: { label: 'Execute' }, runtime: { waits: true } } } } });
  for (const handler of [null, 'handler', 0]) {
    expect(backendBindingProblem(declaration, {
      steps: [{ type: 'wait', node: { label: 'Execute' }, runtime: { waits: true, handler } }],
    })).toContain('steps.wait.runtime.handler');
  }
});


it('refuses changed migration descriptions and missing/extra hook implementations', () => {
  const changed = binding();
  changed.migrations = { app: [{ target: '1.0.0', description: 'Changed', up() {} }] };
  expect(backendBindingProblem(manifest, changed)).toContain('migrations.app.1.0.0');
  for (const lifecycle of [{}, { onInit: undefined }, { onInit() {}, onShutdown() {} }]) {
    expect(backendBindingProblem(manifest, { ...binding(), lifecycle })).toContain('lifecycle');
  }
});
