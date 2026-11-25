import { expect, it } from 'vitest';
import { resolveContentSources, type ContentDependency } from '../../src/content/resolve.ts';
import type { ContentFormatConfig, PackManifest } from '@apackdev/pack-format';

it.each(['sources', 'datasets'] as const)('resolves only declared local and dependency formats for content.%s', section => {
  const format: ContentFormatConfig = { compiler: 'src/compiler.ts', ...(section === 'sources' && { entity: 'Row' }) };
  const manifest = (ref: string, formats: Record<string, ContentFormatConfig> = { known: format }): PackManifest => ({
    id: 'consumer', name: 'Consumer', version: '1.0.0', dependencies: { base: '*' },
    content: { formats, [section]: { rows: { path: 'data', format: ref } } },
  });
  const dependency: ContentDependency = { manifest: { id: 'base', name: 'Base', version: '1.0.0', content: { formats: { known: format } } } };
  const dependencies = new Map([['base', dependency]]);
  const resolve = (manifest: PackManifest) => resolveContentSources(manifest, '/pack', dependencies, section);

  expect(() => resolve(manifest('constructor')))
    .toThrow('no format "constructor" in content.formats');
  expect(() => resolve(manifest('base:constructor')))
    .toThrow('dependency "base" has no format "constructor"');

  expect(resolve(manifest('constructor', { constructor: format })).rows)
    .toMatchObject({ kind: 'format', format });
  dependency.manifest.content = { formats: { constructor: format } };
  expect(resolve(manifest('base:constructor')).rows)
    .toMatchObject({ kind: 'format', format });
});

/**
 * `extensions.commands` is a shorthand, desugared here into an ordinary content source so that everything
 * downstream — the compiler, the applier, removal, offers — is the machinery every other entry uses.
 */
it('desugars the commands a manifest declares into a source of their own', () => {
  const manifest: PackManifest = {
    id: 'memo-pack', name: 'Memos', version: '1.0.0',
    extensions: { commands: { list: { 'memo-quick': { placeholder: 'What to note' } } } },
  };

  const resolved = resolveContentSources(manifest, '/pack');

  expect(resolved['declared-commands']).toEqual({
    kind: 'declared',
    documentName: 'memo-pack commands',
    commands: [{ name: 'memo-quick', placeholder: 'What to note' }],
  });
  // Nothing is synthesized for a pack that declares none, so no empty entry reaches the compiled output
  expect(resolveContentSources({ id: 'bare', name: 'Bare', version: '1.0.0' }, '/pack')).toEqual({});
});

it("carries the declaration's edit policy onto the source, since that is where appliers read it", () => {
  const manifest: PackManifest = {
    id: 'memo-pack', name: 'Memos', version: '1.0.0',
    extensions: { commands: { onUserEdit: 'theirs', list: { 'memo-quick': { placeholder: 'What to note' } } } },
  };

  expect(resolveContentSources(manifest, '/pack')['declared-commands'])
    .toMatchObject({ kind: 'declared', onUserEdit: 'theirs', commands: [{ name: 'memo-quick' }] });
});

/**
 * The loud half of the old key's collision check, kept where it can still be made: a dependency's
 * commands are already in the app, so a name it declares is a conflict the author can be told about at
 * build time. Across packs that know nothing of each other the documents' first-wins rule stands, because
 * nothing here can see them both.
 */
it("refuses a command name a dependency already declares", () => {
  const manifest: PackManifest = {
    id: 'memo-pack', name: 'Memos', version: '1.0.0', dependencies: { base: '*' },
    extensions: { commands: { list: { 'shared': { placeholder: 'Mine' } } } },
  };
  const dependencies = new Map<string, ContentDependency>([['base', {
    manifest: { id: 'base', name: 'Base', version: '1.0.0', extensions: { commands: { list: { shared: { placeholder: 'Theirs' } } } } },
  }]]);

  expect(() => resolveContentSources(manifest, '/pack', dependencies))
    .toThrow('Command "shared": dependency "base" already declares it');
});

it('refuses a pack naming a source the declared commands compile under', () => {
  const manifest: PackManifest = {
    id: 'memo-pack', name: 'Memos', version: '1.0.0',
    content: { sources: { 'declared-commands': { applier: 'src/apply.ts' } } },
  };

  expect(() => resolveContentSources(manifest, '/pack'))
    .toThrow('is the key the commands in extensions.commands compile under');
});
