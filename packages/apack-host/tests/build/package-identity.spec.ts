// What a package brings (`dependencyClosure`) and what it is (`packageIdentity`), each read the way Node and npm read them
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { dependencyClosure, packageIdentity, packedFiles, UnresolvedDependencyError } from '../../src/build/package-identity.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function tmp(files: Record<string, string | object>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-package-identity-')));
  dirs.push(dir);
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

const pkg = (name: string, extra: object = {}) => ({ name, version: '1.0.0', ...extra });

describe('dependencyClosure', () => {
  it('resolves each declaration from the package that declares it, as Node does, and takes each package once', () => {
    const root = tmp({
      'node_modules/a/package.json': pkg('a', { dependencies: { b: '*', c: '*' } }),
      // a's own b, nested under it, is the one a gets; the hoisted b is another package
      'node_modules/a/node_modules/b/package.json': pkg('b', { version: '2.0.0', dependencies: { c: '*' } }),
      'node_modules/b/package.json': pkg('b'),
      'node_modules/c/package.json': pkg('c'),
    });
    const closure = dependencyClosure('a', root);
    expect(closure.map((p) => [p.name, path.relative(root, p.directory)])).toEqual([
      ['a', 'node_modules/a'], ['b', 'node_modules/a/node_modules/b'], ['c', 'node_modules/c'],
    ]);
    expect(closure[1]!.manifest.version).toBe('2.0.0');
  });

  it('finds a package named like a built-in module, which a lookup for the bare name would take for the built-in', () => {
    const root = tmp({ 'node_modules/a/package.json': pkg('a', { dependencies: { punycode: '*' } }), 'node_modules/punycode/package.json': pkg('punycode') });
    expect(dependencyClosure('a', root).map((p) => p.name)).toEqual(['a', 'punycode']);
  });

  it('takes two links to one directory as one package', () => {
    const root = tmp({ 'store/c/package.json': pkg('c'), 'node_modules/a/package.json': pkg('a', { dependencies: { c: '*' } }) });
    fs.mkdirSync(path.join(root, 'node_modules/a/node_modules'), { recursive: true });
    fs.symlinkSync(path.join(root, 'store/c'), path.join(root, 'node_modules/c'));
    fs.symlinkSync(path.join(root, 'store/c'), path.join(root, 'node_modules/a/node_modules/c'));
    expect(dependencyClosure('a', root).map((p) => p.directory)).toEqual([path.join(root, 'node_modules/a'), path.join(root, 'store/c')]);
  });

  it('includes peers and optional packages that resolve, and leaves out the optional ones that are absent', () => {
    const root = tmp({
      'node_modules/a/package.json': pkg('a', {
        optionalDependencies: { 'native-absent': '*', 'native-present': '*' },
        peerDependencies: { peer: '*', 'optional-peer-absent': '*', 'optional-peer-present': '*' },
        peerDependenciesMeta: { 'optional-peer-absent': { optional: true }, 'optional-peer-present': { optional: true } },
      }),
      'node_modules/native-present/package.json': pkg('native-present'),
      'node_modules/peer/package.json': pkg('peer'),
      'node_modules/optional-peer-present/package.json': pkg('optional-peer-present'),
    });
    expect(dependencyClosure('a', root).map((p) => p.name).sort()).toEqual(['a', 'native-present', 'optional-peer-present', 'peer']);
  });

  it('refuses a dependency that does not resolve, naming who declared it', () => {
    const root = tmp({
      'node_modules/a/package.json': pkg('a', { dependencies: { b: '*' } }),
      'node_modules/b/package.json': pkg('b', { dependencies: { missing: '*' } }),
    });
    expect(() => dependencyClosure('a', root)).toThrow(UnresolvedDependencyError);
    expect(() => dependencyClosure('a', root)).toThrow(`missing, declared by b, doesn't resolve from ${path.join(root, 'node_modules/b')}`);
  });

  it('refuses a peer not marked optional that does not resolve: npm installs those, so the install is incomplete', () => {
    const root = tmp({ 'node_modules/a/package.json': pkg('a', { peerDependencies: { peer: '*' } }) });
    expect(() => dependencyClosure('a', root)).toThrow('peer, declared by a');
  });

  it('lists every declaration that does not resolve, the root included', () => {
    const root = tmp({ 'node_modules/a/package.json': pkg('a', { dependencies: { b: '*', c: '*' } }) });
    try {
      dependencyClosure('a', root);
      expect.unreachable();
    } catch (err) {
      expect((err as UnresolvedDependencyError).unresolved).toEqual([expect.stringMatching(/^b, declared by a/), expect.stringMatching(/^c, declared by a/)]);
    }
    expect(() => dependencyClosure('nothing', root)).toThrow(`nothing, declared by ${root}`);
  });
});

describe('packageIdentity', () => {
  const shipped = {
    'package.json': pkg('lib', { files: ['dist', 'types/*.d.ts', '!dist/**/*.test.js'], main: 'main.js', bin: { lib: './bin/cli.js' } }),
    'README.md': 'readme',
    'LICENSE': 'license',
    'main.js': 'main',
    'bin/cli.js': 'cli',
    'dist/index.js': 'index',
    'dist/nested/deep.js': 'deep',
    'types/index.d.ts': 'types',
  };
  // A linked checkout of the same package: everything npm leaves out of what it packs, beside what it ships
  const checkout = {
    ...shipped,
    '.gitignore': 'dist\n',
    'src/index.ts': 'source',
    'dist/index.test.js': 'a test',
    'dist/.DS_Store': 'finder',
    'types/notes.md': 'not a declaration',
    'node_modules/dep/package.json': pkg('dep'),
    'package-lock.json': '{}',
  };

  it('is the same for a registry install and a linked checkout of the same package', () => {
    expect(packageIdentity(tmp(checkout))).toEqual(packageIdentity(tmp(shipped)));
    expect(packageIdentity(tmp(shipped))).toMatchObject({ name: 'lib', version: '1.0.0', hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it.each(Object.keys(shipped))('moves when shipped file %s changes', (file) => {
    const dir = tmp(shipped);
    const before = packageIdentity(dir);
    fs.appendFileSync(path.join(dir, file), file === 'package.json' ? ' ' : 'changed');
    expect(packageIdentity(dir)).not.toEqual(before);
  });

  it('moves when a shipped file is added or removed', () => {
    const dir = tmp(shipped);
    const before = packageIdentity(dir);
    fs.writeFileSync(path.join(dir, 'dist/added.js'), '');
    expect(packageIdentity(dir)).not.toEqual(before);
    fs.rmSync(path.join(dir, 'dist/added.js'));
    expect(packageIdentity(dir)).toEqual(before);
    fs.rmSync(path.join(dir, 'dist/nested/deep.js'));
    expect(packageIdentity(dir)).not.toEqual(before);
  });

  it('ships everything npm does not ignore when there is no `files`, reading .npmignore over .gitignore', () => {
    const dir = tmp({ 'package.json': pkg('plain'), 'index.js': '', 'lib/a.js': '', 'test/a.js': '', '.npmignore': 'test\n', '.gitignore': 'lib\n', 'x.orig': '' });
    expect(packedFiles(dir)).toEqual(['index.js', 'lib/a.js', 'package.json']);
  });

  it('lists what `npm pack` lists', async () => {
    const dir = tmp({
      ...checkout,
      'package.json': pkg('lib', { files: ['dist', 'types/*.d.ts', '!dist/**/*.test.js', 'docs/'], main: './main.js', bin: './bin/cli.js' }),
      'docs/guide.md': 'guide', 'docs/.npmignore': 'draft.md\n', 'docs/draft.md': 'draft', 'CHANGELOG.md': 'changes', 'licence.txt': 'licence',
    });
    // npm is a `.cmd` on Windows, which only a shell runs
    const windows = process.platform === 'win32';
    const npm = JSON.parse((await execFileWhileWorking(windows ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, shell: windows })).stdout);
    expect(packedFiles(dir)).toEqual(npm[0].files.map((file: { path: string }) => file.path).sort());
  });
});
