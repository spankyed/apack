import { posix as path } from 'node:path';
import fs from 'node:fs';
import { expect, it, vi } from 'vitest';
import { assertCapturedMachOLibraries, assertCompilerLibraryEnvironment, captureMachOLibraryEnvironment, parseMachOLibraryCommands } from '../../src/build/compiler-native-libraries.ts';

function image(commands: [number, string][], little = true, sdk?: number) {
  const write = (buffer: Buffer, value: number, at: number) => little ? buffer.writeUInt32LE(value, at) : buffer.writeUInt32BE(value, at);
  const entries = commands.map(([command, name]) => {
    const value = Buffer.from(name + '\0');
    const entry = Buffer.alloc(Math.ceil((24 + value.length) / 8) * 8);
    write(entry, command, 0); write(entry, entry.length, 4); write(entry, 24, 8);
    value.copy(entry, 24);
    return entry;
  });
  if (sdk !== undefined) {
    const version = Buffer.alloc(24);
    write(version, 0x32, 0); write(version, 24, 4); write(version, 1, 8); write(version, sdk, 16);
    entries.push(version);
  }
  const header = Buffer.alloc(32);
  write(header, 0xfeedfacf, 0); write(header, entries.length, 16);
  write(header, entries.reduce((sum, entry) => sum + entry.length, 0), 20);
  return Buffer.concat([header, ...entries]);
}

it.each([true, false])('distinguishes dependencies and rpaths from image IDs (little endian: %s)', little => {
  expect(parseMachOLibraryCommands(image([
    [0xd, '/build-machine/not-a-dependency'], [0xc, '/usr/lib/libSystem.B.dylib'],
    [0x80000018, '@loader_path/weak.dylib'], [0x8000001f, '@rpath/reexport.dylib'],
    [0x8000001c, '@loader_path/lib'],
  ], little), 'arm64')).toEqual({ dependencies: ['/usr/lib/libSystem.B.dylib', '@loader_path/weak.dylib', '@rpath/reexport.dylib'], rpaths: ['@loader_path/lib'] });
});

it.each([0xc0000, 0xd0000, 0xe0000])('uses the image SDK to select standard dylib fallbacks: %s', sdk => {
  const library = '/usr/local/lib/value.dylib';
  const files = new Map([[entry, image([[0xc, 'value.dylib']], true, sdk)], [library, image([])]]);
  const read: string[] = [];
  const check = () => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', realpath: file => file,
    environment: captureMachOLibraryEnvironment({}), read(file) { read.push(file); return files.get(file); } });
  if (sdk < 0xe0000) expect(check).toThrow(`selects "${library}"`);
  else { expect(check).not.toThrow(); expect(read).not.toContain(library); }
});

it.each([true, false])('reads SDK versions from both Mach-O version commands (little endian: %s)', little => {
  const bytes = image([], little, 0xd0200);
  const write = (value: number, at: number) => little ? bytes.writeUInt32LE(value, at) : bytes.writeUInt32BE(value, at);
  expect(parseMachOLibraryCommands(bytes, 'arm64').sdk).toBe(0xd0200);
  write(0x24, 32); write(0xc0000, 44);
  expect(parseMachOLibraryCommands(bytes, 'arm64').sdk).toBe(0xc0000);
});

it('suppresses standard fallbacks when the explicit fallback list is empty', () => {
  const library = '/usr/local/lib/value.dylib';
  const files = new Map([[entry, image([[0xc, 'value.dylib']], true, 0xd0000)], [library, image([])]]);
  const reads: string[] = [];
  assertCapturedMachOLibraries(entry, root, { arch: 'arm64', realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_FALLBACK_LIBRARY_PATH: '' }),
    read(file) { reads.push(file); return files.get(file); } });
  expect(reads).not.toContain(library);
});

it('checks standard framework fallbacks only after a package-relative dependency is missing', () => {
  const relative = path.join(root, 'Value.framework/Versions/A/Value');
  const fallback = '/Library/Frameworks/Value.framework/Versions/A/Value';
  const files = new Map([[entry, image([[0xc, '@loader_path/../Value.framework/Versions/A/Value']], true, 0xd0000)],
    [relative, image([])], [fallback, image([])]]);
  const check = () => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', realpath: file => file,
    environment: captureMachOLibraryEnvironment({}), read: file => files.get(file) });
  expect(check).not.toThrow();
  files.delete(relative);
  expect(check).toThrow(`selects "${fallback}"`);
});

it('inspects only the selected architecture in a universal image', () => {
  const x64 = image([[0xc, '/outside/wrong-architecture.dylib']]);
  const arm64 = image([[0xc, '/usr/lib/libSystem.B.dylib']]);
  const header = Buffer.alloc(48);
  header.writeUInt32BE(0xcafebabe, 0); header.writeUInt32BE(2, 4);
  header.writeUInt32BE(0x1000007, 8); header.writeUInt32BE(48, 16); header.writeUInt32BE(x64.length, 20);
  header.writeUInt32BE(0x100000c, 28); header.writeUInt32BE(48 + x64.length, 36); header.writeUInt32BE(arm64.length, 40);
  expect(parseMachOLibraryCommands(Buffer.concat([header, x64, arm64]), 'arm64').dependencies).toEqual(['/usr/lib/libSystem.B.dylib']);
});

it('refuses truncated and invalid command ranges', () => {
  const bytes = image([[0xc, '/outside/lib.dylib']]);
  expect(() => parseMachOLibraryCommands(bytes.subarray(0, -1), 'arm64')).toThrow('Invalid Mach-O');
  bytes.writeUInt32LE(0, 36);
  expect(() => parseMachOLibraryCommands(bytes, 'arm64')).toThrow('Invalid Mach-O');
});

const root = path.resolve('/captured/package');
const entry = path.join(root, 'binding/addon.node');
function check(files: Map<string, Buffer>, realpath = (file: string) => file) {
  return () => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read: file => files.get(file), realpath });
}

it('accepts transitive package-relative and system libraries without treating IDs as dependencies', () => {
  const library = path.join(root, 'lib/value.dylib');
  const nested = path.join(root, 'lib/nested.dylib');
  expect(check(new Map([
    [entry, image([[0xd, '/outside/build-id'], [0xc, '@loader_path/../lib/value.dylib']])],
    [library, image([[0xc, '@loader_path/nested.dylib']])],
    [nested, image([[0xc, '/System/Library/Frameworks/Foundation.framework/Foundation']])],
  ]))).not.toThrow();
});

it('resolves executable-relative framework inputs against the selected runtime distribution', () => {
  const directory = '/captured/App.app/Contents';
  const executable = directory + '/MacOS/apack';
  const library = directory + '/Frameworks/value.dylib';
  const files = new Map([[executable, image([[0xc, '@executable_path/../Frameworks/value.dylib']])], [library, image([])]]);
  const reads: string[] = [];
  expect(() => assertCapturedMachOLibraries(executable, directory, { executable, cwd: '/child', arch: 'arm64',
    environment: captureMachOLibraryEnvironment({}), realpath: file => file,
    read(file) { reads.push(file); return files.get(file); } })).not.toThrow();
  expect(reads).toContain(library);
});

it('resolves relative native search paths against the child working directory', () => {
  const outside = '/child/overrides/value.dylib';
  const files = new Map([[entry, image([[0xc, '@loader_path/../lib/value.dylib']])], [outside, image([])]]);
  expect(() => assertCapturedMachOLibraries(entry, root, { cwd: '/child', arch: 'arm64',
    environment: captureMachOLibraryEnvironment({ DYLD_LIBRARY_PATH: 'overrides' }),
    read: file => files.get(file), realpath: file => file })).toThrow(outside);
});

it('applies dyld overrides to dependencies without replacing the selected main executable', () => {
  const executable = root + '/runtime';
  const files = new Map([[executable, image([[0xc, '/usr/lib/libSystem.B.dylib']])],
    ['/outside/runtime', image([])], [executable + '_debug', image([[0xc, '/outside/value.dylib']])]]);
  const reads: string[] = [];
  expect(() => assertCapturedMachOLibraries(executable, root, { executable, arch: 'arm64',
    environment: captureMachOLibraryEnvironment({ DYLD_LIBRARY_PATH: '/outside', DYLD_IMAGE_SUFFIX: '_debug' }),
    realpath: file => file, read(file) { reads.push(file); return files.get(file); } })).not.toThrow();
  expect(reads).toContain(executable);
  expect(reads).not.toContain('/outside/runtime');
  expect(reads).not.toContain(executable + '_debug');
});

it.each([
  '/outside/lib.dylib', path.join(root, 'lib/live-original.dylib'), '@loader_path/../../../outside/lib.dylib', '../outside/lib.dylib',
])('refuses a dependency that bypasses the captured package: %s', dependency => {
  expect(check(new Map([[entry, image([[0xc, dependency]])]]))).toThrow('outside its captured package');
});

it('expands a framework binary\'s @loader_path from its versioned directory, as dyld does', () => {
  // Electron's framework reaches its sibling frameworks through @loader_path/../../.., written from Versions/A
  const frameworks = '/captured/App.app/Contents/Frameworks';
  const framework = frameworks + '/Value.framework/Value';
  const versioned = frameworks + '/Value.framework/Versions/A/Value';
  const helper = frameworks + '/Helper.framework/Helper';
  const files = new Map([[framework, image([[0x8000001c, '@loader_path/../../..'], [0xc, '@rpath/Helper.framework/Helper']])],
    [versioned, image([])], [helper, image([])]]);
  const reads: string[] = [];
  expect(() => assertCapturedMachOLibraries(framework, frameworks, { arch: 'arm64', environment: captureMachOLibraryEnvironment({}),
    realpath: file => file === framework ? versioned : file, read(file) { reads.push(file); return files.get(file); } })).not.toThrow();
  expect(reads).toContain(helper);
});

it('checks package rpaths and refuses external search roots', () => {
  const library = path.join(root, 'lib/value.dylib');
  expect(check(new Map([[entry, image([[0x8000001c, '@loader_path/../lib'], [0xc, '@rpath/value.dylib']])], [library, image([])]]))).not.toThrow();
  expect(check(new Map([[entry, image([[0x8000001c, '/outside'], [0xc, '@rpath/value.dylib']])]]))).toThrow('references "/outside"');
});

it('refuses transitive escapes and symlinks outside the package', () => {
  const library = path.join(root, 'lib/value.dylib');
  const files = new Map([[entry, image([[0xc, '@loader_path/../lib/value.dylib']])], [library, image([[0xc, '/outside/nested.dylib']])]]);
  expect(check(files)).toThrow('references "/outside/nested.dylib"');
  files.set(library, image([]));
  expect(check(files, file => file === library ? '/outside/value.dylib' : file)).toThrow('outside its captured package');
});

it('does not confuse unused search paths with outside-library dependencies', () => {
  expect(check(new Map([[entry, image([[0x8000001c, '/build-machine/unused'], [0xc, '/usr/lib/libSystem.B.dylib']])]]))).not.toThrow();
});

it('preserves search order when a captured library precedes an unused outside fallback', () => {
  const library = path.join(root, 'lib/value.dylib');
  expect(check(new Map([
    [entry, image([[0x8000001c, '@loader_path/../lib'], [0x8000001c, '/unused/outside'], [0xc, '@rpath/value.dylib']])],
    [library, image([])],
  ]))).not.toThrow();
});

it('retains launch-time native search paths after preload environment changes', () => {
  const env = { DYLD_LIBRARY_PATH: '/first:/second', DYLD_FALLBACK_LIBRARY_PATH: '/fallback', DYLD_FRAMEWORK_PATH: '/frameworks', DYLD_FALLBACK_FRAMEWORK_PATH: '/fallback-frameworks', DYLD_IMAGE_SUFFIX: '_first:_second' };
  const captured = captureMachOLibraryEnvironment(env);
  delete (env as NodeJS.ProcessEnv).DYLD_IMAGE_SUFFIX;
  delete (env as NodeJS.ProcessEnv).DYLD_FRAMEWORK_PATH;
  delete (env as NodeJS.ProcessEnv).DYLD_FALLBACK_FRAMEWORK_PATH;
  delete (env as NodeJS.ProcessEnv).DYLD_LIBRARY_PATH;
  delete (env as NodeJS.ProcessEnv).DYLD_FALLBACK_LIBRARY_PATH;
  expect(captured.imageSuffixes).toEqual(['_first', '_second']);
  expect(Object.isFrozen(captured.imageSuffixes)).toBe(true);
  expect(captured.frameworkPaths).toEqual(['/frameworks']);
  expect(captured.fallbackFrameworkPaths).toEqual(['/fallback-frameworks']);
  expect(Object.isFrozen(captured.frameworkPaths)).toBe(true);
  expect(Object.isFrozen(captured.fallbackFrameworkPaths)).toBe(true);
  expect(captured.libraryPaths).toEqual(['/first', '/second']);
  expect(Object.isFrozen(captured.libraryPaths)).toBe(true);
  expect(captured.fallbackLibraryPaths).toEqual(['/fallback']);
  expect(Object.isFrozen(captured.fallbackLibraryPaths)).toBe(true);
});

it.each(['value.dylib', 'addon.node', 'libSystem.B.dylib'])('refuses a selected outside search override: %s', name => {
  const outside = `/outside/${name}`;
  const files = new Map([[entry, image([[0xc, '@loader_path/../lib/value.dylib'], [0xc, '/usr/lib/libSystem.B.dylib']])], [outside, image([])]]);
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read: file => files.get(file), realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_LIBRARY_PATH: ['/missing', '/outside'].join(':') }) })).toThrow(`selects "${outside}" through DYLD_LIBRARY_PATH`);
});

it('observes missing override candidates while preserving captured relative loading', () => {
  const library = path.join(root, 'lib/value.dylib');
  const files = new Map([[entry, image([[0xc, '@loader_path/../lib/value.dylib']])], [library, image([])]]);
  const reads: string[] = [];
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read(file) { reads.push(file); return files.get(file); },
    realpath: file => file, environment: captureMachOLibraryEnvironment({ DYLD_LIBRARY_PATH: ['/unused'].join(':') }) })).not.toThrow();
  expect(reads).toContain('/unused/value.dylib');
  expect(reads).toContain(library);
});

it('stops at an existing operating-system override before an unused outside candidate', () => {
  const files = new Map([[entry, image([[0xc, '@loader_path/../lib/value.dylib']])],
    ['/usr/lib/value.dylib', image([])], ['/unused/value.dylib', image([])]]);
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read: file => files.get(file), realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_LIBRARY_PATH: ['/usr/lib', '/unused'].join(':') }) })).not.toThrow();
});

it('does not apply dylib basename overrides to framework references', () => {
  const framework = path.join(root, 'Foo.framework/Versions/A/Foo');
  const files = new Map([[entry, image([[0xc, '@loader_path/../Foo.framework/Versions/A/Foo']])],
    [framework, image([])], ['/unused/Foo', image([])]]);
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read: file => files.get(file), realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_LIBRARY_PATH: ['/unused'].join(':') }) })).not.toThrow();
});

it.runIf(process.platform === 'darwin').each(['/outside/init.dylib', '/usr/lib/../../outside/init.dylib', 'init.dylib'])(
  'refuses live library insertion before worker launch: %s', library => {
    expect(() => assertCompilerLibraryEnvironment({ DYLD_INSERT_LIBRARIES: library })).toThrow(`DYLD_INSERT_LIBRARIES references "${library}"`);
  },
);

it.runIf(process.platform === 'darwin')('permits empty insertion and normal operating-system libraries', () => {
  expect(() => assertCompilerLibraryEnvironment({})).not.toThrow();
  expect(() => assertCompilerLibraryEnvironment({ DYLD_INSERT_LIBRARIES: '' })).not.toThrow();
  expect(() => assertCompilerLibraryEnvironment({ DYLD_INSERT_LIBRARIES: '/usr/lib/libSystem.B.dylib' })).not.toThrow();
});

it.runIf(process.platform === 'darwin').each(['DYLD_VERSIONED_LIBRARY_PATH', 'DYLD_VERSIONED_FRAMEWORK_PATH', 'DYLD_SHARED_CACHE_DIR'] as const)(
  'limits %s to operating-system directories before launch', variable => {
    for (const directory of ['/outside', '/usr/lib/../../outside', '/usr/lib/apack-nonexistent-directory', 'relative', ':', '/usr/lib:']) {
      expect(() => assertCompilerLibraryEnvironment({ [variable]: directory })).toThrow(`${variable} references directory`);
    }
    for (const directory of ['', '/usr/lib', '/System/Library/Frameworks',
      ...(variable === 'DYLD_SHARED_CACHE_DIR' ? [] : ['/usr/lib:/System/Library'])]) {
      expect(() => assertCompilerLibraryEnvironment({ [variable]: directory })).not.toThrow();
    }
    if (variable === 'DYLD_SHARED_CACHE_DIR') {
      expect(() => assertCompilerLibraryEnvironment({ [variable]: '/usr/lib:/System/Library' })).toThrow(`${variable} references directory`);
    }
  },
);

it.runIf(process.platform === 'darwin').each(['DYLD_VERSIONED_LIBRARY_PATH', 'DYLD_VERSIONED_FRAMEWORK_PATH', 'DYLD_SHARED_CACHE_DIR'] as const)(
  'refuses outside %s directories without filesystem probes', variable => {
    const stat = vi.spyOn(fs, 'statSync').mockImplementation(() => { throw new Error('Outside path was probed'); });
    try { expect(() => assertCompilerLibraryEnvironment({ [variable]: '/outside' })).toThrow(`${variable} references directory`); }
    finally { stat.mockRestore(); }
  },
);

it('refuses an external explicit fallback for a bare library dependency', () => {
  const outside = '/outside/value.dylib';
  const files = new Map([[entry, image([[0xc, 'value.dylib']])], [outside, image([])]]);
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read: file => files.get(file), realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_FALLBACK_LIBRARY_PATH: ['/missing', '/outside'].join(':') }) })).toThrow(`selects "${outside}" through DYLD_FALLBACK_LIBRARY_PATH`);
});

it('does not inspect an unused fallback after resolving a package-relative library', () => {
  const library = path.join(root, 'lib/value.dylib');
  const files = new Map([[entry, image([[0xc, '@loader_path/../lib/value.dylib']])], [library, image([])], ['/outside/value.dylib', image([])]]);
  const reads: string[] = [];
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read(file) { reads.push(file); return files.get(file); }, realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_FALLBACK_LIBRARY_PATH: ['/outside'].join(':') }) })).not.toThrow();
  expect(reads).not.toContain('/outside/value.dylib');
});

it('checks a bare library in the working directory before explicit fallbacks', () => {
  // A Mach-O working directory is a POSIX path whichever platform runs the check
  const cwd = '/work', local = path.join(cwd, 'value.dylib');
  const files = new Map([[entry, image([[0xc, 'value.dylib']])], [local, image([])], ['/outside/value.dylib', image([])]]);
  const reads: string[] = [];
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', cwd, read(file) { reads.push(file); return files.get(file); }, realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_FALLBACK_LIBRARY_PATH: ['/outside'].join(':') }) })).toThrow('references "value.dylib"');
  expect(reads).toContain(local);
  expect(reads).not.toContain('/outside/value.dylib');
});

it.each(['Foo.framework/Foo', 'Foo.framework/Versions/A/Foo'])('checks the complete framework override path: %s', target => {
  const outside = path.join('/outside', target);
  const files = new Map([[entry, image([[0xc, `@loader_path/../${target}`]])], [outside, image([])]]);
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read: file => files.get(file), realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_FRAMEWORK_PATH: '/missing:/outside' }) })).toThrow(`selects "${outside}" through DYLD_FRAMEWORK_PATH`);
});

it('observes missing framework overrides and only checks fallbacks for unresolved frameworks', () => {
  const target = 'Foo.framework/Versions/A/Foo';
  const library = path.join(root, target);
  const outside = path.join('/outside', target);
  const files = new Map([[entry, image([[0xc, `@loader_path/../${target}`]])], [library, image([])], [outside, image([])]]);
  const reads: string[] = [];
  const inspect = () => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read(file) { reads.push(file); return files.get(file); }, realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_FRAMEWORK_PATH: '/missing', DYLD_FALLBACK_FRAMEWORK_PATH: '/outside' }) });
  expect(inspect).not.toThrow();
  expect(reads).toContain(path.join('/missing', target));
  expect(reads).not.toContain(outside);
  files.delete(library);
  expect(inspect).toThrow(`selects "${outside}" through DYLD_FALLBACK_FRAMEWORK_PATH`);
});

it('inspects selected suffixed libraries and ignores an unused nominal dependency', () => {
  const library = path.join(root, 'lib/value_debug.dylib');
  const files = new Map([[entry, image([[0xc, '@loader_path/../lib/value.dylib']])],
    [path.join(root, 'lib/value.dylib'), image([[0xc, '/unused/outside.dylib']])], [library, image([])]]);
  const inspect = () => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read: file => files.get(file), realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_IMAGE_SUFFIX: '_debug' }) });
  expect(inspect).not.toThrow();
  files.set(library, image([[0xc, '/selected/outside.dylib']]));
  expect(inspect).toThrow('references "/selected/outside.dylib"');
});

it('applies suffix order before rpath order and observes missing candidates without realpathing them', () => {
  const files = new Map([[entry, image([[0x8000001c, '@loader_path/../first'], [0x8000001c, '@loader_path/../second'], [0xc, '@rpath/value.dylib']])],
    [path.join(root, 'first/value.dylib'), image([[0xc, '/unused/outside.dylib']])], [path.join(root, 'second/value_debug.dylib'), image([])]]);
  const reads: string[] = [];
  const inspect = () => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read(file) { reads.push(file); return files.get(file); },
    realpath(file) { if (file !== root && !files.has(file)) throw new Error('Missing realpath: ' + file); return file; },
    environment: captureMachOLibraryEnvironment({ DYLD_IMAGE_SUFFIX: '_missing:_debug' }) });
  expect(inspect).not.toThrow();
  expect(reads).toContain(path.join(root, 'first/value_missing.dylib'));
  expect(reads).toContain(path.join(root, 'second/value_missing.dylib'));
  expect(reads).not.toContain(path.join(root, 'first/value.dylib'));
  files.set(path.join(root, 'first/value_missing.dylib'), image([[0xc, '/selected/outside.dylib']]));
  expect(inspect).toThrow('references "/selected/outside.dylib"');
});

it('inspects a suffixed Node addon before its ordinary image', () => {
  const selected = path.join(root, 'binding/addon_debug.node');
  const files = new Map([[entry, image([])], [selected, image([[0xc, '/outside/dependency.dylib']])]]);
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read: file => files.get(file), realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_IMAGE_SUFFIX: '_debug' }) })).toThrow('references "/outside/dependency.dylib"');
});

it('applies suffixes inside each override directory before moving to the next one', () => {
  const files = new Map([[entry, image([[0xc, '@loader_path/../lib/value.dylib']])],
    ['/usr/lib/value.dylib', image([])], ['/outside/value_debug.dylib', image([])]]);
  const reads: string[] = [];
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read(file) { reads.push(file); return files.get(file); }, realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_LIBRARY_PATH: '/usr/lib:/outside', DYLD_IMAGE_SUFFIX: '_debug' }) })).not.toThrow();
  expect(reads).toContain('/usr/lib/value_debug.dylib');
  expect(reads).not.toContain('/outside/value_debug.dylib');
});

it('checks the suffixed full framework override path', () => {
  const outside = '/outside/Foo.framework/Versions/A/Foo_debug';
  const files = new Map([[entry, image([[0xc, '@loader_path/../Foo.framework/Versions/A/Foo']])], [outside, image([])]]);
  expect(() => assertCapturedMachOLibraries(entry, root, { arch: 'arm64', read: file => files.get(file), realpath: file => file,
    environment: captureMachOLibraryEnvironment({ DYLD_FRAMEWORK_PATH: '/outside', DYLD_IMAGE_SUFFIX: '_debug' }) })).toThrow(`selects "${outside}" through DYLD_FRAMEWORK_PATH`);
});
