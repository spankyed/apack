import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type * as TS from 'typescript';
import { RESERVED_ATTRIBUTES, type FieldRule, type FieldType } from '@apackdev/ears';
import type { SurfaceInboxAudiences } from '../fe/surface.ts';

/** What a module exports under a name, as the TypeScript compiler resolves it */
export interface ModuleExport {
  /** The runtime value's kind; undefined when the name exports only a type (or a value through `export type`) */
  value?: 'object' | 'function' | 'class';
  /** Whether the name can be used as a type */
  type: boolean;
}

export interface ModuleExports {
  /** Whether this export resolves to a usable declared TypeScript type. */
  hasTypeExport(file: string, name: string): boolean;
  /**
   * What an entity shape (the type `name` that `file` declares) holds a created row to: the fields it requires — its
   * non-optional properties but the engine's own — which the engine refuses a created row without, as `create`'s
   * type does; whether it declares `shortCode`, which is the engine's to write and `#generated/ears` to type; and
   * every field it declares, which an index may name, with the database's type of each but the engine's own
   * (`types`): its TypeScript type mapped to one of elmdb's, and `any` where it maps to none, so a field is never held
   * more narrowly than its shape says
   */
  rowRulesOf(file: string, name: string): { required: string[]; declaresShortCode: boolean; fields: string[]; types: Record<string, FieldRule> };
  /** The export `name` of `file` (an absolute path the reader was created with); undefined when it has none */
  exportOf(file: string, name: string): ModuleExport | undefined;
  /**
   * The `type` literals of the events a system's contract says it sends its surface, read from the type `name` that
   * `file` declares (`apack.json`'s `features[].system.contract`) — its `outgoing`.
   *
   * A declared type, as the surface reader takes one. Reading a value's type instead is what made an annotation on
   * the system's default export (`: SystemEntry` rather than `satisfies`) silently drop every outgoing event, and
   * what left the reader unable to tell a broken install from a mistake, since a failed import reads as `any`.
   */
  outgoingEventTypesOf(file: string, name: string): string[];
  /** External incoming events from a declared system contract; excludes private child events. */
  incomingEventTypesOf(file: string, name: string): string[];

  /**
   * The `type` literals of the events a surface's contract says *other* surfaces may send it, read from the type
   * `name` that `file` declares (`apack.json`'s `features[].surface.contract`) — its `inbox`, across audiences.
   *
   * A contract with no `inbox` reads as `[]`: it publishes state only, and what its own feature's system sends it
   * is that system's outgoing union, which codegen adds. Throws when the module declares no such type, when the
   * inbox names an audience that doesn't exist, and on a member with no literal `type`, as the system reader does.
   *
   * It reads a *declared* type, never a value, which is what lets the contract live in a leaf module the surface's
   * machine doesn't reach: reading it off `fe/surface.ts` would pull in the machine, whose imports cycle back
   * through the generated events module this feeds.
   */
  inboxEventTypesOf(file: string, name: string): string[];
  /** Literal entity names in a surface contract's optional `opens` field; never evaluates its module. */
  openedEntityTypesOf(file: string, name: string): string[];

}

/**
 * The audiences a surface's inbox may open to, in the order an error lists them. Constrained by the type packs
 * write against (`SurfaceInboxAudiences`, `@apackdev/sdk/fe`), so a new audience there is a compile error here
 * rather than a contract codegen rejects as "not an audience".
 */
const INBOX_AUDIENCES = ['pack', 'public'] as const satisfies readonly (keyof SurfaceInboxAudiences)[];

function loadTypeScript(): typeof TS {
  try {
    return createRequire(import.meta.url)('typescript') as typeof TS;
  } catch (err) {
    if ((err as { code?: string }).code !== 'MODULE_NOT_FOUND') throw err;
    throw new Error('Generating pack entries reads module exports with the TypeScript compiler, and "typescript" is not installed. Install it next to @apackdev/sdk (npm install --save-dev typescript).');
  }
}

function compilerOptions(ts: typeof TS, packRoot: string): TS.CompilerOptions {
  const configPath = path.join(packRoot, 'tsconfig.json');
  if (!fs.existsSync(configPath)) {
    return { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true };
  }
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(`${configPath}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    },
  });
  if (!parsed) throw new Error(`${configPath} could not be read`);
  const errors = parsed.errors.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.code !== 18003);
  if (errors.length) throw new Error(`${configPath}: ${errors.map(diagnostic =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')).join('; ')}`);
  return parsed.options;
}

/**
 * Reads the exports of a pack's modules with one TypeScript program over `files` (and what they
 * import), under the pack's tsconfig and the conditions its code builds with. Re-exports, barrels
 * and `export type` resolve as the compiler resolves them.
 *
 * @internal Host-only: apack CLI build tooling.
 */
export function createModuleExports(packRoot: string, files: string[], sources: ReadonlyMap<string, string> = new Map()): ModuleExports {
  const ts = loadTypeScript();
  // Virtual bundled declarations take precedence over stale generated files on disk.
  const options = { ...compilerOptions(ts, packRoot), allowJs: true, types: [], noEmit: true };
  const host = ts.createCompilerHost(options);
  if (sources.size) {
    const canonical = (file: string) => ts.sys.useCaseSensitiveFileNames ? path.resolve(file) : path.resolve(file).toLowerCase();
    const virtualSources = new Map([...sources].map(([file, source]) => [canonical(file), source]));
    const directories = new Set<string>();
    for (const file of virtualSources.keys()) {
      for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        directories.add(dir);
        if (path.dirname(dir) === dir) break;
      }
    }
    const { getSourceFile, readFile, fileExists, directoryExists } = host;
    host.readFile = file => virtualSources.get(canonical(file)) ?? readFile(file);
    host.fileExists = file => virtualSources.has(canonical(file)) || fileExists(file);
    host.directoryExists = dir => directories.has(canonical(dir)) || directoryExists?.(dir) === true;
    host.getSourceFile = (file, version, onError, fresh) => {
      const source = virtualSources.get(canonical(file));
      return source === undefined ? getSourceFile(file, version, onError, fresh)
        : ts.createSourceFile(file, source, version, true);
    };
  }
  const program = ts.createProgram({ rootNames: files, options, host });
  const checker = program.getTypeChecker();

  /** The symbol `file` exports as `name`, before any alias is followed */
  function exportedSymbol(file: string, name: string): TS.Symbol | undefined {
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) throw new Error(`${file} is not part of the program reading pack exports`);
    const syntax = program.getSyntacticDiagnostics(sourceFile);
    if (syntax.length) throw new Error(`${path.basename(file)}: invalid TypeScript syntax: ${ts.flattenDiagnosticMessageText(syntax[0]!.messageText, '\n')}`);

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) return undefined;
    const exported = checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === name);
    if (exported || name !== 'default') return exported;
    // CommonJS default imports take module.exports itself; named ESM exports do not imply a default.
    const exportEquals = sourceFile.statements.some(statement => ts.isExportAssignment(statement) && statement.isExportEquals);
    const javascript = ['.js', '.jsx', '.cjs'].includes(path.extname(file));
    const esm = sourceFile.statements.some(statement => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
      || (ts.isExportAssignment(statement) && !statement.isExportEquals)
      || (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)));
    return exportEquals || (javascript && !esm) ? moduleSymbol : undefined;
  }

  /**
   * Follows `export { x } from` and import chains to the symbol that declares the name, noting a type-only link on
   * the way, or undefined when the chain doesn't resolve. A circular re-export (`a.ts` → `b.ts` → `a.ts`) ends the
   * walk rather than spinning: the checker reports that as an error, and this reader queries the checker without
   * reading its diagnostics. Every reader goes through here, so the bound is written once.
   */
  function followAliases(symbol: TS.Symbol): { symbol: TS.Symbol; typeOnly: boolean } | undefined {
    const seen = new Set<TS.Symbol>([symbol]);
    let current = symbol;
    let typeOnly = false;
    while (current.flags & ts.SymbolFlags.Alias) {
      if (current.declarations?.some((declaration) => ts.isTypeOnlyImportOrExportDeclaration(declaration))) typeOnly = true;
      const target = checker.getImmediateAliasedSymbol(current);
      if (!target || seen.has(target)) return undefined;
      seen.add(target);
      current = target;
    }
    return { symbol: current, typeOnly };
  }

  /**
   * The type a module *declares* under `name` — a type alias or an interface — following aliases, or undefined
   * when it declares none. This is what lets codegen read a contract, which has no runtime value to read from.
   *
   * A type that didn't resolve is refused here rather than at each call site: `any` has no properties, so every
   * reader below would otherwise answer "no events" for a contract whose import is missing.
   */
  function declaredTypeOf(file: string, name: string): TS.Type | undefined {
    const exported = exportedSymbol(file, name);
    const resolved = exported && followAliases(exported);
    if (!resolved || !(resolved.symbol.flags & ts.SymbolFlags.Type)) return undefined;
    const declared = checker.getDeclaredTypeOfSymbol(resolved.symbol);
    checkResolved(declared, file, name);
    return declared;
  }

  const ANY: FieldType = { type: 'any' };
  // Without strict null checks `null` is assignable to every type, so a shape's `| null` is erased and its fields say
  // nothing about `null`: each is held as nullable rather than refusing a write its own types allow
  const nullsChecked = program.getCompilerOptions().strictNullChecks ?? program.getCompilerOptions().strict ?? false;

  /**
   * The database's type of a value of `type`, and whether it may be `null`: `string`, `number` and `boolean` as
   * themselves (a string's template or literal, a number's literal and `true` or `false` widened to them), a union of
   * string literals as `enum`, an id tagged with its entity types (`EARS.EntityId<'T'>`) as `ref` to them, an array of
   * one of these as `list`, and anything else — an object, a record, `unknown`, `Date`, a mixed union, a type that
   * didn't resolve — as `any`. `undefined` is the optional property's, and `null` is `nullable`, as every field is in a
   * pack that doesn't check nulls
   */
  function fieldTypeOf(type: TS.Type): { field: FieldType; nullable: boolean } {
    const members = type.isUnion() ? type.types : [type];
    const nullable = !nullsChecked || members.some((member) => member.flags & ts.TypeFlags.Null);
    const values = members.filter((member) => !(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
    return { field: valuesType(values), nullable };
  }

  function valuesType(members: readonly TS.Type[]): FieldType {
    if (members.length === 0) return ANY;
    if (members.every((member) => member.flags & ts.TypeFlags.BooleanLiteral)) return { type: 'boolean' };
    if (members.length > 1 && members.every((member) => member.isStringLiteral())) {
      return { type: 'enum', values: [...new Set(members.map((member) => (member as TS.StringLiteralType).value))].sort() };
    }
    const refs = members.map(taggedIdTypes);
    if (refs.every((to) => to !== undefined)) return { type: 'ref', to: [...new Set(refs.flat())].sort() };
    if (members.length > 1) return ANY;
    const [member] = members as [TS.Type];
    if (member.flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) return { type: 'string' };
    if (member.isStringLiteral()) return { type: 'enum', values: [member.value] };
    if (member.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return { type: 'number' };
    if (member.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return { type: 'boolean' };
    if (checker.isArrayType(member)) {
      const [element] = checker.getTypeArguments(member as TS.TypeReference);
      if (!element) return { type: 'list', of: ANY };
      const { field, nullable } = fieldTypeOf(element);
      // A list's element is a value the list holds: one that may be null or absent is held as anything
      const optionalElement = element.isUnion() && element.types.some((t) => t.flags & ts.TypeFlags.Undefined);
      return { type: 'list', of: nullable || optionalElement ? ANY : field };
    }
    return ANY;
  }

  /**
   * The entity types an id is tagged with (`EARS.EntityId<'T'>`: a string's template beside an optional `__entity`
   * of those names), or undefined for any other type, an untagged id included
   */
  function taggedIdTypes(type: TS.Type): string[] | undefined {
    if (!type.isIntersection() || !type.types.some((part) => part.flags & ts.TypeFlags.TemplateLiteral)) return undefined;
    const tag = propertyType(type, '__entity');
    if (!tag) return undefined;
    const names = (tag.isUnion() ? tag.types : [tag]).filter((t) => !(t.flags & ts.TypeFlags.Undefined));
    if (names.length === 0 || !names.every((t) => t.isStringLiteral())) return undefined;
    return names.map((t) => (t as TS.StringLiteralType).value);
  }

  /** The type of property `name` of `type`, or undefined when it has none */
  function propertyType(type: TS.Type, name: string): TS.Type | undefined {
    const property = type.getProperty(name);
    const declaration = property && (property.valueDeclaration ?? property.declarations?.[0]);
    return property && (declaration ? checker.getTypeOfSymbolAtLocation(property, declaration) : checker.getTypeOfSymbol(property));
  }

  /**
   * Throws when part of a contract reads as `any` or `unknown` — what an import that didn't resolve leaves behind.
   *
   * Without this the readers below answer "no events" rather than failing: `getProperties()` on `any` is empty, so
   * a surface whose inbox didn't resolve publishes an inbox nothing may send to, and the pack builds. Where it did
   * fail, it failed as "this member's `type` is missing" or "declares no `outgoing`" — both of which point the
   * author at their own contract, and the second of which advises deleting the manifest entry that is correct.
   *
   * It doesn't say why the type didn't resolve, with one exception. A pack whose dependencies aren't installed
   * reads exactly like one with a misspelled import, which is why the code that claimed to tell them apart was
   * removed — but a module of the pack's own generated code is a cause neither of those words fits, and the only
   * one that can never come right by itself, so `generatedCause` names it.
   */
  function checkResolved(type: TS.Type, file: string, what: string): void {
    if (!(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) return;
    // `typeToString` prints the alias as written (`SurfaceInbox<{ pack: NotesInbox }>`), which reads as though it
    // resolved, so name what it collapsed to first and show the written form as corroboration
    const collapsed = type.flags & ts.TypeFlags.Any ? 'any' : 'unknown';
    throw new Error(`${path.basename(file)}: ${what} resolves to \`${collapsed}\` — written as \`${checker.typeToString(type)}\` — so a type it names didn't resolve: an uninstalled dependency, or a name its module doesn't export${generatedCause(file)}. Required type inspection cannot use an unresolved type`);
  }

  /**
   * The clause for the one cause the advice above cannot name: the module is the pack's own generated code, which
   * codegen writes *after* reading every contract. A contract may name `#generated/types` or `#generated/ears` for
   * the types its state and its events' payload fields use — nothing reads those, so they may be `any` while
   * codegen runs, as `default-setup`'s contracts are on a pack's first build. What is read is an event's `type`
   * literal and the union it sits in, and those cannot come from generated code at any point: the file does not
   * exist yet, the throw means it is never written, and the next run starts from the same tree. Without this the
   * author is sent to look for an uninstalled dependency.
   */
  function generatedCause(file: string): string {
    const source = program.getSourceFile(file);
    const generated = source?.statements.some((statement) => ts.isImportDeclaration(statement)
      && ts.isStringLiteralLike(statement.moduleSpecifier) && /^#generated\/|__generated__\//.test(statement.moduleSpecifier.text));
    return generated
      ? ", or — since this module imports the pack's own generated code — a generated module codegen has not written yet, which it cannot: it writes them after reading every contract, so the types it reads out of one may never come from them"
      : '';
  }

  return {
    hasTypeExport: (file, name) => declaredTypeOf(file, name) !== undefined,
    rowRulesOf(file, name) {
      const shape = declaredTypeOf(file, name);
      if (!shape) throw new Error(`${path.basename(file)} declares no type "${name}"`);
      const properties = checker.getPropertiesOfType(shape);
      const own = properties.filter((property) => !(RESERVED_ATTRIBUTES as readonly string[]).includes(property.name));
      const required = own
        .filter((property) => !(property.flags & ts.SymbolFlags.Optional))
        .map((property) => property.name)
        .sort();
      const types: Record<string, FieldRule> = {};
      for (const property of [...own].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        const type = declaration ? checker.getTypeOfSymbolAtLocation(property, declaration) : checker.getTypeOfSymbol(property);
        const { field, nullable } = fieldTypeOf(type);
        types[property.name] = {
          ...field,
          ...(property.flags & ts.SymbolFlags.Optional ? { optional: true } : {}),
          ...(nullable ? { nullable: true } : {}),
        };
      }
      return { required, declaresShortCode: shape.getProperty('shortCode') !== undefined, fields: properties.map((property) => property.name), types };
    },
    exportOf(file, name) {
      const exported = exportedSymbol(file, name);
      const resolved = exported && followAliases(exported);
      if (!resolved) return undefined;
      const { symbol, typeOnly } = resolved;

      const type = (symbol.flags & ts.SymbolFlags.Type) !== 0;
      if (typeOnly || !(symbol.flags & ts.SymbolFlags.Value)) return { type };
      if (symbol.flags & ts.SymbolFlags.Class) return { value: 'class', type };
      const callable = symbol.flags & ts.SymbolFlags.Function || checker.getTypeOfSymbol(symbol).getCallSignatures().length > 0;
      return { value: callable ? 'function' : 'object', type };
    },

    openedEntityTypesOf(file, name) {
      const contract = declaredTypeOf(file, name);
      if (!contract) throw new Error(`${path.basename(file)}: it declares no type "${name}"`);
      const opens = propertyType(contract, 'opens');
      if (!opens) return [];
      checkResolved(opens, file, `${name}'s opens`);
      const members = opens.isUnion() ? opens.types : [opens];
      if (contract.getProperty('opens')!.flags & ts.SymbolFlags.Optional
        || members.some(member => !member.isStringLiteral() || !member.value.trim())) {
        throw new Error(`${path.basename(file)}: ${name}.opens must name one or more literal entity types`);
      }
      return [...new Set(members.flatMap(member => member.isStringLiteral() ? [member.value] : []))].sort();
    },
    incomingEventTypesOf(file, name) {
      const contract = declaredTypeOf(file, name);
      if (!contract) throw new Error(`${path.basename(file)}: it declares no type "${name}"`);
      const incoming = propertyType(contract, 'incoming');
      if (!incoming) return [];
      checkResolved(incoming, file, `${name}'s incoming events`);
      return eventTypeLiterals(incoming, file, "its system's incoming events");
    },
    outgoingEventTypesOf(file, name) {
      const contract = declaredTypeOf(file, name);
      if (!contract) {
        throw new Error(`${path.basename(file)}: it declares no type "${name}". A system's contract is a declared type — \`export type ${name} = { context?: …; incoming?: …; internal?: …; outgoing: … }\` — named in apack.json at features[].system.contract`);
      }
      const declared = propertyType(contract, 'outgoing');
      if (!declared) {
        throw new Error(`${path.basename(file)}: ${name} declares no \`outgoing\` events. A system with none omits features[].system.contract rather than declaring an empty one`);
      }
      checkResolved(declared, file, `${name}'s \`outgoing\` events`);
      return eventTypeLiterals(declared, file, "its system's outgoing events");
    },
    inboxEventTypesOf(file, name) {
      const contract = declaredTypeOf(file, name);
      if (!contract) {
        throw new Error(`${path.basename(file)}: it declares no type "${name}". A surface's contract is a declared type — \`export type ${name} = { state: …; inbox: … }\` — named in apack.json at features[].surface.contract`);
      }
      const inbox = propertyType(contract, 'inbox');
      // A contract may publish state alone; its own system's events still reach it
      if (!inbox) return [];
      checkResolved(inbox, file, `${name}'s inbox`);
      const audiences = inbox.getProperties();
      const unknown = audiences.filter((audience) => !(INBOX_AUDIENCES as readonly string[]).includes(audience.name));
      if (unknown.length > 0) {
        throw new Error(`${path.basename(file)}: ${name}'s inbox names ${unknown.map((a) => `"${a.name}"`).join(', ')}, which ${unknown.length > 1 ? 'are not audiences' : 'is not an audience'}: an inbox opens to ${INBOX_AUDIENCES.map((a) => `\`${a}\``).join(' or ')}. Declaring it with \`SurfaceInbox<…>\` would have caught this at the declaration`);
      }
      return audiences.flatMap((audience) => {
        const declared = propertyType(inbox, audience.name);
        const events = declared ? eventTypeLiterals(declared, file, `the events it accepts from \`${audience.name}\``) : [];
        // The same refusal `outgoing` gets above, which the inbox went without: a declared audience that accepts
        // nothing published an audience nothing may send to, and the pack built. `SurfaceInbox<{ public: never }>`
        // is the shape, and it need not arrive as a literal `never` — any type that resolves to one does, which is
        // how a contract reaching another surface's absent inbox reads.
        //
        // At the audience level, not below it: an **absent** `inbox` is legitimate and returns early above, and
        // `never` as one member of a union stays "no events" in `eventTypeLiterals`, which is what lets a first
        // build carry on while `#generated/` is unresolved. What is refused is only an audience someone wrote down
        // and left empty.
        if (events.length === 0) {
          throw new Error(`${path.basename(file)}: ${name}'s inbox declares \`${audience.name}\` and it accepts no events. `
            + 'An audience with none is left out rather than declared empty, and a surface that accepts nothing from '
            + "anyone omits `inbox` altogether — its own system's outgoing events still reach it");
        }
        return events;
      });
    },
  };

  /**
   * The `type` literals of a contract's event union; `never` is none, and a lone event is its own type.
   *
   * `file` is the module's path, not its name: `checkResolved` reads its imports to say why a type collapsed.
   */
  function eventTypeLiterals(declared: TS.Type, file: string, what: string): string[] {
    if (declared.flags & ts.TypeFlags.Never) return [];
    const members = declared.isUnion() ? declared.types : [declared];
    return members.flatMap((member) => {
      checkResolved(member, file, what);
      const declaredType = propertyType(member, 'type');
      // `{ type: 'A' | 'B' }` is one member covering two event types, which is a legal way to write
      // an event whose payload is the same either way. Reading only single literals rejected it, so
      // the union is expanded here and every constituent still has to be a literal.
      const literals = declaredType?.isUnion() ? declaredType.types : declaredType ? [declaredType] : [];
      if (literals.length === 0 || !literals.every((t) => t.isStringLiteral())) {
        throw new Error(`${path.basename(file)}: ${what} have a member whose \`type\` is ${declaredType ? checker.typeToString(declaredType) : 'missing'}, not a string literal or a union of them: the event maps are read from these, and a member without one would leave them short`);
      }
      return literals.map((t) => (t as TS.StringLiteralType).value);
    });
  }
}
