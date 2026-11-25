// What packs registered lives in the registry instances the app, the harness and the CLI create: no module that
// registers or looks up packs' extensions keeps any of it at module scope.
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HOST_SRC = path.resolve(import.meta.dirname, '../../src');
const SDK_SRC = path.resolve(import.meta.dirname, '../../../apack-sdk/src');

/**
 * The modules this rule is about, **derived rather than listed**: a list is a second declaration of the
 * population, and the only thing it cannot say is that something new belongs in it. Writing it out missed
 * two SDK lookups that read the bound registry (`database-console/index.ts`, `framework/pack-help.ts`) —
 * both clean, which is luck rather than evidence, since nothing was asking them.
 *
 * Two halves, because the two sides relate to the registry differently. A **lookup** reads the bound one,
 * which its source says by naming `boundHost().packs`, `_boundBackendHost().packs`, `boundFeHost().packs`
 * or `_boundPackExtensions()`. A **store** is what the registry is built from, which is the two factories
 * and whatever they import from their own folder.
 */
const READS_THE_REGISTRY = /boundHost\(\)\.packs|_boundBackendHost\(\)\.packs|boundFeHost\(\)\.packs|_boundPackExtensions\(/;

function tsFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

/** The registry factories, and every module they build their stores from */
const REGISTRY_ROOTS = ['packs/registry.ts', 'fe/pack-store.ts'];

function registryModules(): string[] {
  const lookups = tsFilesUnder(SDK_SRC).filter((file) => READS_THE_REGISTRY.test(fs.readFileSync(file, 'utf-8')));
  const stores = new Set<string>();
  for (const root of REGISTRY_ROOTS) {
    const file = path.join(HOST_SRC, root);
    stores.add(file);
    for (const m of fs.readFileSync(file, 'utf-8').matchAll(/from '(\.\/[\w-]+\.ts)'/g)) {
      stores.add(path.join(path.dirname(file), m[1]!));
    }
  }
  return [...lookups, ...stores].sort();
}

const REGISTRY_MODULES = registryModules();

const COLLECTIONS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'Array']);

/** An array literal, unless it's a readonly constant (`[...] as const`) */
function isMutableArray(node: ts.Expression): boolean {
  let expr = node;
  while (ts.isSatisfiesExpression(expr) || ts.isParenthesizedExpression(expr)) expr = expr.expression;
  if (ts.isAsExpression(expr)) {
    if (ts.isTypeReferenceNode(expr.type) && expr.type.typeName.getText() === 'const') return false;
    expr = expr.expression;
  }
  return ts.isArrayLiteralExpression(expr);
}

/** The module-scope state a source file declares: `let`/`var`, collections, class instances and mutable arrays */
function moduleState(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const classes = new Set(sf.statements.filter(ts.isClassDeclaration).map((c) => c.name?.text));
  const found: string[] = [];
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const { flags } = statement.declarationList;
    for (const decl of statement.declarationList.declarations) {
      const name = decl.name.getText(sf);
      const line = sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1;
      const where = `${path.basename(file)}:${line} ${name}`;
      if (!(flags & ts.NodeFlags.Const)) {
        found.push(`${where} (let/var)`);
        continue;
      }
      const init = decl.initializer;
      if (!init) continue;
      if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)
        && (COLLECTIONS.has(init.expression.text) || classes.has(init.expression.text))) {
        found.push(`${where} (new ${init.expression.text})`);
      } else if (isMutableArray(init)) {
        found.push(`${where} (array)`);
      }
    }
  }
  return found;
}

describe('registry modules', () => {
  /** A derived population can come back empty, and then the rule below passes having read nothing */
  it('finds both halves, so the rule below is checking something', () => {
    const lookups = REGISTRY_MODULES.filter((file) => file.startsWith(SDK_SRC));
    const stores = REGISTRY_MODULES.filter((file) => file.startsWith(HOST_SRC));
    expect(lookups.length, 'no SDK module reads the bound registry — the derivation is broken, not the code').toBeGreaterThan(8);
    expect(stores.length, 'no host module builds the registry — the derivation is broken, not the code').toBeGreaterThan(3);
  });

  it('keep no state at module scope', () => {
    const found = REGISTRY_MODULES.flatMap((file) => moduleState(file, fs.readFileSync(file, 'utf-8')));
    expect(found, 'keep what packs registered in the registry instance (createPackRegistry, createFePackRegistry)').toEqual([]);
  });

  /**
   * **The scanner, over source written to offend it.** Without this a broken scanner reports an empty list
   * and the rule above passes for the wrong reason — which is the one failure a scan cannot notice about
   * itself. The negatives are the half worth having: a `const` holding a literal, a function that *returns*
   * a container, and anything declared inside one are all fine, and a scanner that flagged them would make
   * the rule unusable rather than merely weak.
   */
  it('finds module-scope state, and nothing else', () => {
    const text = [
      'let a = 1;',
      'var b;',
      'const c = new Map<string, number>();',
      'const d = new Set();',
      'const e = [] as string[];',
      'class Store {}',
      'const f = new Store();',
      'const ok1 = { x: 1 };',
      'const ok2 = [1, 2] as const;',
      'const ok3 = () => new Map();',
      'function ok4() { let inner = 0; const m = new Map(); return inner + m.size; }',
    ].join('\n');
    expect(moduleState('probe.ts', text).map((entry) => entry.replace(/^probe\.ts:\d+ /, ''))).toEqual([
      'a (let/var)', 'b (let/var)', 'c (new Map)', 'd (new Set)', 'e (array)', 'f (new Store)',
    ]);
  });
});
