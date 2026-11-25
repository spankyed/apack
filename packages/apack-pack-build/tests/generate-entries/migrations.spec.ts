import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { parseManifest } from '@apackdev/pack-format';
import { generate, root, setupPackFixture, write } from './_support/pack.ts';

setupPackFixture();

it('binds the declared target/description and the checked function without reading module metadata', async () => {
  write('migration.ts', `
class Migration {
  marker = 'source object';
  up() { if (this.marker !== 'source object') throw new Error('Lost migration receiver'); }
}
const migration = new Migration();
export const up = () => migration.up();
`);
  const files = await generate({ migrations: { app: { '1.0.0': { description: 'Instance migration', up: 'migration.ts#up' } } } });
  for (const [file, contents] of Object.entries(files)) write(file, contents);
  fs.symlinkSync(path.resolve(__dirname, '../../../../node_modules'), path.join(root, 'node_modules'), 'dir');
  const output = path.join(root, 'entry.cjs');
  await build({ entryPoints: [path.join(root, 'src/__generated__/pack-entry.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'cjs' });
  const { registration } = createRequire(import.meta.url)(output) as {
    registration: { migrations: { app: { target: string; description: string; up(): void }[] } };
  };
  const migration = registration.migrations.app[0]!;
  expect(migration.target).toBe('1.0.0');
  expect(migration.description).toBe('Instance migration');
  expect(() => migration.up()).not.toThrow();
});


it('discovers hook names and migration descriptions without executing their modules', async () => {
  write('hooks.ts', "throw new Error('must not activate hooks'); export const onInit = () => {}; export const extra = () => {};");
  write('up.ts', "throw new Error('must not activate migration'); export function up() {};");
  const files = await generate({ lifecycle: { onInit: 'hooks.ts#onInit' }, migrations: { pack: {
    '1.0.0': { description: 'Declared description', up: 'up.ts#up' },
  } } });
  const entry = files['src/__generated__/pack-entry.ts'];
  expect(entry).toContain('lifecycle: { onInit: __lifecycle_onInit }');
  expect(entry).not.toContain('..._hooks');
  expect(entry).not.toContain('extra:');
  expect(entry).toContain('description: "Declared description", up: __migration_pack_1_0_0');
});

it.each(['missing', 'noncallable'] as const)('refuses %s hook and migration exports before activation', async kind => {
  write('entry.ts', kind === 'missing' ? 'export const other = () => {};' : 'export const handler = {};');
  await expect(generate({ lifecycle: { onShutdown: 'entry.ts#handler' } })).rejects.toThrow(/export|function/);
  await expect(generate({ migrations: { app: { '1.0.0': { description: 'Change', up: 'entry.ts#handler' } } } })).rejects.toThrow(/export|function/);
});


it('refuses removed module hooks and migration objects missing declaration metadata', () => {
  const base = { id: 'declared', name: 'Declared', version: '1.0.0' };
  expect(parseManifest({ ...base, lifecycle: { hooks: 'hooks.ts' } }).status).toBe('invalid');
  expect(parseManifest({ ...base, migrations: { pack: { '1.0.0': 'up.ts#up' } } }).status).toBe('invalid');
  expect(parseManifest({ ...base, migrations: { pack: { '1.0.0': { up: 'up.ts#up' } } } }).status).toBe('invalid');
});
