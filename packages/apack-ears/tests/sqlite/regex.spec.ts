import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRegexCompiler } from '../../src/sqlite/regex.ts';

const require = createRequire(import.meta.url);
const vendor = fileURLToPath(new URL('../../vendor/rregex/', import.meta.url));
const binding = () => require(join(vendor, 'rregex.cjs')) as {
  RRegex: { new (pattern: string): { free(): void }; prototype: { free(): void } }; __wasm: { memory: WebAssembly.Memory };
};
afterEach(() => { vi.restoreAllMocks(); });

describe('SQLite Rust regex bridge', () => {
  it('loads the exact controlled runtime assets', () => {
    const provenance = JSON.parse(readFileSync(join(vendor, 'provenance.json'), 'utf8'));
    expect(provenance.allocator).toBe('Rust default'); expect(provenance.defaultFeatures).toBe(false);
    for (const [file, hash] of Object.entries(provenance.sha256)) {
      expect(createHash('sha256').update(readFileSync(join(vendor, file))).digest('hex')).toBe(hash);
    }
  });

  it('compiles Rust syntax with Unicode, inline flags and class intersection', () => {
    const compiler = createRegexCompiler();
    for (const [pattern, text, answer] of [['(?i)^error', 'ERROR', true], ['\\p{Greek}+', 'Σίσυφος', true],
      ['\\b\\w+\\b', '東京', true], ['[a-z&&[^b]]+', 'b', false], ['(?:a+)+$', 'a'.repeat(100_000) + '!', false]] as const) {
      const regex = compiler.compile(pattern);
      try { expect(regex.matches(text)).toBe(answer); } finally { regex.close(); }
    }
  });

  it.each(['x(?=y)', '(a)\\1', '(', 'a{100000000}'])('retains the pattern and cause in syntax/size refusal: %s', pattern => {
    expect(() => createRegexCompiler().compile(pattern)).toThrow(expect.objectContaining({
      code: 'PATTERN_INVALID', message: expect.stringContaining(pattern), cause: expect.any(Error),
    }));
  });

  it('frees the owned allocation once and refuses using a closed pattern', () => {
    const { RRegex } = binding(), free = vi.spyOn(RRegex.prototype, 'free');
    const regex = createRegexCompiler().compile('alpha'); expect(regex.matches('alpha')).toBe(true);
    regex.close(); regex.close(); expect(free).toHaveBeenCalledTimes(1);
    expect(() => regex.matches('alpha')).toThrow(expect.objectContaining({ code: 'CLOSED' }));
    const another = createRegexCompiler().compile('beta');
    try { expect(another.matches('beta')).toBe(true); } finally { another.close(); }
  });

  it('does not relabel a WASM runtime failure as an invalid pattern', () => {
    const b = binding(), original = b.RRegex, failure = new WebAssembly.RuntimeError('regex parse error: synthetic runtime failure');
    try {
      b.RRegex = class { constructor() { throw failure; } free() {} };
      expect(() => createRegexCompiler().compile('valid')).toThrow(failure);
    } finally { b.RRegex = original; }
  });

  it('keeps WASM allocation stable through varied explicitly closed patterns', () => {
    const compiler = createRegexCompiler(), memory = binding().__wasm.memory;
    const warm = compiler.compile('(?i)foo'); warm.close();
    const samples: number[] = [];
    for (let batch = 0; batch < 5; batch++) {
      for (let i = 0; i < 500; i++) {
        const regex = compiler.compile('(?i)foo' + (batch * 500 + i));
        try { regex.matches('FOO' + i); } finally { regex.close(); }
      }
      samples.push(memory.buffer.byteLength);
    }
    expect(new Set(samples.slice(-4)).size).toBe(1);
  });

  it('imports and constructs a compiler without loading the WASM runtime', () => {
    const module = fileURLToPath(new URL('../../src/sqlite/regex.ts', import.meta.url));
    const script = `const {createRegexCompiler}=await import(${JSON.stringify(pathToFileURL(module).href)});createRegexCompiler();if(Object.keys((await import('node:module')).createRequire(import.meta.url).cache).some(p=>p.endsWith('/rregex.cjs')))throw Error('eager runtime load');`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL' });
    expect(child.status, child.stderr).toBe(0);
  });

  it('preserves missing-asset errors instead of reporting a pattern refusal', () => {
    const root = mkdtempSync(join(tmpdir(), 'ears-regex-missing-'));
    try {
      mkdirSync(join(root, 'src/sqlite'), { recursive: true }); mkdirSync(join(root, 'vendor/rregex'), { recursive: true });
      writeFileSync(join(root, 'package.json'), '{"type":"module"}');
      copyFileSync(fileURLToPath(new URL('../../src/sqlite/regex.ts', import.meta.url)), join(root, 'src/sqlite/regex.ts'));
      copyFileSync(join(vendor, 'rregex.cjs'), join(root, 'vendor/rregex/rregex.cjs'));
      const script = `const {createRegexCompiler}=await import(${JSON.stringify(pathToFileURL(join(root, 'src/sqlite/regex.ts')).href)});let error;try{createRegexCompiler().compile('valid')}catch(e){error=e}if(error?.code!=='ENOENT')throw Error('lost asset error: '+error);`;
      const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL' });
      expect(child.status, child.stderr).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
