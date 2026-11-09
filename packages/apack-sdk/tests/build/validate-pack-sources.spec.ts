// `apack pack validate` checks each apack.json `features` entry against the pack on disk
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validatePackSources } from '../../src/build/validate.ts';
import type { PackManifest } from '../../src/build/manifest.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function pack(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-validate-features-'));
  dirs.push(root);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'export default {};\n');
  }
  return root;
}

const memos = {
  description: 'Manage memos.',
  settings: { schema: { type: 'object' }, defaults: {}, form: 'src/features/memos/fe/settings.vue' },
  system: { entry: 'src/features/memos/be/system.ts' },
  surface: { label: 'Fixture', state: 'src/features/memos/fe/surface.ts' },
};
const memosFiles = [memos.settings.form, memos.system.entry, memos.surface.state];

describe('validatePackSources', () => {
  it('refuses an export selector for a whole module even when its source file exists', () => {
    const root = pack(['src/system.ts']);
    const result = validatePackSources(root, { features: { memos: {
      description: 'Manage memos.', system: { entry: 'src/system#default' },
    } } });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics[0]).toMatchObject({ path: ['features', 'memos', 'system', 'entry'] });
    expect(result.diagnostics[0].message).toContain('without an export selector');
  });

  it('checks non-feature declarations without needing dependencies or executing sources', () => {
    const manifest: Partial<PackManifest> = {
      dependencies: { unavailable: 'file:./missing' },
      lifecycle: { onInit: 'src/hooks#onInit' },
      migrations: { app: { '1.0.0': { description: 'Initialize', up: 'src/hooks#up' } }, pack: { '1.0.0': { description: 'Initialize', up: 'src/hooks#up' } } },
      extensions: {
        services: { queries: 'src/hooks#queries' },
        steps: { test: { node: { label: 'Example' }, build: { compile: 'src/hooks#compile', validate: 'src/hooks#validate', getLabel: 'src/hooks#getLabel' }, fe: { nodeConfig: { icon: 'Box', category: 'logic', connectionRules: { inputs: 1, outputs: 1 } }, components: { form: 'src/view.vue' }, layout: { getHeight: 'src/hooks#getHeight' } }, runtime: { handler: 'src/hooks#handler' } },
          signal: { kind: 'trigger', node: { label: 'Example' }, trigger: { trackField: "event", compile: 'src/hooks#compile', decompile: 'src/hooks#decompile', register: 'src/hooks#register' } } },
        blocks: { text: { be: 'src/hooks#block', fe: 'src/view.vue' } },
        artifacts: { text: { icon: 'File', fe: 'src/view.vue' } },
        dsl: { test: { entry: 'src/types', targets: ['monaco'] } },
        textEditor: { editor: { extensions: { example: 'src/hooks#Example' },
          popups: { extra: 'src/view.vue' }, isSuggestionActive: 'src/hooks#isActive' } }, appExtensions: { extra: 'src/view.vue' },
      },
      content: { writers: { Test: 'src/hooks#writer' }, formats: { custom: { compiler: 'src/hooks' } }, sources: { custom: { applier: 'src/hooks' } } },
    };
    const root = pack(['src/hooks/index.ts', 'src/types.ts', 'src/view.vue']);
    fs.writeFileSync(path.join(root, 'src/hooks/index.ts'), 'throw new Error("Must not execute");');
    expect(validatePackSources(root, manifest).status).toBe('valid');
    fs.rmSync(path.join(root, 'src/hooks'), { recursive: true });
    fs.rmSync(path.join(root, 'src/types.ts'));
    fs.rmSync(path.join(root, 'src/view.vue'));
    const report = validatePackSources(root, manifest);
    expect(report.status).toBe('invalid');
    expect(report.diagnostics.map(issue => issue.path)).toEqual([
      ['extensions', 'services', 'queries'],
      ...['compile', 'validate', 'getLabel'].map(name => ['extensions', 'steps', 'test', 'build', name]),
      ['extensions', 'steps', 'test', 'runtime', 'handler'], ['extensions', 'steps', 'test', 'fe', 'components', 'form'], ['extensions', 'steps', 'test', 'fe', 'layout', 'getHeight'],
      ...['compile', 'decompile'].map(name => ['extensions', 'steps', 'signal', 'trigger', name]), ['extensions', 'steps', 'signal', 'trigger', 'register'],
      ['extensions', 'blocks', 'text', 'be'], ['extensions', 'blocks', 'text', 'fe'], ['extensions', 'artifacts', 'text', 'fe'],
      ['extensions', 'dsl', 'test', 'entry'], ['extensions', 'textEditor', 'editor', 'extensions', 'example'],
      ['extensions', 'textEditor', 'editor', 'popups', 'extra'], ['extensions', 'textEditor', 'editor', 'isSuggestionActive'],
      ['extensions', 'appExtensions', 'extra'],
      ['lifecycle', 'onInit'], ['migrations', 'app', '1.0.0', 'up'], ['migrations', 'pack', '1.0.0', 'up'],
      ['content', 'writers', 'Test'], ['content', 'formats', 'custom', 'compiler'], ['content', 'sources', 'custom', 'applier'],
    ]);
  });

  it('checks declared contracts, services, repositories and shapes through common module resolution', () => {
    const root = pack(['src/system.ts', 'src/views/index.ts', 'src/types.ts', 'src/queries.ts']);
    fs.writeFileSync(path.join(root, 'src/types.ts'), 'throw new Error("Do not execute"); export interface Contract {}');
    const manifest = { id: 'fixture', features: { memos: {
      description: 'Manage memos.', system: { entry: 'src/system', contract: 'src/types#Contract' },
      surface: { label: 'Memos', state: 'src/views' },
      services: { memos: 'src/queries#queries' }, repositories: { memoQueries: 'src/queries#queries' },
      entities: { Memo: { shape: 'src/types#Contract' } },
    } } };
    expect(validatePackSources(root, manifest).status).toBe('valid');
    fs.rmSync(path.join(root, 'src/types.ts'));
    expect(validatePackSources(root, manifest).diagnostics.map(issue => issue.path)).toEqual([
      ['features', 'memos', 'system', 'contract'], ['features', 'memos', 'entities', 'Memo'],
    ]);
  });

  it('refuses component targets that escape the pack through paths or symlinks', () => {
    const root = pack(['src/state.ts']);
    const outside = pack(['outside.vue']);
    fs.symlinkSync(path.join(outside, 'outside.vue'), path.join(root, 'linked.vue'));
    for (const canvas of ['../outside.vue', 'linked.vue']) {
      const result = validatePackSources(root, { features: { memos: {
        description: 'Manage memos.', surface: { label: 'Memos', state: 'src/state.ts', canvas },
      } } });
      expect(result.status).toBe('invalid');
      expect(result.diagnostics[0]).toMatchObject({ path: ['features', 'memos', 'surface', 'canvas'] });
      expect(result.diagnostics[0].message).toContain('stay within the pack');
    }
  });
  it('accepts features whose files exist and whose designation is the feature id', () => {
    const root = pack(memosFiles);
    expect(validatePackSources(root, { features: { memos: { ...memos, designation: 'memos' } } })).toEqual({ status: 'valid', diagnostics: [], skippedChecks: [] });
  });

  it.each([
    ['settings.form', memos.settings.form],
    ['system.entry', memos.system.entry],
    ['surface.state', memos.surface.state],
  ])('reports a missing %s file', (field, missing) => {
    const root = pack(memosFiles.filter(file => file !== missing));
    expect(messagesOf(validatePackSources(root, { features: { memos } }))).toEqual([`Feature "memos": ${field} file "${missing}" not found`]);
  });

  // `inbox`, not `memos`: a designation equal to the feature's id is what this case is *not* about, and a
  // rename made it exactly that for a while, leaving the name to claim what the fixture no longer showed
  it('accepts a designation that differs from the feature id: a designation is a role, not a name', () => {
    const root = pack(memosFiles);
    expect(messagesOf(validatePackSources(root, { features: { memos: { ...memos, designation: 'inbox' } } }))).toEqual([]);
  });

  it('reports one role claimed by two features of the same pack', () => {
    const root = pack(memosFiles);
    const errors = messagesOf(validatePackSources(root, {
      features: { memos: { ...memos, designation: 'inbox' }, scraps: { ...memos, designation: 'inbox' } },
    }));
    expect(errors).toEqual(['Feature "scraps": designation "inbox" is already claimed by feature "memos"']);
  });

  it('accepts two features with different designations', () => {
    const root = pack(memosFiles);
    expect(messagesOf(validatePackSources(root, {
      features: { memos: { ...memos, designation: 'memos' }, scraps: { ...memos, designation: 'scraps' } },
    }))).toEqual([]);
  });
});

// A feature's types module reaches the rest of the pack through `#generated/types`. A path that isn't there
// contributes nothing and says nothing, so validate is where a typo in it surfaces.
describe('types', () => {
  it('resolves a declared directory barrel and refuses an escaping module', () => {
    const root = pack(['src/public/index.ts']);
    expect(messagesOf(validatePackSources(root, { features: { memos: { description: 'Manage memos.', types: 'src/public' } } }))).toEqual([]);
    for (const types of ['../outside.ts', path.join(root, 'src/public/index.ts')]) {
      expect(messagesOf(validatePackSources(root, { features: { memos: { description: 'Manage memos.', types } } }))[0])
        .toContain('pack-root-relative and stay within the pack');
    }
    const outside = pack(['external.ts']);
    fs.symlinkSync(path.join(outside, 'external.ts'), path.join(root, 'linked.ts'));
    expect(messagesOf(validatePackSources(root, { features: { memos: { description: 'Manage memos.', types: 'linked.ts' } } }))[0])
      .toContain('module must stay within the pack');
  });
  it('accepts one whose module exists, written with or without its extension', () => {
    const root = pack([...memosFiles, 'src/features/memos/be/types.ts']);
    for (const types of ['src/features/memos/be/types', 'src/features/memos/be/types.ts']) {
      expect(validatePackSources(root, { features: { memos: { ...memos, types } } })).toEqual({ status: 'valid', diagnostics: [], skippedChecks: [] });
    }
  });

  it('reports one whose module is not there', () => {
    const root = pack(memosFiles);
    expect(messagesOf(validatePackSources(root, { features: { memos: { ...memos, types: 'src/features/memos/be/typos' } } })))
      .toEqual(['Feature "memos": types: no TypeScript module found at src/features/memos/be/typos (.ts or /index.ts)']);
  });

  it('says nothing about a feature that declares none', () => {
    const root = pack(memosFiles);
    expect(validatePackSources(root, { features: { memos } })).toEqual({ status: 'valid', diagnostics: [], skippedChecks: [] });
  });
});

describe('pack settings forms', () => {
  const form = 'src/extensions/settings/preferences.vue';
  const definition = { schema: { type: 'object' }, defaults: {}, form };

  it('validates a group form without a feature or surface', () => {
    expect(validatePackSources(pack([form]), {
      extensions: { settings: { preferences: definition } },
    })).toEqual({ status: 'valid', diagnostics: [], skippedChecks: [] });
  });

  it('reports the missing form at its manifest address', () => {
    const result = validatePackSources(pack([]), {
      id: 'example', extensions: { settings: { preferences: definition } },
    });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toEqual([{
      code: 'settings.missing-form', severity: 'error', packId: 'example',
      path: ['extensions', 'settings', 'preferences', 'form'], source: form,
      message: `Settings group "preferences": form file "${form}" not found`,
    }]);
  });

  it('accepts a declaration with no custom form', () => {
    expect(validatePackSources(pack([]), {
      extensions: { settings: { preferences: { schema: { type: 'object' }, defaults: {} } } },
    })).toEqual({ status: 'valid', diagnostics: [], skippedChecks: [] });
  });
  it('checks each build.workers entry exists and stays in the pack', () => {
    const root = pack(['src/worker.ts']);
    expect(validatePackSources(root, { build: { workers: { indexer: 'src/worker.ts' } } }).status).not.toBe('invalid');
    const missing = validatePackSources(root, { build: { workers: { indexer: 'src/nowhere.ts' } } });
    expect(missing.diagnostics).toMatchObject([{ code: 'module.missing-file', path: ['build', 'workers', 'indexer'] }]);
    const escaping = validatePackSources(root, { build: { workers: { indexer: '../outside.ts' } } });
    expect(escaping.diagnostics).toMatchObject([{ path: ['build', 'workers', 'indexer'] }]);
  });
});

function messagesOf(result: { diagnostics: { message: string }[] }): string[] {
  return result.diagnostics.map(issue => issue.message);
}
