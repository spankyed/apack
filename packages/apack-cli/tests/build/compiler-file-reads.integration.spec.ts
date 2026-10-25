// @slow: each case captures a compiler input view over a real pack and compiles through it
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { compilePack, buildPackConfigFromManifest, ManifestSchema } from '@apackdev/sdk/build';
import { captureCompilationInputs } from '../../src/build/compilation-inputs.ts';
import { withCompilerFileReads } from '@apackdev/host/build/compiler-inputs';
import { createCompilerModuleLoader } from '../../src/build/compiler-modules.ts';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it('loads an explicitly imported outside native addon from owned bytes', async () => {
  const require = createRequire(import.meta.url);
  require('rollup/parseAst');
  const addon = Object.keys(require.cache).find(file => file.endsWith('.node') && path.basename(file).startsWith('rollup.'));
  if (!addon) throw new Error('Rollup did not load its platform addon');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-native-module-')));
  roots.push(root);
  const pack = path.join(root, 'pack');
  fs.mkdirSync(pack);
  fs.writeFileSync(path.join(pack, 'package.json'), '{"type":"commonjs"}');
  fs.writeFileSync(path.join(pack, 'tsconfig.json'), '{"compilerOptions":{"noLib":true,"types":[]}}');
  const entry = path.join(pack, 'compiler.cjs');
  const native = path.join(root, 'native.node');
  fs.copyFileSync(addon, native);
  fs.writeFileSync(entry, `module.exports = typeof require('../native.node').parse;`);
  const compilation = captureCompilationInputs(pack);
  const modules = createCompilerModuleLoader(compilation);
  try {
    const loaded = await withCompilerFileReads({ compilation, outputDirectory: path.join(pack, 'dist') }, () => modules.importModule(entry));
    expect(loaded.default).toBe('function');
    const owned = compilation.readTree().path(native);
    expect(fs.readFileSync(owned)).toEqual(fs.readFileSync(native));
    const report = process.report.getReport() as { sharedObjects: string[] };
    expect(report.sharedObjects).toContain(owned);
    expect(report.sharedObjects).not.toContain(native);
    fs.writeFileSync(native, 'changed native input');
    expect(() => compilation.assertCurrent()).toThrow(/changed/);
  } finally { try { await modules.dispose(); } finally { compilation.dispose(); } }
});

it('compiles content records and copied media from the same captured input view', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-media-reads-')));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const media = path.join(root, 'content/media/pic.png');
  fs.mkdirSync(path.dirname(media), { recursive: true });
  fs.writeFileSync(media, 'CAPTURED');
  fs.chmodSync(media, 0o666);
  fs.writeFileSync(path.join(root, 'content/first.md'), 'CAPTURED body ![pic](media/pic.png)');
  const compilation = captureCompilationInputs(root);
  const outputDirectory = path.join(root, 'dist');
  try {
    fs.writeFileSync(media, 'LIVE');
    await withCompilerFileReads({ compilation, outputDirectory }, () => compilePack({
      packDir: root, outputDir: outputDirectory,
      packConfig: { name: 'media-proof', sources: { memos: { kind: 'format', path: 'content', formatRef: 'memos',
        format: { format: 'markdown-tree', entity: 'Memo', identity: ['title'], media: 'media',
          fields: { title: { from: 'frontmatter.title', default: 'filename' }, body: { from: 'body' } } },
      } } },
    }));
    const records = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'memos.content.json'), 'utf8')).records;
    expect(records[0].body).toContain('CAPTURED body');
    const copied = path.join(outputDirectory, 'media/memos/pic.png');
    expect(fs.readFileSync(copied, 'utf8')).toBe('CAPTURED');
    if (process.platform !== 'win32') expect(fs.statSync(copied).mode & 0o777).toBe(0o666);
    expect(() => compilation.assertCurrent()).toThrow('Compiler or installed package inputs changed');
  } finally { compilation.dispose(); }
});

it('captures explicitly imported dependency code and relative modules outside authored discovery', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dependency-modules-')));
  roots.push(root);
  const directory = path.join(root, '.apack/deps/dependency/build');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dependency-consumer', type: 'module' }));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, types: [] } }));
  const entry = path.join(directory, 'steps.build.mjs');
  fs.writeFileSync(entry, `export {default} from './child.mjs';`);
  fs.writeFileSync(path.join(directory, 'child.mjs'), `export default { value: 'DEPENDENCY', origin: import.meta.url };`);
  const compilation = captureCompilationInputs(root);
  const modules = createCompilerModuleLoader(compilation);
  try {
    const loaded = await withCompilerFileReads({ compilation, outputDirectory: path.join(root, '.apack/build') }, () => modules.importModule(entry));
    expect(loaded.default).toEqual({ value: 'DEPENDENCY', origin: expect.stringContaining(pathToFileURL(path.join(directory, 'child.mjs')).href) });
    await modules.dispose();
    expect(() => compilation.assertCurrent()).not.toThrow();
  } finally { try { await modules.dispose(); } finally { compilation.dispose(); } }
});

it('executes content reads through files, streams and descriptors while writable handles stay native', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-content-reads-')));
  roots.push(root);
  const source = path.join(root, 'src/payload.txt');
  fs.mkdirSync(path.dirname(source));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', main: source }));
  fs.writeFileSync(source, 'CAPTURED');
  fs.writeFileSync(path.join(root, 'src/compiler.mjs'), `import fs from 'node:fs';
    import {readFile, open} from 'node:fs/promises';
    export default async ({path}) => {
      const sync = fs.readFileSync(new URL('file://' + path), 'utf8');
      const callback = await new Promise((resolve, reject) => fs.readFile(Buffer.from(path), 'utf8', (err, value) => err ? reject(err) : resolve(value)));
      const promise = await readFile(path, 'utf8');
      const chunks = [];
      const stream = fs.createReadStream(path, {encoding: 'utf8'});
      for await (const chunk of stream) chunks.push(chunk);
      if (stream.path !== path) throw new Error('Stream exposed a private path');
      const fd = fs.openSync(path, fs.constants.O_RDONLY);
      let descriptor;
      try { descriptor = fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
      const callbackDescriptor = await new Promise((resolve, reject) => fs.open(path, 'r', (err, fd) => {
        if (err) { reject(err); return; }
        try { resolve(fs.readFileSync(fd, 'utf8')); } catch (err) { reject(err); } finally { fs.closeSync(fd); }
      }));
      const handle = await open(path, 'r');
      let handled;
      try { handled = await handle.readFile('utf8'); } finally { await handle.close(); }
      return [{entity: 'Row', name: [sync, callback, promise, chunks.join(''), descriptor, callbackDescriptor, handled].join(':')}];
    };`);
  const manifest = ManifestSchema.parse({ id: 'content-reads', name: 'Content reads', version: '1.0.0',
    content: { formats: { rows: { compiler: 'src/compiler.mjs', entity: 'Row', identity: ['name'] } },
      sources: { rows: { path: 'src/payload.txt', format: 'rows' } } } });
  const compilation = captureCompilationInputs(root);
  const outputDirectory = path.join(root, 'dist');
  try {
    fs.writeFileSync(source, 'LIVE');
    await withCompilerFileReads({ compilation, outputDirectory }, async () => {
      await compilePack({ packDir: root, outputDir: outputDirectory,
        packConfig: await buildPackConfigFromManifest(manifest, root),
        importModule: file => import(pathToFileURL(file).href) });
      const writable = fs.openSync(source, fs.constants.O_RDWR);
      try { expect(fs.readFileSync(writable, 'utf8')).toBe('LIVE'); }
      finally { fs.closeSync(writable); }
      expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).main).toBe(source);
      const output = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'rows.content.json'), 'utf8'));
      expect(output.records[0].name).toBe(Array(7).fill('CAPTURED').join(':'));
      fs.writeFileSync(path.join(outputDirectory, 'live.txt'), 'FIRST');
      expect(fs.readFileSync(path.join(outputDirectory, 'live.txt'), 'utf8')).toBe('FIRST');
      const handle = await fs.promises.open(path.join(outputDirectory, 'live.txt'), 'w');
      try { await handle.writeFile('SECOND'); } finally { await handle.close(); }
      expect(fs.readFileSync(path.join(outputDirectory, 'live.txt'), 'utf8')).toBe('SECOND');
    });
    expect(fs.readFileSync(source, 'utf8')).toBe('LIVE');
    fs.writeFileSync(source, 'CAPTURED');
    compilation.assertCurrent();
  } finally { compilation.dispose(); }
});

it('keeps concurrent build views isolated and reports missing input paths without private locations', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-concurrent-reads-')));
  roots.push(root);
  const source = path.join(root, 'value.txt');
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(source, 'FIRST');
  const first = captureCompilationInputs(root);
  fs.writeFileSync(source, 'SECOND');
  const second = captureCompilationInputs(root);
  fs.writeFileSync(source, 'LIVE');
  const outputDirectory = path.join(root, 'dist');
  try {
    const values = await Promise.all([first, second].map(compilation =>
      withCompilerFileReads({ compilation, outputDirectory }, async () => {
        await new Promise(resolve => setImmediate(resolve));
        const data = await fs.promises.readFile(source, 'utf8');
        const missing = path.join(root, 'missing.txt');
        try { await fs.promises.readFile(missing); throw new Error('Missing file was read'); }
        catch (error) {
          expect(error).toMatchObject({ code: 'ENOENT', path: missing });
          expect(String(error)).not.toContain('apack-inputs-');
        }
        return data;
      })));
    expect(values).toEqual(['FIRST', 'SECOND']);
    expect(fs.readFileSync(source, 'utf8')).toBe('LIVE');
  } finally { first.dispose(); second.dispose(); }
});

it('owns native directory results across sync, callback and promise reads without exposing mutable Dirents', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-directory-reads-')));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const directory = path.join(root, 'content');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'original.txt'), 'ORIGINAL');
  fs.symlinkSync('original.txt', path.join(directory, 'linked.txt'));
  const incumbent = path.join(root, 'dist/previous.txt');
  fs.mkdirSync(path.dirname(incumbent));
  fs.writeFileSync(incumbent, 'PREVIOUS');
  const baseline = fs.readdirSync(directory, { withFileTypes: true });
  const compilation = captureCompilationInputs(root);
  const options = { withFileTypes: true } as const;
  try {
    await withCompilerFileReads({ compilation, outputDirectory: path.join(root, '.apack/staging') }, async () => {
      expect(fs.readFileSync(incumbent, 'utf8')).toBe('PREVIOUS');
      const first = fs.readdirSync(directory, options);
      const names = baseline.map(entry => entry.name);
      expect(first.map(entry => entry.name)).toEqual(names);
      first[0]!.name = 'MUTATED';
      first.pop();
      const late = path.join(directory, 'late.txt');
      fs.writeFileSync(late, 'LATE');
      const promise = await fs.promises.readdir(directory, options);
      const callback = await new Promise<fs.Dirent[]>((resolve, reject) =>
        fs.readdir(directory, options, (error, entries) => error ? reject(error) : resolve(entries)));
      for (const entries of [promise, callback]) {
        expect(entries.map(entry => entry.name)).toEqual(names);
        expect(entries.find(entry => entry.name === 'linked.txt')?.isSymbolicLink()).toBe(true);
        expect(entries.every(entry => entry.parentPath === directory)).toBe(true);
      }
      expect(() => compilation.assertCurrent()).toThrow('Compiler or installed package inputs changed');
      fs.unlinkSync(late);
      const buffers = fs.readdirSync(directory, { encoding: 'buffer' });
      expect(buffers.map(entry => entry.toString())).toEqual(names);
      buffers[0]!.fill(0);
      expect(fs.readdirSync(directory, { encoding: 'buffer' }).map(entry => entry.toString())).toEqual(names);
    });
    compilation.assertCurrent();
  } finally { compilation.dispose(); }
});

it('shares captured metadata across native sync, callback and promise APIs', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-metadata-scope-')));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const file = path.join(root, 'value.txt');
  const link = path.join(root, 'linked.txt');
  const missing = path.join(root, 'missing.txt');
  fs.writeFileSync(file, 'ONE');
  fs.symlinkSync('value.txt', link);
  const compilation = captureCompilationInputs(root);
  try {
    await withCompilerFileReads({ compilation, outputDirectory: path.join(root, 'dist') }, async () => {
      expect(fs.statSync(file).size).toBe(3);
      expect(fs.statSync(file, { bigint: true }).size).toBe(3n);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync.native(link)).toBe(file);
      expect(await fs.promises.readlink(link)).toBe('value.txt');
      expect(fs.existsSync(missing)).toBe(false);
      await fs.promises.access(file, fs.constants.R_OK);
      fs.writeFileSync(file, 'DIFFERENT');
      fs.writeFileSync(missing, 'NEW');
      expect((await fs.promises.stat(file)).size).toBe(3);
      const stat = await new Promise<fs.Stats>((resolve, reject) => fs.stat(file, (error, value) => error ? reject(error) : resolve(value)));
      expect(stat.size).toBe(3);
      expect(await new Promise(resolve => fs.exists(missing, resolve))).toBe(false);
      expect(await promisify(fs.exists)(missing)).toBe(false);
      expect(() => compilation.assertCurrent()).toThrow('Compiler or installed package inputs changed');
      fs.writeFileSync(file, 'ONE');
      fs.unlinkSync(missing);
    });
    compilation.assertCurrent();
  } finally { compilation.dispose(); }
});

it('keeps descriptor metadata with captured bytes through pathname replacement and closure', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-descriptor-scope-')));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const file = path.join(root, 'value.txt'), held = path.join(root, 'held.txt');
  fs.writeFileSync(file, 'ORIGINAL');
  const source = fs.statSync(file, { bigint: true });
  const compilation = captureCompilationInputs(root);
  try {
    fs.writeFileSync(file, 'LIVE');
    await withCompilerFileReads({ compilation, outputDirectory: path.join(root, 'dist') }, async () => {
      const defaultFd = await new Promise<number>((resolve, reject) => fs.open(file, (error, fd) => error ? reject(error) : resolve(fd)));
      try { expect(fs.readFileSync(defaultFd, 'utf8')).toBe('ORIGINAL'); }
      finally { await new Promise<void>((resolve, reject) => fs.close(defaultFd, error => error ? reject(error) : resolve())); }
      const fd = fs.openSync(file, 'r');
      const handle = await fs.promises.open(file, 'r');
      fs.renameSync(file, held);
      fs.writeFileSync(file, 'REPLACEMENT');
      try {
        expect(fs.readFileSync(fd, 'utf8')).toBe('ORIGINAL');
        const stat = fs.fstatSync(fd);
        expect(stat.ino).toBe(Number(source.ino));
        expect(stat.mode).toBe(Number(source.mode));
        expect(stat.size).toBe(8);
        const callback = await new Promise<fs.BigIntStats>((resolve, reject) =>
          fs.fstat(fd, { bigint: true }, (error, value) => error ? reject(error) : resolve(value)));
        expect(callback.ino).toBe(source.ino);
        expect(callback.size).toBe(8n);
        expect((await handle.stat({ bigint: true })).ino).toBe(source.ino);
        expect((await handle.stat()).size).toBe(8);
      } finally {
        fs.closeSync(fd);
        await handle.close();
        fs.unlinkSync(file);
        fs.renameSync(held, file);
      }
      expect(() => fs.fstatSync(fd)).toThrow(/EBADF/);
      await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
      const output = path.join(root, 'dist/output.txt');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const writable = fs.openSync(output, 'w+');
      try {
        fs.writeSync(writable, 'OUTPUT');
        expect(fs.fstatSync(writable).ino).toBe(fs.statSync(output).ino);
        expect(fs.fstatSync(writable).size).toBe(6);
      } finally { fs.closeSync(writable); }
    });
    fs.writeFileSync(file, 'ORIGINAL');
    compilation.assertCurrent();
  } finally { compilation.dispose(); }
});

it('serves captured opendir membership through all native handle entry points', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-opendir-scope-')));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const source = path.join(root, 'content');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'original.txt'), 'ORIGINAL');
  fs.mkdirSync(path.join(source, 'nested'));
  fs.writeFileSync(path.join(source, 'nested/child.txt'), 'CHILD');
  const options = { recursive: true, bufferSize: 1 };
  const baseline = fs.opendirSync(source, options);
  const expected: string[] = [];
  try { for (let entry; (entry = baseline.readSync()) !== null;) expected.push(path.join(entry.parentPath, entry.name)); }
  finally { baseline.closeSync(); }
  const compilation = captureCompilationInputs(root);
  try {
    await withCompilerFileReads({ compilation, outputDirectory: path.join(root, 'dist') }, async () => {
      const standard = await fs.promises.opendir(source, {});
      const names: string[] = [];
      for await (const entry of standard) names.push(entry.name);
      expect(names.sort()).toEqual(['nested', 'original.txt']);
      const first = fs.opendirSync(source, options);
      const late = path.join(source, 'late.txt');
      const values: string[] = [];
      try { for (let entry; (entry = first.readSync()) !== null;) values.push(path.join(entry.parentPath, entry.name)); }
      finally { first.closeSync(); }
      expect(values).toEqual(expected);
      fs.writeFileSync(late, 'LATE');
      const promised = await fs.promises.opendir(source, options);
      const actual: string[] = [];
      for await (const entry of promised) actual.push(path.join(entry.parentPath, entry.name));
      expect(actual).toEqual(expected);
      const callback = await new Promise<fs.Dir>((resolve, reject) => fs.opendir(source, options, (error, directory) => error ? reject(error) : resolve(directory)));
      try {
        const one = await callback.read();
        expect(path.join(one!.parentPath, one!.name)).toBe(expected[0]);
      } finally { await callback.close(); }
      expect(() => compilation.assertCurrent()).toThrow('Compiler or installed package inputs changed');
      fs.unlinkSync(late);
    });
    compilation.assertCurrent();
  } finally { compilation.dispose(); }
});

it('executes owned TypeScript compiler modules and transitive imports through temporary source edits', async () => {
  vi.stubEnv('TSX_DISABLE_CACHE', '1');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-content-module-')));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    paths: { '#value': [path.join(root, 'src/value.ts')] }, jsx: 'react', jsxFactory: 'h',
  } }));
  const compiler = path.join(root, 'src/compiler.tsx');
  const value = path.join(root, 'src/value.ts');
  const original = `import { value } from '#value';
    import { extra } from ${JSON.stringify(path.join(root, 'src/extra.tsx') + '?fixture=1#static')};
    import {createRequire} from 'node:module';
    const h = () => 'JSX';
    export default async () => { const target = ${JSON.stringify(pathToFileURL(path.join(root, 'src/dynamic.tsx')).href + '?fixture=2#dynamic')};
      const dynamic = await import(target);
      const resolved = import.meta.resolve(target);
      const required = createRequire(import.meta.url)(${JSON.stringify(path.join(root, 'src/common.cjs'))});
      const originalParent = createRequire(${JSON.stringify(path.join(root, 'package.json'))})('./src/common.cjs');
      const identity = new URL(resolved);
      if (identity.searchParams.get('fixture') !== '2' || identity.hash !== '#dynamic') throw new Error('Invalid module resolution: ' + resolved);
      return [{ entity: 'Row', name: [value, extra, dynamic.default, required, originalParent, <row />].join(':'),
        source: import.meta.filename, directory: import.meta.dirname, origin: import.meta.url }]; };`;
  fs.writeFileSync(compiler, original);
  fs.writeFileSync(value, "export const value: string = 'CAPTURED';");
  fs.writeFileSync(path.join(root, 'src/extra.tsx'), "const h = () => 'EXTRA'; export const extra = <mark />;");
  fs.writeFileSync(path.join(root, 'src/dynamic.tsx'), "const h = () => 'DYNAMIC'; export default <mark />;");
  fs.writeFileSync(path.join(root, 'src/common.cjs'), "module.exports = 'COMMON';");
  fs.writeFileSync(path.join(root, 'src/data.txt'), 'DATA');
  const steps = path.join(root, 'src/steps.mjs');
  const flow = path.join(root, 'src/flows/empty.ts');
  fs.mkdirSync(path.dirname(flow));
  fs.writeFileSync(steps, 'export const steps = [];');
  fs.writeFileSync(flow, 'export default {};');
  const manifest = ManifestSchema.parse({ id: 'owned-module', name: 'Owned module', version: '1.0.0',
    content: { formats: { rows: { compiler: 'src/compiler.tsx', entity: 'Row', identity: ['name'] } },
      sources: { rows: { path: 'src/data.txt', format: 'rows' }, flows: { path: 'src/flows' } } } });
  const compilation = captureCompilationInputs(root);
  const modules = createCompilerModuleLoader(compilation);
  const outputDirectory = path.join(root, 'dist');
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}');
    fs.writeFileSync(compiler, "throw new Error('Executed live compiler');");
    fs.writeFileSync(value, "export const value: string = 'LIVE';");
    fs.writeFileSync(path.join(root, 'src/extra.tsx'), "export const extra = 'LIVE';");
    fs.writeFileSync(path.join(root, 'src/dynamic.tsx'), "export default 'LIVE';");
    fs.writeFileSync(path.join(root, 'src/common.cjs'), "module.exports = 'LIVE';");
    fs.writeFileSync(steps, "throw new Error('Executed live steps');");
    fs.writeFileSync(flow, "throw new Error('Executed live flow');");
    await withCompilerFileReads({ compilation, outputDirectory }, async () => {
      await compilePack({ packDir: root, outputDir: outputDirectory,
        packConfig: await buildPackConfigFromManifest(manifest, root, { dependencyStepModules: [steps] }),
        importModule: modules.importModule });
    });
    const output = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'rows.content.json'), 'utf8'));
    expect(output.records[0].name).toBe('CAPTURED:EXTRA:DYNAMIC:COMMON:COMMON:JSX');
    expect(output.records[0].source).toBe(compiler);
    expect(output.records[0].directory).toBe(path.dirname(compiler));
    expect(new URL(output.records[0].origin).pathname).toBe(pathToFileURL(compiler).pathname);
    fs.writeFileSync(steps, 'export const steps = [];');
    fs.writeFileSync(flow, 'export default {};');
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(compiler, original);
    fs.writeFileSync(value, "export const value: string = 'CAPTURED';");
    fs.writeFileSync(path.join(root, 'src/extra.tsx'), "const h = () => 'EXTRA'; export const extra = <mark />;");
    fs.writeFileSync(path.join(root, 'src/dynamic.tsx'), "const h = () => 'DYNAMIC'; export default <mark />;");
    fs.writeFileSync(path.join(root, 'src/common.cjs'), "module.exports = 'COMMON';");
    compilation.assertCurrent();
  } finally { await modules.dispose(); compilation.dispose(); }
});

it('keeps original-parent require calls isolated across concurrent module scopes', async () => {
  vi.stubEnv('TSX_DISABLE_CACHE', '1');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-module-generations-')));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const entry = path.join(root, 'compiler.mjs'), value = path.join(root, 'value.cjs');
  fs.writeFileSync(entry, `import {createRequire} from 'node:module';
    export const read = () => createRequire(${JSON.stringify(path.join(root, 'package.json'))})('./value.cjs');`);
  fs.writeFileSync(value, "module.exports = 'FIRST';");
  const first = captureCompilationInputs(root);
  fs.writeFileSync(value, "module.exports = 'SECOND';");
  const second = captureCompilationInputs(root);
  fs.writeFileSync(value, "module.exports = 'LIVE';");
  const compilations = [first, second];
  const loaders = compilations.map(createCompilerModuleLoader);
  try {
    const results = await Promise.all(compilations.map((compilation, index) =>
      withCompilerFileReads({ compilation, outputDirectory: path.join(root, 'dist') }, async () => {
        const loaded = await loaders[index]!.importModule(entry);
        await new Promise(resolve => setImmediate(resolve));
        return (loaded.read as () => string)();
      })));
    expect(results).toEqual(['FIRST', 'SECOND']);
    // Captured execution must not redirect ordinary require calls after either scope finishes.
    const { createRequire } = await import('node:module');
    expect(createRequire(path.join(root, 'package.json'))('./value.cjs')).toBe('LIVE');
  } finally {
    await Promise.all(loaders.map(loader => loader.dispose()));
    compilations.forEach(compilation => compilation.dispose());
  }
});

it('uses captured JSX and alias configuration for CommonJS compiler modules', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-commonjs-config-')));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'commonjs',
    imports: { '#native': './native.cjs' }, dependencies: { dependency: '1.0.0' } }));
  fs.writeFileSync(path.join(root, 'native.cjs'), "module.exports = ':NATIVE';");
  const dependency = path.join(root, 'node_modules/dependency');
  fs.mkdirSync(dependency, { recursive: true });
  fs.writeFileSync(path.join(dependency, 'package.json'), '{"name":"dependency","version":"1.0.0","main":"index.cjs"}');
  fs.writeFileSync(path.join(dependency, 'index.cjs'), "module.exports = require('#captured/value');");
  const config = path.join(root, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'h',
    paths: { '#captured/*': ['./missing/*', './src/*'] } } }));
  const entry = path.join(root, 'compiler.tsx');
  fs.mkdirSync(path.join(root, 'src'));
  const alias = path.join(root, 'src/value.ts');
  fs.writeFileSync(alias, "export const suffix = ':ALIAS';");
  const source = `import fs from 'node:fs';
    import {suffix} from '#captured/value';
    const h = () => fs.readFileSync(__dirname + '/value.txt', 'utf8') + suffix + require('#native');
    export const value = <row />;
    export const dependencyError = (() => { try { return require('dependency'); } catch (error) { return error.code; } })();
    export const filename = __filename;
    export const directory = __dirname;`;
  fs.writeFileSync(entry, source);
  fs.writeFileSync(path.join(root, 'value.txt'), 'CAPTURED');
  const compilation = captureCompilationInputs(root);
  const modules = createCompilerModuleLoader(compilation);
  try {
    fs.writeFileSync(config, JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'live' } }));
    fs.writeFileSync(entry, "throw new Error('Executed live CommonJS compiler');");
    fs.writeFileSync(alias, "export const suffix = ':LIVE';");
    fs.writeFileSync(path.join(root, 'value.txt'), 'LIVE');
    const result = await withCompilerFileReads({ compilation, outputDirectory: path.join(root, 'dist') },
      () => modules.importModule(entry));
    expect(result.value).toBe('CAPTURED:ALIAS:NATIVE');
    expect(result.dependencyError).toBe('MODULE_NOT_FOUND');
    expect(result.filename).toBe(entry);
    expect(result.directory).toBe(root);
    expect(() => compilation.assertCurrent()).toThrow('Compiler or installed package inputs changed');
  } finally { await modules.dispose(); compilation.dispose(); }
});
