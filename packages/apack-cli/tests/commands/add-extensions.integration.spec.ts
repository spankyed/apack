// `apack pack add step|artifact|block|migration` scaffold what the host uses: flow helpers generate valid names
// and types for a kebab-case step, and components declare the props and emits the host passes
//
// @slow: scaffolded packs run through generate-entries and type-checked with tsc, as an author would

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { init } from '../../src/commands/init';
import { generateEntries } from '../../src/commands/generate-entries';
import { packRuleProblems } from '../../src/build/pack-rules.ts';
import { callCli, typecheckPack } from '../_support/pack-builds.ts';
import { runCommand } from '../_support/run-command.ts';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'node_modules', '.bin');

let tmp: string;
let pack: string;


const read = (file: string) => fs.readFileSync(path.join(pack, file), 'utf-8');
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(pack, file)), { recursive: true });
  fs.writeFileSync(path.join(pack, file), content);
};
const readManifest = () => JSON.parse(read('apack.json'));
const writeManifest = (manifest: unknown) => write('apack.json', JSON.stringify(manifest, null, 2) + '\n');

async function add(kind: string, args: string[], root: string): Promise<void> {
  const result = await callCli(root, 'add', [kind, ...args]);
  if (result.code !== 0) throw new Error(result.output);
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-add-extensions-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    await init(['demo-pack']);
  } finally {
    process.chdir(cwd);
  }
  pack = path.join(tmp, 'demo-pack');
  // The trigger case's own pristine scaffold, copied before any case adds to the shared one
  fs.cpSync(pack, path.join(tmp, 'trigger-pack'), { recursive: true, verbatimSymlinks: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(pack, 'node_modules'), 'dir');
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('apack pack add step', () => {
  it('names the DSL node interface DSL<Type>Node and the form takes node/resources, emitting update-node and close', async () => {
    await add('step', ['my-step'], pack);
    const dir = 'src/extensions/steps/my-step';

    expect(read(`${dir}/types.ts`)).toMatch(/export interface DSLMyStepNode extends DSLNodeBase \{/);
    expect(read(`${dir}/types.ts`)).toMatch(/export interface MyStepNode extends NodeBase \{\s*nodeType: 'my-step';/);
    expect(read(`${dir}/build.ts`)).toContain('node as unknown as DSLMyStepNode');
    const form = read(`${dir}/form.vue`);
    expect(form).toMatch(/defineProps<\{[\s\S]*node: MyStepNode;/);
    expect(form).toMatch(/'update-node': \[updates: Record<string, unknown>\];/);
  });

  it('generates flow helpers for the kebab-case step that typecheck with tsc', async () => {
    await add('step', ['my-other-step'], pack);
    const manifest = readManifest();
    manifest.extensions.steps['my-step'].dsl = { primaryField: 'label' };
    manifest.extensions.steps['my-other-step'].dsl = {};
    writeManifest(manifest);
    await generateEntries([], pack);

    const flowHelpers = read('src/__generated__/flow-helpers.ts');
    expect(flowHelpers).toContain('export function myStep(label: string, opts?: { [K in keyof DSLMyStepNode as');
    expect(flowHelpers).toContain('export function myOtherStep(label?: string): DSLStepNode {');
    // The step's compiled node joins the pack's Node rows
    expect(read('src/__generated__/types.ts')).toContain('export type NodeEntity = MyStepNode | MyOtherStepNode;');

    write('src/flow-helpers-usage.ts', [
      "import type { DSLStepNode } from '@apackdev/sdk/build';",
      "import { myStep, myOtherStep } from '#generated/flow-helpers';",
      "export const nodes: DSLStepNode[] = [myStep('Hello', { description: 'd' }), myOtherStep()];",
      '',
    ].join('\n'));
    const tsc = await typecheckPack(pack);
    fs.rmSync(path.join(pack, 'src/flow-helpers-usage.ts'));
    expect(tsc.code, tsc.output).toBe(0);
  }, 3 * 60_000 + 20_000);
});

describe('apack pack add step in a pack without steps', () => {
  it('declares the first step, in a manifest that names none', async () => {
    const bare = path.join(tmp, 'bare-pack');
    // A manifest with no features is the subject here, so it is written verbatim rather than varied
    packFixture({ at: bare, rawManifest: { id: 'bare-pack', name: 'Bare', version: '1.0.0' } });
    fs.writeFileSync(path.join(bare, 'package.json'), JSON.stringify({ name: 'bare-pack', type: 'module' }));
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(bare, 'node_modules'), 'dir');

    await add('step', ['ping'], bare);

    const manifest = JSON.parse(fs.readFileSync(path.join(bare, 'apack.json'), 'utf-8'));
    expect(manifest.extensions.steps).toEqual({
      ping: {
        kind: 'step',
        node: { label: 'Ping', defaultLabel: 'Ping' },
        build: { compile: 'src/extensions/steps/ping/build.ts#compile', validate: 'src/extensions/steps/ping/build.ts#validate', getLabel: 'src/extensions/steps/ping/build.ts#getLabel' },
        types: 'src/extensions/steps/ping/types.ts',
        fe: { colorKey: 'indigo', nodeConfig: { icon: 'Box',
          connectionRules: { inputs: -1, outputs: -1 }, category: 'logic', isImplemented: true },
          components: { form: { entry: 'src/extensions/steps/ping/form.vue', load: 'lazy' } } },
      },
    });
    expect(fs.existsSync(path.join(bare, 'src/extensions/steps/ping/build.ts'))).toBe(true);
  });

  it('scaffolds a hyphenated trigger with declared track metadata and checked callbacks', async () => {
    // Its own scaffolded pack rather than the shared one: `init` is what writes the tsconfig `typecheckPack`
    // needs, and a trigger added to the shared pack would join the `NodeEntity` union another case pins
    const triggerPack = path.join(tmp, 'trigger-pack');
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(triggerPack, 'node_modules'), 'dir');

    await add('step', ['heart-beat', '--trigger'], triggerPack);

    const manifest = JSON.parse(fs.readFileSync(path.join(triggerPack, 'apack.json'), 'utf-8'));
    expect(manifest.extensions.steps['heart-beat']).toEqual({
      kind: 'trigger',
      node: { label: 'Heart Beat', defaultLabel: 'On heart-beat', defaults: { source: 'change me' } },
      trigger: { trackField: 'heartBeat', persistent: false, validate: 'src/extensions/steps/heart-beat/trigger.ts#validate', compile: 'src/extensions/steps/heart-beat/trigger.ts#compile', decompile: 'src/extensions/steps/heart-beat/trigger.ts#decompile' },
      types: 'src/extensions/steps/heart-beat/types.ts',
        fe: { colorKey: 'blue', nodeConfig: { icon: 'Radio',
          connectionRules: { inputs: 0, outputs: -1 }, category: 'trigger', isImplemented: true },
          components: { form: { entry: 'src/extensions/steps/heart-beat/form.vue', load: 'lazy' } } },
    });
    expect(fs.existsSync(path.join(triggerPack, 'src/extensions/steps/heart-beat/trigger.ts'))).toBe(true);
    expect(fs.existsSync(path.join(triggerPack, 'src/extensions/steps/heart-beat/build.ts'))).toBe(false);

    expect(fs.readFileSync(path.join(triggerPack, 'src/__generated__/flow-helpers.ts'), 'utf8'))
      .toContain('export function heartBeat(heartBeat: string');
    const tsc = await typecheckPack(triggerPack);
    expect(tsc.code, tsc.output).toBe(0);
  }, 3 * 60_000 + 20_000);

  it('refuses a step type the manifest already declares, leaving the manifest as it was', async () => {
    const bare = path.join(tmp, 'bare-pack');
    const before = fs.readFileSync(path.join(bare, 'apack.json'), 'utf-8');
    await expect(add('step', ['ping'], bare)).rejects.toThrow('Step "ping" already exists in manifest');
    expect(fs.readFileSync(path.join(bare, 'apack.json'), 'utf-8')).toBe(before);
  });
});

describe('apack pack add artifact and block', () => {
  it('scaffolds an artifact viewer taking artifact, declared with its icon and viewer', async () => {
    await add('artifact', ['chart'], pack);
    await add('artifact', ['table', '--icon', 'Table2'], pack);

    const viewer = read('src/extensions/artifacts/viewers/chart-artifact.vue');
    expect(viewer).toContain("import type { ArtifactItem } from '@apackdev/sdk/artifacts';");
    expect(viewer).toContain('defineProps<{ artifact: ArtifactItem }>();');

    expect(readManifest().extensions.artifacts).toEqual({
      chart: { icon: 'FileText', fe: 'src/extensions/artifacts/viewers/chart-artifact.vue' },
      table: { icon: 'Table2', fe: 'src/extensions/artifacts/viewers/table-artifact.vue' },
    });
  }, 2 * 60_000 + 20_000);

  it('refuses an artifact type the manifest already declares, leaving the manifest as it was', async () => {
    const before = readManifest();
    await expect(add('artifact', ['chart'], pack)).rejects.toThrow('Artifact "chart" already exists in manifest');
    expect(readManifest()).toEqual(before);
  });

  it('scaffolds display blocks taking their props and input blocks taking disabled/response, emitting submit/cancel', async () => {
    await add('block', ['rating'], pack);
    await add('block', ['color-picker', '--input'], pack);

    const display = read('src/extensions/blocks/display/RatingBlock.vue');
    expect(display).toContain('defineProps<{ text?: string }>();');
    expect(display).not.toMatch(/defineEmits/);

    const input = read('src/extensions/blocks/input/ColorPickerInput.vue');
    expect(input).toMatch(/defineProps<\{[\s\S]*label\?: string;/);
    expect(input).toMatch(/defineEmits<\{[\s\S]*submit: \[response: unknown\];/);

    expect(readManifest().extensions.blocks).toEqual({
      'rating': { fe: 'src/extensions/blocks/display/RatingBlock.vue' },
      'color-picker': { kind: 'input', fe: 'src/extensions/blocks/input/ColorPickerInput.vue' },
    });
  }, 2 * 60_000 + 20_000);

  it('refuses a block type the manifest already declares, leaving the manifest as it was', async () => {
    const before = readManifest();
    await expect(add('block', ['rating'], pack)).rejects.toThrow('Block "rating" already exists in manifest');
    expect(readManifest()).toEqual(before);
  });

  it('scaffolds single-file components and register files that typecheck with vue-tsc', async () => {
    write('tsconfig.sfc.json', JSON.stringify({ extends: './tsconfig.json', include: ['env.d.ts', 'src/**/*.ts', 'src/**/*.vue'] }));
    const vueTsc = await runCommand(path.join(BIN, 'vue-tsc'), ['--noEmit', '-p', 'tsconfig.sfc.json'], pack);
    expect(vueTsc.code, vueTsc.output).toBe(0);
  });
});

describe('apack pack add migration', () => {
  it('declares each migration under its version line and the version it targets, which the pack entry registers and tsc accepts', async () => {
    for (const args of [
      ['0.2.0'], ['--version', '0.10.1'],
      // A migration targets a release, so a prerelease files under the release it belongs to.
      ['0.11.0-beta.1'], ['0.3.16-beta.1', '--app'],
    ]) {
      const result = await callCli(pack, 'add', ['migration', ...args]);
      expect(result.code, result.output).toBe(0);
    }

    const migration = read('src/migrations/0.2.0.ts');
    expect(migration).toContain('export function up(): void');
    // The version is the manifest key and the line is the map, so the module restates neither
    expect(migration).not.toContain('target:');
    expect(readManifest().migrations).toEqual({
      pack: {
        '0.2.0': { description: 'Describe what this migration changes', up: 'src/migrations/0.2.0.ts#up' },
        '0.10.1': { description: 'Describe what this migration changes', up: 'src/migrations/0.10.1.ts#up' },
        '0.11.0': { description: 'Describe what this migration changes', up: 'src/migrations/0.11.0.ts#up' },
      },
      app: { '0.3.16': { description: 'Describe what this migration changes', up: 'src/migrations/0.3.16.ts#up' } },
    });
    expect(fs.existsSync(path.join(pack, 'src/migrations/index.ts'))).toBe(false);

    await generateEntries([], pack);
    const entry = read('src/__generated__/pack-entry.ts');
    // One array per line, each in version order, each entry with the target its key names
    expect(entry).toContain("    app: [\n      { target: '0.3.16', description: \"Describe what this migration changes\", up: __migration_app_0_3_16 },\n    ],");
    expect(entry).toContain("    pack: [\n      { target: '0.2.0', description: \"Describe what this migration changes\", up: __migration_pack_0_2_0 },\n      { target: '0.10.1', description: \"Describe what this migration changes\", up: __migration_pack_0_10_1 },\n      { target: '0.11.0', description: \"Describe what this migration changes\", up: __migration_pack_0_11_0 },\n    ],");
    const tsc = await typecheckPack(pack);
    expect(tsc.code, tsc.output).toBe(0);
  }, 6 * 60_000 + 20_000);

  it('refuses a version it already declares on that line, leaving the manifest as it was', async () => {
    const before = read('apack.json');
    await expect(add('migration', ['0.2.0'], pack)).rejects.toThrow('Migration "0.2.0" already exists in manifest under "pack"');
    expect(read('apack.json')).toBe(before);

    // The same version on the *other* line is a different migration, so it is not a collision — and it
    // lands on a file that is already there, which is the one thing the two lines share. So codegen
    // imports that module twice under two locals, which is the case the typecheck below is here for
    await add('migration', ['0.2.0', '--app'], pack);
    expect(readManifest().migrations?.app?.['0.2.0']).toEqual({ description: 'Describe what this migration changes', up: 'src/migrations/0.2.0.ts#up' });

    await generateEntries([], pack);
    const entry = read('src/__generated__/pack-entry.ts');
    expect(entry).toContain("import { up as __migration_app_0_2_0 } from '../migrations/0.2.0.ts';");
    expect(entry).toContain("import { up as __migration_pack_0_2_0 } from '../migrations/0.2.0.ts';");
    const tsc = await typecheckPack(pack);
    expect(tsc.code, tsc.output).toBe(0);
  }, 3 * 60_000 + 20_000);

  it('refuses a version that is not one a migration can target, before writing anything', async () => {
    const before = read('apack.json');
    await expect(add('migration', ['banana'], pack)).rejects.toThrow('"banana" is not a version a migration can target');
    expect(read('apack.json'), 'nothing was written').toBe(before);
    expect(fs.existsSync(path.join(pack, 'src/migrations/banana.ts'))).toBe(false);

    // The manifest's schema holds the same rule and is the backstop, but it only speaks on the next read —
    // by which time the entry and an empty module are on disk and the command has said it worked
    await expect(add('migration', ['1.0'], pack)).rejects.toThrow('is not a version a migration can target');
    expect(read('apack.json')).toBe(before);
  });

  it('takes the version from the first argument that is not a flag, so --app alone is not the version', async () => {
    // `--app` as args[0] was read as the version, and the prerelease normalisation strips from the first
    // `-`: the manifest gained a key of "" naming a file called `.ts`, and the command reported success
    await add('migration', ['--app'], pack);

    const version = readManifest().version;
    expect(readManifest().migrations?.app?.[version]).toEqual({ description: 'Describe what this migration changes', up: `src/migrations/${version}.ts#up` });
    expect(fs.existsSync(path.join(pack, 'src/migrations/.ts')), 'no file named for the empty version').toBe(false);
  });
});

/**
 * Everything `apack pack add` wrote, held to the rule `apack pack build` applies: a pack's specifier names the file
 * that is there. This is where the scaffold's own templates are checked against real files — the repo's
 * `check:specifiers` reads them as text, where a `'./${name}'` tells it nothing about the extension the
 * substitution carries.
 */
describe('what apack pack add scaffolds', () => {
  it('names its own modules by the file that is there', () => {
    expect([...packRuleProblems(pack, ['src', 'tests'])]).toEqual([]);
  });
});

/**
 * The apply scaffolds, which had no test reading their output before their templates became files
 * (`docs/goals/goal-one-rule-set.md`): `apack pack add action`, `add prompt` and `add flow` were covered only by
 * whether they exited 0.
 */
describe('apack pack add action, prompt and flow', () => {
  it('writes an action under its category, with the label and the typed services import', async () => {
    await add('action', ['analyze-text'], pack);
    const action = read('src/content/actions/demo-pack/analyze-text.ts');
    expect(action).toContain("import type { Services, Z } from '#generated/services.ts';");
    expect(action).toContain("label: 'Analyze Text'");
    expect(action).toContain("category: 'demo-pack'");
    expect(action).toContain('export async function action(\n  params: Record<string, any>,\n  services: Services,');
  });

  it('writes a prompt with its label and template function', async () => {
    await add('prompt', ['summarize-text'], pack);
    const prompt = read('src/content/prompts/summarize-text.ts');
    expect(prompt).toContain("import type { PromptMeta } from '@apackdev/sdk/build';");
    expect(prompt).toContain("label: 'Summarize Text'");
    expect(prompt).toContain('export function template(params: Record<string, any>)');
  });

  /**
   * `add flow` refuses a pack whose dependencies provide no steps, and it decides that by reading the pack's
   * generated flow helpers for `keepAlive` — so the fixture is that file, which is what a dependency's
   * generate-entries would have written.
   */
  it('writes a flow whose track uses the helpers the pack generates', async () => {
    write('src/__generated__/flow-helpers.ts', ['export const entry = 1;', 'export const keepAlive = 2;', ''].join('\n'));
    await add('flow', ['onboarding'], pack);
    expect(read('src/content/flows/onboarding.ts')).toBe([
      "import type { FlowDSL } from '@apackdev/sdk/build';",
      "import { entry, keepAlive } from '#generated/flow-helpers.ts';",
      '',
      'export default {',
      '  "Onboarding": [',
      '    entry([keepAlive()]),',
      '  ],',
      '} satisfies FlowDSL;',
      '',
    ].join('\n'));
  });
});

