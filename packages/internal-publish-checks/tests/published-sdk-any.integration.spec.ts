import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ONLY_EXPORTS } from '@apackdev/host/build/shared-deps';
import { PACKAGES_BUILT, installPublishedPackages } from '../src/published-packages.ts';

let consumer: string | undefined;
beforeAll(() => {
  if (PACKAGES_BUILT) consumer = installPublishedPackages();
});
afterAll(() => {
  if (consumer) fs.rmSync(consumer, { recursive: true, force: true });
});

/**
 * The published packages a pack installs, the SDK's EARS with them. Their declarations are ours, so `any`
 * in any of them is a leak and is walked wherever it's reached — including from another one's types,
 * since @apackdev/sdk's surface is largely @elmdb/ears' types. Everything else under node_modules
 * (vue, zod, ai) is a library's own business and is not walked.
 */
const PACK_FACING_PACKAGES = ['@elmdb/ears', '@apackdev/sdk', '@apackdev/ui'];
/**
 * Of those, the ones whose own exports are scanned: @apackdev/ui's surface is its component reports', and
 * @elmdb/ears' own exports are elmdb's to hold, where EARS is built; here it is walked where the SDK reaches it
 */
const SCANNED_PACKAGES = ['@apackdev/sdk'];

/** Where those packages are installed, as real paths, for the first-party check */
function packFacingRoots(consumerDir: string): string[] {
  return PACK_FACING_PACKAGES
    .map((name) => path.join(consumerDir, 'node_modules', ...name.split('/')))
    .filter((dir) => fs.existsSync(dir))
    .map((dir) => fs.realpathSync(dir));
}

/** `<subpath> <export>` for each pack-facing export whose type contains `any` */
function exportsWithAny(packageName: string, packageDir: string, firstPartyRoots: string[]): string[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
  const entries = Object.entries(manifest.exports as Record<string, unknown>)
    .filter(([key]) => !Object.hasOwn(APP_ONLY_EXPORTS, key === '.' ? packageName : `${packageName}/${key.slice(2)}`))
    .filter(([, target]) => typeof target === 'object' && target !== null && 'types' in target)
    .map(([key, target]) => [key, path.join(packageDir, (target as { types: string }).types)] as const);
  const program = ts.createProgram(entries.map(([, file]) => file), {
    strict: true, skipLibCheck: true, noEmit: true, types: ['node'],
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();
  const standardLibrary = (node: ts.Node) => program.isSourceFileDefaultLibrary(node.getSourceFile());
  const firstParty = (file: string) => firstPartyRoots.some((root) => fs.realpathSync(file).startsWith(root + path.sep));
  const thirdParty = (node: ts.Node) => {
    const file = node.getSourceFile().fileName;
    return /\/node_modules\//.test(file) && !standardLibrary(node) && !firstParty(file);
  };
  const typeArguments = (type: ts.Type) => (type.flags & ts.TypeFlags.Object && (type as ts.TypeReference).target
    ? checker.getTypeArguments(type as ts.TypeReference)
    : []);

  /** `<T = any>` (a caller who leaves T out gets any) or `<T extends …any…>` (any is what T accepts and reads as) */
  function typeParameterLeaks(parameter: ts.TypeParameter, seen: Set<ts.Type>, depth: number): boolean {
    const fallback = checker.getDefaultFromTypeParameter(parameter);
    if (fallback && containsAny(fallback, seen, depth + 1)) return true;
    const constraint = checker.getBaseConstraintOfType(parameter);
    return !!constraint && containsAny(constraint, seen, depth + 1);
  }

  function containsAny(type: ts.Type, seen: Set<ts.Type>, depth: number): boolean {
    if (type.flags & ts.TypeFlags.Any) return true;
    if (seen.has(type) || depth > 6) return false;
    seen.add(type);
    const alias = type.aliasSymbol?.declarations?.[0];
    const declaration = type.symbol?.declarations?.[0];
    if ((alias && thirdParty(alias)) || (declaration && thirdParty(declaration))) return false;
    if ((alias && standardLibrary(alias)) || (declaration && standardLibrary(declaration))) {
      const args = [...(alias && standardLibrary(alias) ? type.aliasTypeArguments ?? [] : []), ...typeArguments(type)];
      return args.some((t) => containsAny(t, seen, depth + 1));
    }
    if (type.isUnionOrIntersection()) return type.types.some((t) => containsAny(t, seen, depth + 1));
    if (type.flags & ts.TypeFlags.TypeParameter) return typeParameterLeaks(type as ts.TypeParameter, seen, depth);
    if (type.flags & ts.TypeFlags.Conditional) {
      // A generic conditional keeps its branches unresolved until it's instantiated, so walk the written ones
      const conditional = type as ts.ConditionalType;
      const branches = [conditional.root.node.trueType, conditional.root.node.falseType].map((node) => checker.getTypeFromTypeNode(node));
      if ([conditional.checkType, conditional.extendsType, ...branches].some((t) => containsAny(t, seen, depth + 1))) return true;
    }
    if (type.flags & ts.TypeFlags.IndexedAccess) {
      const indexed = type as ts.IndexedAccessType;
      if ([indexed.objectType, indexed.indexType].some((t) => containsAny(t, seen, depth + 1))) return true;
    }
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      if (containsAny(signature.getReturnType(), seen, depth + 1)) return true;
      if (signature.getTypeParameters()?.some((p) => typeParameterLeaks(p, seen, depth))) return true;
      // `this: any` is a parameter a caller's receiver is checked against, and it isn't in getParameters()
      const receiver = signature.thisParameter;
      if (receiver && containsAny(checker.getTypeOfSymbol(receiver), seen, depth + 1)) return true;
      if (signature.getParameters().some((p) => containsAny(checker.getTypeOfSymbol(p), seen, depth + 1))) return true;
    }
    if (!(type.flags & ts.TypeFlags.Object)) return false;
    if (typeArguments(type).some((t) => containsAny(t, seen, depth + 1))) return true;
    if (checker.getIndexInfosOfType(type).some((info) => containsAny(info.type, seen, depth + 1))) return true;
    return type.getProperties().some((property) => {
      const member = property.valueDeclaration ?? property.declarations?.[0];
      if (member && (thirdParty(member) || ts.getCombinedModifierFlags(member as ts.Declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))) return false;
      return containsAny(checker.getTypeOfSymbol(property), seen, depth + 1);
    });
  }

  function symbolLeaks(symbol: ts.Symbol, label: string, found: string[], depth: number): void {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declaration = target.declarations?.[0];
    if (!declaration || thirdParty(declaration)) return;
    if (target.flags & ts.SymbolFlags.Module && depth < 4) {
      // A namespace's type-only members (`namespace EARS { type X = any }`) are in neither its value
      // type nor its declared type, so each export is checked on its own
      for (const member of checker.getExportsOfModule(target)) symbolLeaks(member, `${label}.${member.name}`, found, depth + 1);
      // A namespace with no value side has no type of its own, and the checker answers `any` for it
      if (!(target.flags & ts.SymbolFlags.ValueModule)) return;
    }
    const type = target.flags & ts.SymbolFlags.Type && !(target.flags & ts.SymbolFlags.Value)
      ? checker.getDeclaredTypeOfSymbol(target)
      : checker.getTypeOfSymbolAtLocation(target, declaration);
    const typeParameters = ts.getEffectiveTypeParameterDeclarations(declaration as ts.DeclarationWithTypeParameters)
      .map((parameter) => checker.getTypeAtLocation(parameter) as ts.TypeParameter);
    if (containsAny(type, new Set(), 0) || typeParameters.some((p) => typeParameterLeaks(p, new Set(), 0))) found.push(label);
  }

  const found: string[] = [];
  for (const [key, file] of entries) {
    const module = checker.getSymbolAtLocation(program.getSourceFile(file)!);
    for (const symbol of module ? checker.getExportsOfModule(module) : []) symbolLeaks(symbol, `${key} ${symbol.name}`, found, 0);
  }
  return [...new Set(found)];
}

/**
 * No pack-facing export of the published packages exposes `any`: an export whose type (its
 * signature, `this` parameter, public members, type arguments, namespace members, conditional
 * branches, type parameter constraints or defaults, a few levels deep) contains `any` fails.
 *
 * `@apackdev/sdk` is checked, and walked into with `@elmdb/ears`, whose types its surface is largely made of;
 * a third-party library's own types (vue Component,
 * zod schemas) are the library's business and aren't walked. Standard library types (Array, Promise,
 * Record) are, through the type arguments we pass them. An entry in `APP_ONLY_EXPORTS` is skipped: only
 * the app's composition root loads it, never a pack.
 */

describe.skipIf(!PACKAGES_BUILT)('published pack-facing packages', () => {
  for (const name of SCANNED_PACKAGES) {
    it(`${name} exposes no any`, () => {
      const roots = packFacingRoots(consumer!);
      expect(exportsWithAny(name, path.join(consumer!, 'node_modules', ...name.split('/')), roots)).toEqual([]);
    });
  }
});

/**
 * The detector proved against declarations that leak on purpose. Without these the suite asserts only
 * that today's packages are clean, so a walk that quietly stopped following `this` parameters,
 * conditional branches or namespace members would keep passing — green and blind, which is the failure
 * this check exists to prevent in the first place.
 */
describe('the any detector itself', () => {
  const fixtures: string[] = [];
  afterAll(() => {
    for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A package whose single entry declares `source`, scanned as first-party */
  function scan(source: string): string[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'any-detector-'));
    fixtures.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: '@fixture/leaky', version: '0.0.0', exports: { '.': { types: './index.d.ts', default: './index.js' } },
    }));
    fs.writeFileSync(path.join(dir, 'index.d.ts'), source);
    return exportsWithAny('@fixture/leaky', dir, [fs.realpathSync(dir)]);
  }

  it.each([
    ['a type-parameter default', 'export declare function f<T = any>(x: T): void;'],
    ['a type-parameter constraint', 'export declare function f<T extends { leak: any }>(x: T): void;'],
    ['a this parameter', 'export declare function f(this: any, x: number): void;'],
    ['a return type', 'export declare function f(): any;'],
    ['a generic conditional branch', 'export type f<T> = T extends string ? any : number;'],
    ['a return type', 'export declare function f(): any;'],
    ['a public member', 'export interface f { leak: any }'],
    ['a type argument', 'export declare const f: Array<any>;'],
    ['an index signature', 'export interface f { [key: string]: any }'],
  ])('catches %s', (_form, source) => {
    expect(scan(source)).toEqual(['. f']);
  });

  it('reports nothing for declarations that expose no any', () => {
    expect(scan([
      'export declare function fn<T extends { ok: string } = { ok: string }>(this: void, x: T): T;',
      'export interface Shape { value: unknown; nested: { list: readonly string[] } }',
      'export declare namespace NS { type Alias = string }',
      'export type Cond<T> = T extends string ? number : boolean;',
    ].join('\n'))).toEqual([]);
  });

  // The namespace case is reported by the member that leaks, not by the namespace
  it('catches a type-only namespace member, naming the member', () => {
    expect(scan('export declare namespace f { type Leak = any; }')).toEqual(['. f.Leak']);
  });

  it('leaves a third-party type alone, since a library\'s any is its own business', () => {
    // The dependency sits beside the package, not inside it: a node_modules *under* the scanned root
    // is still under it, and first-party is decided by path prefix
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'any-detector-third-'));
    fixtures.push(root);
    const other = path.join(root, 'node_modules', 'other');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: 'other', version: '0.0.0', types: './index.d.ts' }));
    fs.writeFileSync(path.join(other, 'index.d.ts'), 'export interface Theirs { leak: any }\n');

    const pkg = path.join(root, 'pkg');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
      name: '@fixture/leaky', version: '0.0.0', exports: { '.': { types: './index.d.ts', default: './index.js' } },
    }));
    fs.writeFileSync(path.join(pkg, 'index.d.ts'), "import type { Theirs } from 'other';\nexport declare const f: Theirs;\n");
    expect(exportsWithAny('@fixture/leaky', pkg, [fs.realpathSync(pkg)])).toEqual([]);
  });
});
