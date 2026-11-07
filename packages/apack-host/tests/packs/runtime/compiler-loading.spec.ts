import { expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withoutSourceCondition } from '../../../src/build/source-resolution.ts';

vi.mock('typescript', () => { throw new Error('TypeScript loaded before compilation'); });
vi.mock('esbuild', () => { throw new Error('esbuild loaded before compilation'); });
vi.mock('json-schema-to-typescript', () => { throw new Error('Settings type generator loaded before compilation'); });
vi.mock('prettier', () => { throw new Error('Prettier loaded before compilation'); });

it('loads the SDK build entry and complete host bridge without compiler tooling', async ({ signal }) => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    const loaded = [];
    registerHooks({ load(url, context, next) { loaded.push(url); return next(url, context); } });
    await import('@apackdev/sdk/build');
    console.log(JSON.stringify(loaded.filter(url => /node_modules\\/(typescript|esbuild|prettier|json-schema-to-typescript)\\//.test(url))));
  `], { signal, env: { ...process.env, NODE_OPTIONS: withoutSourceCondition(process.env.NODE_OPTIONS) } });
  expect(JSON.parse(stdout)).toEqual([]);
  const sdk = await import('@apackdev/sdk/build');
  const { SHARED_INSTANCE_MODULES } = await import('../../../src/packs/runtime/sdk-modules.ts');
  expect(sdk.contentHash({ value: 1 })).toMatch(/^[a-f0-9]{16}$/);
  expect(sdk.compileSourceDir).toBeTypeOf('function');
  expect(SHARED_INSTANCE_MODULES['@apackdev/sdk/build']).toHaveProperty('generateSettingsTypes', expect.any(Function));
});
