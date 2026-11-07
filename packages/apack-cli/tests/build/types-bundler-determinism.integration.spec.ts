import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGES_BUILT, REPO_ROOT, installPublishedPackages } from '@app/publish-checks';
import { cpuBudget } from '@apackdev/testing/vitest';

/**
 * A pack's facade bundle (dist/types/pack-types.d.ts) is the same whether its @apackdev/* packages come
 * from this checkout's workspace links or from the tarballs npm would publish: what the repo builds
 * against is what a pack author installs. A package whose `files` or `exports` ship something other
 * than the workspace has, as a private package with no `files` field does, shows up here as a
 * different facade — or as a build that cannot resolve the packages at all.
 */
const CLI = path.join(REPO_ROOT, 'packages', 'apack-cli', 'bin', 'apack.mjs');

const PACK: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'facade-pack', type: 'module', imports: { '#generated/*': './src/__generated__/*' } }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true, skipLibCheck: true, noEmit: true, types: ['node'],
      allowImportingTsExtensions: true, paths: { '#generated/*': ['./src/__generated__/*'] },
    },
    include: ['src/**/*.ts'],
  }),
  'apack.json': JSON.stringify({
    id: 'facade-pack', name: 'Facade', version: '1.0.0',
    data: { entities: { Tag: { shape: "src/types.ts#TagEntity" } } },

    features: {
      tags: { description: 'Feature declaration fixture.',
        system: { entry: 'src/system.ts', contract: 'src/system.contract.ts#Contract' },
        services: { tags: 'src/tags.ts#tagsService' },
        repositories: { tagQueries: 'src/repository.ts#tagQueries' },
      },
    },
  }),
  'src/types.ts': "import type { EARS } from '@apackdev/sdk';\nexport interface TagEntity { name: string; parent?: EARS.EntityId<'Tag'> }\n",
  'src/system.contract.ts': [
    "export type OutgoingTagsEvents = { type: 'TAG_ADDED'; name: string };",
    "export type Contract = { incoming: { type: 'ADD_TAG' }; outgoing: OutgoingTagsEvents };",
  ].join('\n') + '\n',
  'src/system.ts': [
    "import { setup } from 'xstate';",
    "import { defineSystem } from '@apackdev/sdk/framework';",
    "import type { Contract } from './system.contract.ts';",
    'export const tagsSpec = defineSystem<Contract>();',
    'const entry = { spec: tagsSpec, machine: setup({ types: tagsSpec.types }).createMachine({ id: "tags" }) };',
    'export default entry;',
  ].join('\n'),
  // Inferred types that name SDK declarations: the declaration emit prints them from whichever copy resolved
  'src/tags.ts': [
    "import { z } from 'zod';",
    "import { query } from '#generated/ears.ts';",
    "export const TagInput = z.object({ name: z.string(), color: z.enum(['red', 'blue']).optional() });",
    'export const tagsService = {',
    "  query: () => query('Tag'),",
    "  all: () => query('Tag').pickAll(),",
    '  parse: (input: unknown) => TagInput.parse(input),',
    '};',
  ].join('\n'),
  'src/repository.ts': [
    "import { query, EARS } from '#generated/ears.ts';",
    'export const tagQueries = { names: () => query(EARS.Entity.Tag).pickAll().map((tag) => tag.name), ids: () => query(EARS.Entity.Tag).ids() };',
  ].join('\n'),
};

/** The pack built with node_modules linked to `modules`; its facade bundle */
async function buildFacade(parent: string, name: string, modules: string, signal: AbortSignal): Promise<string> {
  const dir = path.join(parent, name);
  for (const [rel, content] of Object.entries(PACK)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  fs.symlinkSync(modules, path.join(dir, 'node_modules'), 'dir');
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [CLI, 'pack', 'build'], {
        cwd: dir, env: { ...process.env, FORCE_COLOR: '0' }, signal, timeout: 180_000, killSignal: 'SIGKILL',
      }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve());
    });
  } catch (err: any) {
    throw new Error(`apack pack build failed (${name}):\n${err.stdout ?? ''}${err.stderr ?? ''}`);
  }
  return fs.readFileSync(path.join(dir, 'dist', 'types', 'pack-types.d.ts'), 'utf-8');
}

describe.skipIf(!PACKAGES_BUILT)('facade bundle determinism (needs dist: npm run packages:build)', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'facade-determinism-'));
  let active: Promise<string> | undefined;
  afterAll(async () => {
    await active?.catch(() => {});
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('is identical from the workspace and from the packed tarballs a consumer installs', { meta: cpuBudget(60_000 + 2 * 180_000 + 20_000) }, async ({ signal }) => {
    active = buildFacade(parent, 'workspace', path.join(REPO_ROOT, 'node_modules'), signal);
    const fromWorkspace = await active;
    active = buildFacade(parent, 'packed', path.join(installPublishedPackages(), 'node_modules'), signal);
    const fromPacked = await active;
    expect(fromWorkspace).toContain('QueryBuilder');
    expect(fromPacked).toBe(fromWorkspace);
  });
});
