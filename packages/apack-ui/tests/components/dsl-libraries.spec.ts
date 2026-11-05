import { afterEach, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
import type { DslCatalogEntry } from '@apackdev/sdk/framework';
import { acquireDslLibraries, disposeDslLibraries } from '../../src/components/internal/dsl-libraries.ts';
import { getDslTypeFromPath, getLanguageFromPath, initializeMonaco, setupMonacoForFile, resetMonacoState } from '../../src/components/monaco-config.ts';

afterEach(() => { resetMonacoState(); disposeDslLibraries(); stopFeTestRuntime(); vi.unstubAllGlobals(); });
function fixture() {
  const declaration = { entry: 'missing/types.ts', targets: ['monaco' as const], prefix: 'memo:', globals: { item: '_dsl.Item' } };
  const entry: DslCatalogEntry = { type: 'memo', packId: 'author', origin: 'installed', enabled: false, declaration,
    definitions: 'declare module "@app/defs/memo" { export interface Item { before: string } }' };
  const state = { entries: [entry] }; const listeners = new Set<() => void>();
  startFeTestRuntime({ catalog: { status: () => 'ready', problem: () => undefined, frontend: () => [], references: () => [], steps: () => [], artifacts: () => [], blocks: () => [],
    events: () => [], dsl: () => state.entries, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } });
  const files = new Map<string, string>(); let revision = 0;
  const defaults = { setDiagnosticsOptions() {}, setCompilerOptions() {}, addExtraLib(text: string, uri: string) {
    const file = uri.replace('inmemory://', ''); files.set(file, text); revision++;
    return { dispose() { files.delete(file); revision++; } };
  } };
  const monaco = { typescript: { typescriptDefaults: defaults, javascriptDefaults: defaults,
    ScriptTarget: { Latest: 99 }, ModuleResolutionKind: { NodeJs: 2 }, ModuleKind: { ESNext: 99, CommonJS: 1 }, JsxEmit: { React: 2 } },
    languages: { registerDocumentFormattingEditProvider: () => ({ dispose() {} }) } } as never;
  const source = 'item.';
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({ noLib: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }),
    getScriptFileNames: () => ['/draft.ts', ...files.keys()], getScriptVersion: () => String(revision), getProjectVersion: () => String(revision),
    getScriptSnapshot: file => { const text = file === '/draft.ts' ? source : files.get(file); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
    getCurrentDirectory: () => '/', getDefaultLibFileName: () => '/lib.d.ts', fileExists: file => files.has(file), readFile: file => files.get(file),
  };
  const language = ts.createLanguageService(host);
  const completions = () => language.getCompletionsAtPosition('/draft.ts', source.length, {})?.entries.map(value => value.name) ?? [];
  return { state, entry, listeners, files, monaco, completions, language, publish() { for (const listener of listeners) listener(); } };
}

it('updates real TypeScript completions from catalog text, sharing libraries until the last editor releases them', () => {
  const f = fixture(); const first = acquireDslLibraries(f.monaco, 'memo', 'typescript'); const second = acquireDslLibraries(f.monaco, 'memo', 'typescript');
  try {
    expect(f.files.size).toBe(2); expect(f.listeners.size).toBe(1); expect(f.completions()).toContain('before');
    f.state.entries = [{ ...f.entry, definitions: 'declare module "@app/defs/memo" { export interface Item { after: number } }' }]; f.publish();
    expect(f.completions()).toContain('after'); expect(f.completions()).not.toContain('before');
    first(); first(); expect(f.files.size).toBe(2); expect(f.listeners.size).toBe(1);
    f.state.entries = [{ ...f.entry, origin: 'source', definitions: undefined }]; f.publish();
    expect(f.files.size).toBe(0); expect(f.completions()).not.toContain('after');
    f.state.entries = [f.entry]; f.publish(); expect(f.completions()).toContain('before');
    f.state.entries = []; f.publish(); expect(f.files.size).toBe(0);
    second(); expect(f.listeners.size).toBe(0);
  } finally { first(); second(); f.language.dispose(); }
});

it('ignores empty prefixes, selects the unique longest prefix, and refuses ambiguous prefix ownership', () => {
  const f = fixture();
  try {
    f.state.entries.push({ ...f.entry, type: 'unprefixed', declaration: { ...f.entry.declaration, prefix: '' } });
    expect(getDslTypeFromPath('/data.json')).toBeNull(); expect(getLanguageFromPath('/data.json')).toBe('json');
    expect(getDslTypeFromPath('memo:one')).toBe('memo');
    f.state.entries.push({ ...f.entry, type: 'not-an-editor', declaration: { ...f.entry.declaration, prefix: 'asset:', targets: [] } });
    expect(getDslTypeFromPath('asset:one')).toBeNull();
    f.state.entries.push({ ...f.entry, type: 'specific', declaration: { ...f.entry.declaration, prefix: 'memo:deep:' } });
    expect(getDslTypeFromPath('memo:deep:one')).toBe('specific');
    f.state.entries.push({ ...f.entry, type: 'other' }); expect(getDslTypeFromPath('memo:one')).toBeNull();
  } finally { f.language.dispose(); }
});

it('loads explicit DSL libraries for an untitled file through the public setup API and releases them', () => {
  const f = fixture();
  initializeMonaco(f.monaco, { setupLanguages: false });
  const release = setupMonacoForFile(f.monaco, { filePath: 'untitled', dslType: 'memo' });
  try { expect(f.completions()).toContain('before'); }
  finally { release(); }
  expect(f.completions()).not.toContain('before'); expect(f.listeners.size).toBe(0);
  f.language.dispose();
});
