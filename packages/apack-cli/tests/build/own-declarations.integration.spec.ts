import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { createPackRegistry, readPackBuild, stagePack } from '@apackdev/host/packs';
import { loadSingleExternalPack } from '@apackdev/host/packs/runtime';
import { createPackBuilder, type PackBuilder } from '../../src/build/build-process.ts';
import { inspectPack } from '../../src/commands/info.ts';

startTestRuntime({ appVersion: '1.0.0' });
const roots: string[] = [];
let builder: PackBuilder | undefined;
afterEach(async () => {
  await builder?.close();
  builder = undefined;
  vi.restoreAllMocks();
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
  delete (globalThis as Record<string, unknown>).__ownDeclarationsLoaded;
});

it('preserves owned names through authoring, compiled snapshots, source-free discovery and runtime loading', async ({ signal }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-own-declarations-')); roots.push(root);
  const own = <T>(value: T) => Object.fromEntries([['__proto__', value]]);
  packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'),
    manifest: { id: 'own-declarations', name: 'Own declarations', data: { entities: { Untyped: {} } },
      features: { notes: { description: 'Store notes.', entities: { Note: { shape: 'src/shape.ts#NoteShape' } }, services: own('src/service.ts#service') } },
      lifecycle: { onInit: 'src/lifecycle.ts#onInit' },
      extensions: { appExtensions: own('src/View.vue') },
    }, files: {
      'src/shape.ts': 'throw new Error("Shape module executed"); export interface NoteShape { title: string }',
      'src/service.ts': 'export const service = { marker: "owned service" };',
      'src/lifecycle.ts': '(globalThis as Record<string, unknown>).__ownDeclarationsLoaded = true; export const onInit = () => {};',
      'src/View.vue': '<template><div>Owned view</div></template>',
    } });
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  builder = createPackBuilder(root);
  await builder.build({ signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
  await builder.close();
  const built = readPackBuild(path.join(root, 'dist'));
  expect(built.snapshot.provenance?.entities?.Note).toBe('own-declarations');
  const packs = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-own-installed-')); roots.push(packs);
  const installed = path.join(packs, 'own-declarations');
  stagePack(root, installed);
  fs.rmSync(path.join(root, 'src'), { recursive: true });
  const report = await inspectPack(installed);
  expect(report.build.status).toBe('verified');
  expect(report.declared.features?.notes.services).toEqual(own('src/service.ts#service'));
  expect(report.declared.extensions?.appExtensions).toEqual(own('src/View.vue'));
  expect((globalThis as Record<string, unknown>).__ownDeclarationsLoaded).toBeUndefined();
  const loaded = loadSingleExternalPack(createPackRegistry(), installed);
  if ('problem' in loaded) throw new Error(loaded.problem);
  expect((globalThis as Record<string, unknown>).__ownDeclarationsLoaded).toBe(true);
  expect(Object.hasOwn(loaded.registration.services!, '__proto__')).toBe(true);
  expect(loaded.registration.services!['__proto__']).toMatchObject({ marker: 'owned service' });
  expect(fs.existsSync(path.join(installed, 'src'))).toBe(false);
}, 120_000 + 20_000);
