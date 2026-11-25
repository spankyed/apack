import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generatePackFiles } from '@apackdev/pack-build';
import type { PackManifest } from '@apackdev/pack-format';
import { facadeProblems } from '../../src/build/facade-gate';
import { bundlePackTypes } from '../../src/build/types-bundler';

/**
 * A system's events reach its dependents' facade from the contract `apack.json` names — a declared type — and not
 * from the type inferred for its entry value. So how the entry is declared can't change what the facade publishes:
 * an annotation (`const entry: SystemEntry = …`), which erased the events back when codegen read that value's type,
 * publishes the same events as an entry with no annotation at all.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'facade-gate-system-contract-'));
afterAll(() => fs.rmSync(parent, { recursive: true, force: true }));

const MANIFEST: PackManifest = {
  id: 'entry-pack',
  name: 'Entry',
  version: '1.0.0',
  features: { tags: { description: 'Manage tags.', system: { entry: 'src/system.ts', contract: 'src/contract.ts#Contract' } } },
};

const CONTRACT = [
  "export type IncomingTagsEvents = { type: 'ADD_TAG'; name: string };",
  "export type OutgoingTagsEvents = { type: 'TAG_ADDED'; name: string };",
  'export type Contract = { incoming: IncomingTagsEvents; outgoing: OutgoingTagsEvents };',
].join('\n');

function systemSource(declaration: 'bare' | 'annotation'): string {
  const machine = "{ spec: tagsSpec, machine: setup({ types: tagsSpec.types }).createMachine({ id: 'tags' }) }";
  return [
    "import { setup } from 'xstate';",
    "import { defineSystem, type SystemEntry } from '@apackdev/sdk/framework';",
    "import type { Contract } from './contract';",
    'export const tagsSpec = defineSystem<Contract>();',
    declaration === 'bare' ? `const entry = ${machine};` : `const entry: SystemEntry = ${machine};`,
    'export default entry;',
  ].join('\n');
}

/** The pack with its system entry declared one way, built into a facade bundle: the gate's problems and the bundle */
async function gate(declaration: 'bare' | 'annotation'): Promise<{ problems: string[]; facade: string }> {
  const dir = path.join(parent, declaration);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: MANIFEST.id, type: 'module' }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true, skipLibCheck: true, noEmit: true, types: ['node'] },
      include: ['src/**/*.ts'],
    }),
    'apack.json': JSON.stringify(MANIFEST),
    'src/contract.ts': CONTRACT,
    'src/system.ts': systemSource(declaration),
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  if (!fs.existsSync(path.join(dir, 'node_modules'))) fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  for (const [rel, content] of Object.entries(await generatePackFiles(MANIFEST, { packRoot: dir }))) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  const outFile = path.join(dir, 'dist', 'types', 'pack-types.d.ts');
  const bundled = await bundlePackTypes(dir, outFile);
  if (!bundled.success) throw new Error(bundled.error);
  return { problems: facadeProblems(dir, outFile), facade: fs.readFileSync(outFile, 'utf-8') };
}

describe('facade gate: a system contract', () => {
  it('publishes the contract’s events through the gate', async () => {
    const { problems, facade } = await gate('bare');
    expect(problems).toEqual([]);
    expect(facade).toContain('TAG_ADDED');
    expect(facade).toContain('ADD_TAG');
  });

  it('publishes the same events when the entry is annotated, which used to erase them', async () => {
    const bare = await gate('bare');
    const annotated = await gate('annotation');
    expect(annotated.problems).toEqual([]);
    expect(annotated.facade).toBe(bare.facade);
  });
});
