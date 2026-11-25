import { _declarationRevision } from '@apackdev/pack-format';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePackFiles, PACK_TYPES_FACADE } from '@apackdev/pack-build';
import { PACK_SNAPSHOT_FORMAT, type PackManifest, type PackSnapshot } from '@apackdev/pack-format';
import { bundlePackTypes } from '../../src/build/types-bundler';
import { bundlePackFlowHelpers } from '../../src/build/flow-helpers-bundler';

/**
 * A dependent pack gets the flow helpers its dependency generates for itself: a helper per step with
 * the step's DSL node as its options, custom step helpers and trigger track builders. The dependency's
 * build bundles them into its snapshot; the dependent's codegen re-exports them.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-flow-helpers-'));
afterAll(() => fs.rmSync(parent, { recursive: true, force: true }));

const tsconfig = {
  compilerOptions: {
    target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true, skipLibCheck: true, noEmit: true, types: [],
    customConditions: ['@apackdev/source'], allowImportingTsExtensions: true,
  },
  include: ['src/**/*.ts'],
};

function writePack(name: string, files: Record<string, string>): string {
  const dir = path.join(parent, name);
  const all = { 'package.json': JSON.stringify({ name, type: 'module' }), 'tsconfig.json': JSON.stringify(tsconfig), ...files };
  for (const [rel, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

const baseManifest: PackManifest = {
  id: 'base-pack', name: 'Base', version: '1.0.0',
  extensions: {
    steps: {
      // A step's directory is the dirname of the first facet it names, which is where its `types.ts` and,
      // for a custom helper, its `helpers.ts` are read from
      pour: { node: { label: 'Pour' }, build: { compile: 'src/steps/pour/build.ts#compile', validate: 'src/steps/pour/build.ts#validate', getLabel: 'src/steps/pour/build.ts#getLabel' }, types: 'src/steps/pour/types.ts', dsl: { primaryField: 'cup' } },
      choose: { node: { label: 'Choose' }, build: { compile: 'src/steps/choose/build.ts#compile', validate: 'src/steps/choose/build.ts#validate', getLabel: 'src/steps/choose/build.ts#getLabel' }, types: 'src/steps/choose/types.ts', dsl: { helpers: 'src/steps/choose/helpers.ts' } },
      tick: { node: { label: 'Tick' }, kind: 'trigger', trigger: { trackField: 'every', compile: 'src/steps/tick/build.ts#compile', decompile: 'src/steps/tick/build.ts#decompile' } },
    },
  },
};

const appManifest: PackManifest = { id: 'app-pack', name: 'App', version: '1.0.0', dependencies: { 'base-pack': '*' } };

const CONSUMER = `
import { choose, entry, every, pour } from './__generated__/flow-helpers.ts';

export const tracks = [
  entry([pour('espresso', { size: 'large', label: 'pour' })]),
  every('5m', [[choose([{ when: 'thirsty', steps: [pour('water')] }])]]),
];

// @ts-expect-error size is small or large
pour('espresso', { size: 'huge' });
// @ts-expect-error an option's when is a string
choose([{ when: 1, steps: [] }]);
// @ts-expect-error a track's exits are step chains
every('5m', [pour('water')]);
`;

let app: string;
let snapshot: PackSnapshot;

beforeAll(async () => {
  const base = writePack('base-pack', {
    'src/steps/pour/types.ts': "import type { DSLNodeBase } from '@apackdev/sdk/build';\nexport interface DSLPourNode extends DSLNodeBase { type: 'pour'; cup: string; size?: 'small' | 'large' }\n",
    'src/steps/choose/types.ts': "import type { DSLStepNode } from '@apackdev/sdk/build';\nexport interface DSLChooseOption { when: string; steps: DSLStepNode[] }\n",
    'src/steps/choose/helpers.ts': [
      "import type { DSLStepNode } from '@apackdev/sdk/build';",
      "import type { DSLChooseOption } from './types.ts';",
      "export function choose(options: DSLChooseOption[]): DSLStepNode { return { type: 'choose', options }; }",
    ].join('\n'),
    'src/steps/pour/build.ts': "export const compile = () => ({});\nexport const validate = () => [];\nexport const getLabel = () => '';\n",
    'src/steps/choose/build.ts': "export const compile = () => ({});\nexport const validate = () => [];\nexport const getLabel = () => '';\n",
    'src/steps/tick/build.ts': "export function compile() { return {}; } export function decompile() { return {}; }\n",
  });
  for (const [file, content] of Object.entries(await generatePackFiles(baseManifest, { packRoot: base }))) {
    fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    fs.writeFileSync(path.join(base, file), content);
  }
  const bundled = await bundlePackFlowHelpers(base, path.join(base, 'dist', 'types'));
  if (!bundled.success) throw new Error(bundled.error);
  const facade = await bundlePackTypes(base, path.join(base, 'dist', 'types', 'pack-types.d.ts'));
  if (!facade.success) throw new Error(facade.error);
  snapshot = { declarationRevision: _declarationRevision(baseManifest), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: { [PACK_TYPES_FACADE]: facade.content }, manifest: baseManifest, format: PACK_SNAPSHOT_FORMAT, flowHelpers: bundled.flowHelpers };

  app = writePack('app-pack', { 'src/consumer.ts': CONSUMER });
  for (const [file, content] of Object.entries(await generatePackFiles(appManifest, { packRoot: app, depSnapshots: new Map([['base-pack', snapshot]]) }))) {
    fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    fs.writeFileSync(path.join(app, file), content);
  }
});

describe("a dependency's flow helpers", () => {
  it('are re-exported under the names the dependency gives them', () => {
    expect(snapshot.flowHelpers!.exports).toEqual(['choose', 'entry', 'every', 'on', 'pour']);
  });

  it("type the dependency's step options, custom helpers and track builders as the dependency does", () => {
    const types = fs.readFileSync(path.join(app, 'src/__generated__/deps/base-pack.flow-helpers.d.ts'), 'utf-8');
    expect(types).not.toContain('Record<string, unknown>');
    const program = ts.createProgram({
      rootNames: [path.join(app, 'src/consumer.ts')],
      options: { ...tsconfig.compilerOptions, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    });
    // The pack's own files; the SDK source they reach isn't checked here
    const diagnostics = ts.getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName.startsWith(path.join(app, 'src')))
      .map((d) => `${path.relative(app, d.file!.fileName)}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    expect(diagnostics).toEqual([]);
  });

  it("run the dependency's helper code", async () => {
    const helpers = await import(path.join(app, 'src/__generated__/flow-helpers.ts'));
    expect(helpers.every('5m', [[helpers.choose([{ when: 'thirsty', steps: [helpers.pour('water', { size: 'small' })] }])]])).toEqual({
      every: '5m',
      label: 'Every (5m)',
      exits: [[{ type: 'choose', options: [{ when: 'thirsty', steps: [{ type: 'pour', cup: 'water', size: 'small' }] }] }]],
    });
  });
});
