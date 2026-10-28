// `query` names one thing: the engine's read operation, `ears.query(...)`, and the names built from it. A reader
// of an LMDB partition is `read`, a data dir's engine is `db.ears`, and a lookup that finds entities is `find…`
// (`packages/apack-ears/CLAUDE.md`, the naming rule). This holds that over every name the three packages export,
// and every member of an exported type, since a member is where the other meanings lived — and over the names the
// Database console injects, which are the library's own rather than a shorter second set.
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { READ_HELPER_NAMES, WRITE_HELPER_NAMES } from '@apackdev/sdk/database-console';
import { population } from '@apackdev/sdk/testing';

const PACKAGES = path.resolve(__dirname, '..', '..');
const OWNERS = { '@apackdev/ears': 'apack-ears', '@apackdev/sdk': 'apack-sdk', '@apackdev/host': 'apack-host' };

/** The names that are the operation, each with why */
const THE_OPERATION: Record<string, string> = {
  query: 'the operation itself (`Ears.query`, `TypedEars.query`)',
  Query: 'its type',
  QueryBuilder: 'what it returns',
  QueryExplanation: 'what its `explain()` answers: how the database ran it',
  QueryStage: 'one stage of its plan, in that explanation',
  TypedQuery: 'its type, checked against a pack\'s entities',
  untypedQuery: 'the bound engine\'s, unchecked',
  runQueryCode: 'runs console code that may only query',
  queryFields: 'a trigger\'s fields that the operation reads (`TriggerFacet`)',
};

function exportedEntries(): { entry: string; file: string }[] {
  return Object.entries(OWNERS).flatMap(([name, dir]) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGES, dir, 'package.json'), 'utf8'));
    return Object.entries<string | Record<string, string>>(manifest.exports ?? {}).flatMap(([sub, target]) => {
      const source = typeof target === 'string' ? target : target['@apackdev/source'] ?? target.default;
      return source?.endsWith('.ts') ? [{ entry: name + sub.slice(1), file: path.join(PACKAGES, dir, source) }] : [];
    });
  });
}

/**
 * Every exported name and exported type member whose name holds `query`, as `<entry>: <export>[.<member>]`, and
 * every such name at all — an engine operation is a member of `Ears` rather than an export of its own
 */
function scanExports(): { names: string[]; exported: Set<string> } {
  const entries = population('package exports', exportedEntries(), { atLeast: 3 });
  const program = ts.createProgram(entries.map((e) => e.file), {
    noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, customConditions: ['@apackdev/source'],
  });
  const checker = program.getTypeChecker();
  const names = new Set<string>();
  const exported = new Set<string>();
  for (const { entry, file } of entries) {
    const module = checker.getSymbolAtLocation(program.getSourceFile(file)!);
    if (!module) continue;
    for (const symbol of checker.getExportsOfModule(module)) {
      const name = symbol.getName();
      exported.add(name);
      if (/query/i.test(name)) names.add(`${entry}: ${name}`);
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const declaration = target.declarations?.[0];
      if (!declaration) continue;
      const type = target.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.TypeAlias)
        ? checker.getDeclaredTypeOfSymbol(target)
        : checker.getTypeOfSymbolAtLocation(target, declaration);
      for (const member of checker.getPropertiesOfType(type)) {
        exported.add(member.getName());
        if (/query/i.test(member.getName())) names.add(`${entry}: ${name}.${member.getName()}`);
      }
    }
  }
  return { names: [...names], exported };
}

let scanned: ReturnType<typeof scanExports> | undefined;
const scan = () => (scanned ??= scanExports());

describe('the word query', () => {
  it('names only the engine\'s read operation in what ears, the SDK and the host export', () => {
    const { names, exported } = scan();
    population('exported names', [...exported], { atLeast: 100 });
    // The operation is there to be found, so a scan that reads nothing cannot pass
    expect(names).toContain('@apackdev/ears: Ears.query');
    const other = names.filter((n) => !(n.split(/[:.]\s*/).at(-1)! in THE_OPERATION));
    expect(other).toEqual([]);
  });

  // Console code is unchecked, so a name may drop the `untyped` its export carries; it may not be another word
  it('gives console code the names the library exports, not a second set', () => {
    const { exported } = scan();
    const injected = population('console helpers', [...READ_HELPER_NAMES, ...WRITE_HELPER_NAMES], { atLeast: 8 });
    const untypedTwin = (name: string) => `untyped${name[0].toUpperCase()}${name.slice(1)}`;
    expect(injected.filter((name) => !exported.has(name) && !exported.has(untypedTwin(name)))).toEqual([]);
  });
});
