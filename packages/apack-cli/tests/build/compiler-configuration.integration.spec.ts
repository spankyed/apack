import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { callCli, preparePack, packageJson, tsconfig } from '../_support/pack-builds.ts';
import { assertGeneratedCurrent } from '../../src/commands/generate-entries.ts';
import { dependencyTypes } from '../../src/commands/generate.ts';

let root: string | undefined;
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); root = undefined; });

it('invalidates generated metadata when external inherited path mappings change', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-inherited-config-'));
  const parent = path.join(root, 'base.json');
  const configure = (file: string) => fs.writeFileSync(parent, JSON.stringify({ compilerOptions: {
    baseUrl: '.', paths: { 'external-contract': [file] } } }));
  configure('before.d.ts');
  const contract = (event: string) => `export type Contract = { incoming: { type: 'FETCH' }; outgoing: { type: '${event}' } };`;
  fs.writeFileSync(path.join(root, 'before.d.ts'), contract('BEFORE'));
  fs.writeFileSync(path.join(root, 'after.d.ts'), contract('AFTERX'));
  const manifest = { id: 'config-consumer', name: 'Configuration Consumer', version: '1.0.0',
    features: { view: { description: 'Inherited event contract.',
      system: { entry: 'src/system.ts', contract: 'src/contract.ts#Contract' },
      surface: { label: 'View', state: 'src/surface.ts' } } } };
  const config = JSON.parse(tsconfig);
  // TypeScript replaces paths as a whole; let this fixture inherit its parent's map.
  delete config.compilerOptions.paths;
  const pack = preparePack(root, manifest.id, {
    'apack.json': JSON.stringify(manifest), 'package.json': packageJson(manifest.id),
    'tsconfig.json': JSON.stringify({ ...config, extends: '../base.json' }),
    'src/contract.ts': "export type { Contract } from 'external-contract';",
    'src/surface.ts': "import { state } from '@apackdev/state'; export default state()({});",
    'src/system.ts': `import { state } from '@apackdev/state'; import type { IncomingOnlyEventsOf } from '@apackdev/sdk/events';
import type { Contract } from './contract.ts';
export default state<{}, IncomingOnlyEventsOf<Contract>>()({});`,
  }, path.join(REPO_ROOT, 'node_modules'));
  const first = await callCli(pack, 'generate-entries');
  expect(first.code, first.output).toBe(0);
  const entry = path.join(pack, 'src/__generated__/pack-entry.ts');
  expect(fs.readFileSync(entry, 'utf8')).toContain('BEFORE');
  const authoredConfig = fs.readFileSync(path.join(pack, 'tsconfig.json'));
  configure('after.d.ts');
  expect(() => assertGeneratedCurrent(pack, manifest, dependencyTypes(new Map()))).toThrow('inputs changed');
  const second = await callCli(pack, 'generate-entries');
  expect(second.code, second.output).toBe(0);
  expect(fs.readFileSync(entry, 'utf8')).toContain('AFTERX');
  expect(fs.readFileSync(path.join(pack, 'tsconfig.json'))).toEqual(authoredConfig);
  // The alias/configuration stays fixed: imported bytes are an independent compiler input.
  fs.writeFileSync(path.join(root, 'after.d.ts'), contract('EDITED'));
  expect(() => assertGeneratedCurrent(pack, manifest, dependencyTypes(new Map()))).toThrow('inputs changed');
  const edited = await callCli(pack, 'generate-entries');
  expect(edited.code, edited.output).toBe(0);
  expect(fs.readFileSync(entry, 'utf8')).toContain('EDITED');
  const accepted = fs.readFileSync(entry);
  fs.writeFileSync(parent, '{malformed');
  const refused = await callCli(pack, 'generate-entries');
  expect(refused.code, refused.output).toBe(1);
  expect(refused.output).toContain('tsconfig.json could not be read');
  expect(fs.readFileSync(entry)).toEqual(accepted);
});
