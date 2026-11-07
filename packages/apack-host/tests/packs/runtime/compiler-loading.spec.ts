import { expect, it, vi } from 'vitest';

vi.mock('typescript', () => { throw new Error('TypeScript loaded before compilation'); });
vi.mock('esbuild', () => { throw new Error('esbuild loaded before compilation'); });
vi.mock('json-schema-to-typescript', () => { throw new Error('Settings type generator loaded before compilation'); });
vi.mock('prettier', () => { throw new Error('Prettier loaded before compilation'); });

it('loads the published SDK build entry and complete host bridge without compiler tooling', async () => {
  const published = await import('../../../../apack-sdk/dist/build/index.js');
  const { SHARED_INSTANCE_MODULES } = await import('../../../src/packs/runtime/sdk-modules.ts');
  expect(published.contentHash({ value: 1 })).toMatch(/^[a-f0-9]{16}$/);
  expect(published.compileSourceDir).toBeTypeOf('function');
  expect(SHARED_INSTANCE_MODULES['@apackdev/sdk/build']).toHaveProperty('generateSettingsTypes', expect.any(Function));
});
