import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it, vi } from 'vitest';
import { _nativePackDeclarationProblem } from '@apackdev/sdk/build';
import type { NativePackDeclaration } from '@apackdev/sdk/framework';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { importCompiledContent } from '@apackdev/sdk/utils';
import { createPackRegistry } from '../../src/packs/registry.ts';

const declaration: NativePackDeclaration = {
  id: 'native-content', data: { entities: { Memo: {} } },
  content: { writers: { Memo: 'absent/writers.ts#memoWriter' },
    sources: { memos: { applier: 'absent/memos.ts' } },
  },
};

function binding() {
  return { id: declaration.id, ears: { entities: { Memo: 'Memo' }, relKinds: {}, roles: {} },
    contentWriters: { Memo: { find: vi.fn(() => undefined) } },
    appliers: [{ key: 'memos', apply: vi.fn(() => ({ created: 1, updated: 0, skipped: 0 })) }],
  };
}

it('discovers native content without modules and preserves explicit application and unload behavior', () => {
  const registry = createPackRegistry({ nativeDeclarations: [declaration] });
  const metadata = registry.catalog.getSnapshot().native[0];
  expect(metadata.content).toEqual(declaration.content);
  const runtime = binding();
  registry.registerPack(runtime);
  startTestRuntime({ packs: registry });
  expect(registry.contentWriters('Memo')).toBe(runtime.contentWriters.Memo);
  expect(runtime.appliers[0].apply).not.toHaveBeenCalled();
  expect(runtime.contentWriters.Memo.find).not.toHaveBeenCalled();
  expect(registry.packContentTargets()).toEqual([]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-native-content-'));
  try {
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ version: 1, packId: declaration.id, entries: [] }));
    expect(importCompiledContent({ compiledDir: dir })).toEqual({ memos: { created: 1, updated: 0, skipped: 0 } });
    expect(runtime.appliers[0].apply).toHaveBeenCalledOnce();
    registry.unregisterPack(declaration.id);
    expect(registry.contentWriters('Memo')).toBeUndefined();
    expect(importCompiledContent({ compiledDir: dir })).toEqual({});
    expect(runtime.appliers[0].apply).toHaveBeenCalledOnce();
    expect(registry.catalog.getSnapshot().native[0]).toBe(metadata);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it.each([
  ['contentWriters', { contentWriters: {} }],
  ['contentWriters', { contentWriters: { Other: {} } }],
  ['appliers', { appliers: [] }],
  ['appliers', { appliers: [{ key: 'other', apply() {} }] }],
  ['appliers', { appliers: [{ key: 'memos' }, { key: 'memos' }] }],
] as const)('refuses mismatched %s before granting authority', (field, changes) => {
  const registry = createPackRegistry({ nativeDeclarations: [declaration] });
  const before = registry.catalog.getSnapshot();
  const bindServices = vi.fn();
  expect(() => registry.registerPack({ ...binding(), ...changes, bindServices } as never))
    .toThrow(`Native pack "${declaration.id}" runtime ${field} does not match its admitted declarations`);
  expect(bindServices).not.toHaveBeenCalled();
  expect(registry.getPackRegistration(declaration.id)).toBeNull();
  expect(registry.contentWriters('Memo')).toBeUndefined();
  expect(registry.appliers(declaration.id)).toEqual([]);
  expect(registry.catalog.getSnapshot()).toBe(before);
});

it('refuses a native writer for an entity it does not declare', () => {
  expect(_nativePackDeclarationProblem({ ...declaration, data: {} }))
    .toContain('A content writer for "Memo": only entity types this pack declares');
});

it.each([
  { sources: { memos: {} } },
  { sources: { memos: { path: 'source', format: 'memo' } } },
  { sources: { memos: { applier: 'memos.ts', path: 'source' } } },
  { datasets: { memos: { path: 'source', format: 'memo' } } },
])('refuses native build declarations without a native compiler: %j', content => {
  expect(_nativePackDeclarationProblem({ ...declaration, content })).toBeDefined();
});

it('accepts a native writer owned by a feature', () => {
  expect(_nativePackDeclarationProblem({ id: 'feature-content',
    features: { memos: { description: 'Manage memos.', entities: { Memo: {} } } },
    content: declaration.content,
  })).toBeUndefined();
});
