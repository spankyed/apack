// `declaredTypeOf` is what lets a surface's contract be a type rather than a value carrying phantom properties.
// The reader it sits beside, `exportedValueType`, resolves values only, and reading that way is what forced the
// contract into `fe/surface.ts` — whose machine imports cycle back through the generated events module.
//
// These cover the three answers it has to give, through the public reader that uses it, and where it refuses.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createModuleExports, type ModuleExports } from '../src/module-exports.ts';

/**
 * Every module this spec reads, in one pack root under one TypeScript program.
 *
 * One program, not one per case: nearly all of a program's cost is the compiler's own startup — a lib load each
 * time — so a fixture per case was 2.8s of startup against about a fifth of a second for one program over all of
 * them. Each fixture is still its own module, so nothing here shares a scope with anything else, and the four that
 * import `@not/installed` are unaffected by the sharing: the reader queries the checker and never reads its
 * diagnostics, so an unresolved import in one module is invisible to the rest.
 *
 * `__generated__/` is deliberately absent, which is what a pack's own tree looks like before codegen has run once.
 */
const FIXTURES = {
  'opens-alias.ts': "type Opened = 'Note' | 'Action'; export type Contract = { opens: Opened }; throw new Error('Do not execute');",
  'opens-interface.ts': "interface Base { opens: 'Note' }; export interface Contract extends Base {}",
  'opens-reexport.ts': "export type { Contract } from './opens-interface.ts';",
  'opens-string.ts': 'export type Contract = { opens: string };',
  'opens-empty.ts': "export type Contract = { opens: '' };",
  'opens-never.ts': 'export type Contract = { opens: never };',
  'opens-unknown.ts': 'export type Contract = { opens: unknown };',
  'opens-optional.ts': "export type Contract = { opens?: 'Note' };",
  'opens-missing.ts': "import type { Missing } from './absent.ts'; export type Contract = { opens: Missing };",

  'unresolved-contract.ts': "import type { Theirs } from '@not/installed';\nexport type Contract = Theirs;\n",
  'unresolved-inbox.ts': "import type { Theirs } from '@not/installed';\nexport type Contract = { state: {}; inbox: Theirs };\n",
  'unresolved-audience.ts': "import type { Theirs } from '@not/installed';\nexport type Contract = { state: {}; inbox: { public: Theirs } };\n",
  'resolves.ts': "export type Contract = { state: {}; inbox: { public: { type: 'A' } } };\n",
  // The collapse a hop away: the contract's own text is fine and the module it names is the one that cannot resolve
  'hopped.ts': "import type { Ev } from './hop.ts';\nexport type Contract = { state: {}; inbox: { public: Ev } };\n",
  'hop.ts': "import type { PackSurfaceEvents } from './__generated__/events.ts';\nexport type Ev = PackSurfaceEvents;\n",
  // An event union that comes from the pack's own generated code: the one cause the advice cannot name
  'generated-inbox.ts': "import type { I } from '#generated/types.ts';\nexport type Contract = { state: {}; inbox: { pack: I } };\n",
  // The same collapse in the two positions no reader reads
  'collapsed-state.ts': "import type { Category } from './__generated__/types.ts';\nexport type Contract = { state: Category; inbox: { public: { type: 'A' } } };\n",
  'collapsed-payload.ts': "import type { Category } from './__generated__/types.ts';\nexport type Contract = { state: {}; inbox: { public: { type: 'A'; category: Category } } };\n",
  'alias.ts': "export type Contract = { state: { ready: boolean }; inbox: { public: { type: 'NOTE.OPEN'; noteId: string } } };\n",
  'interface.ts': "export interface Contract { state: { ready: boolean }; inbox: { public: { type: 'NOTE.OPEN'; noteId: string } } }\n",
  're-export.ts': "export type { Contract } from './re-exported.ts';\n",
  're-exported.ts': "export type Contract = { state: {}; inbox: { pack: { type: 'A' } } };\n",
  'other-type.ts': 'export type Other = { state: {} };\n',
  'value-only.ts': 'export const Contract = { state: {} };\n',
  'state-only.ts': 'export type Contract = { state: { ready: boolean } };\n',
  'two-audiences.ts': "export type Contract = { state: {}; inbox: { pack: { type: 'A' }; public: { type: 'B' } | { type: 'C' } } };\n",
  'bad-audience.ts': "export type Contract = { state: {}; inbox: { publik: { type: 'A' } } };\n",
} as const;

let root: string;
let read: ModuleExports;

// In `beforeAll` rather than at module scope: built during collection, the compiler's cost would land outside the
// per-file duration `spec-cost` records, and the record would understate this file rather than report the saving
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-declared-type-'));
  for (const [name, source] of Object.entries(FIXTURES)) fs.writeFileSync(path.join(root, name), source);
  read = createModuleExports(root, Object.keys(FIXTURES).map((name) => path.join(root, name)));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** The fixture a case is about. Keyed by the map, so a case cannot name a module that was never written */
const at = (name: keyof typeof FIXTURES) => path.join(root, name);

/**
 * A type that didn't resolve is `any`, and `any` has no properties — so every reader here would answer "no events"
 * for a contract whose import is missing, and the pack would build with an inbox nothing may send to. These are the
 * six shapes that reach the readers, since the failure is silent in two of them and misleading in the rest.
 */
describe('a contract whose type did not resolve', () => {
  const unresolved = /resolves to `any`.*didn't resolve: an uninstalled dependency, or a name its module doesn't export/;

  it('refuses a contract that is itself unresolved, rather than reading no inbox', () => {
    expect(() => read.inboxEventTypesOf(at('unresolved-contract.ts'), 'Contract')).toThrow(unresolved);
  });

  // This one used to say the contract "declares no `outgoing` events", advising the author to delete the manifest
  // entry that was right
  it("refuses an unresolved contract on the system's side too", () => {
    expect(() => read.outgoingEventTypesOf(at('unresolved-contract.ts'), 'Contract')).toThrow(unresolved);
  });

  it('refuses an unresolved inbox, rather than reading it as no audiences', () => {
    expect(() => read.inboxEventTypesOf(at('unresolved-inbox.ts'), 'Contract')).toThrow(unresolved);
  });

  // This threw already, but as "a member whose `type` is missing" — the author's own union looked malformed
  it('names the unresolved type when one audience of the inbox is the one that did not resolve', () => {
    expect(() => read.inboxEventTypesOf(at('unresolved-audience.ts'), 'Contract')).toThrow(unresolved);
  });

  /**
   * The route codegen actually takes on a cold tree: the contract names a local module, and *that* module is the one
   * importing something absent. Aliases are followed to their declaration, so the collapse arrives at the audience
   * and the member check refuses it — the four cases above are all direct imports, and none of them proves this.
   *
   * What the author is told names the contract and not the hop, since a collapsed type carries no provenance: the
   * reader says which member of which contract came back `any`, deliberately not why. Fixing that would mean reading
   * the program's diagnostics, and the code that tried to tell "uninstalled" from "misspelled" apart was removed.
   */
  it('refuses a collapse that arrives through a module the contract imports', () => {
    expect(() => read.inboxEventTypesOf(at('hopped.ts'), 'Contract')).toThrow(unresolved);
  });

  /**
   * The one cause the message can name, because it is the one that never comes right on its own: the type came from
   * the pack's own generated code, which codegen writes *after* reading every contract — so the module is absent,
   * the throw means it is never written, and the next run starts from the same tree. Measured: `generatePackFiles`
   * over a pack shaped like this throws on every attempt and leaves no `src/__generated__` behind.
   *
   * The fixture declares no `imports` map, which is beside the point: the clause is about the spelling a contract
   * used, and the module it names is absent either way.
   */
  it('names the pack\'s own generated code as the cause when the contract imported some', () => {
    expect(() => read.inboxEventTypesOf(at('generated-inbox.ts'), 'Contract'))
      .toThrow(/imports the pack's own generated code.*writes them after reading every contract/);
  });

  it('still reads a contract that resolves', () => {
    expect(read.inboxEventTypesOf(at('resolves.ts'), 'Contract')).toEqual(['A']);
  });
});

/**
 * The other half of the same fact, and not a hole in the one above: `checkResolved` guards the four positions a
 * reader reads — the contract, `outgoing`, `inbox`, and each member of an event union — and a collapse anywhere
 * else is read as data.
 *
 * That is what makes a cold build possible rather than an oversight. `src/__generated__/` is untracked and
 * `generatePackFiles` computes every generated file before its caller writes any of them, so on a pack's first
 * build nothing under `#generated/` resolves: `actions/fe/contract.ts` has `categories: Category` from
 * `#generated/types.ts` in its state and `actionId: EARS.EntityId` in its events, both `any` at that moment, and
 * codegen is right to carry on — it needs each member's literal `type` and nothing more. Refusing these would make
 * the first build of a fresh checkout impossible.
 *
 * So what keeps a contract's *shape* honest is not this reader but `findContractLeafImports`
 * (`scripts/check-import-specifiers.ts`), which is why that rule is not redundant with the refusals above.
 */
describe('a collapse in a position no reader reads', () => {
  it('reads the inbox of a contract whose state did not resolve', () => {
    expect(read.inboxEventTypesOf(at('collapsed-state.ts'), 'Contract')).toEqual(['A']);
  });

  it("reads an event whose payload field did not resolve, the member's own `type` being what it needs", () => {
    expect(read.inboxEventTypesOf(at('collapsed-payload.ts'), 'Contract')).toEqual(['A']);
  });
});

describe('declaredTypeOf, through inboxEventTypesOf', () => {
  it('reads a contract declared as a type alias', () => {
    expect(read.inboxEventTypesOf(at('alias.ts'), 'Contract')).toEqual(['NOTE.OPEN']);
  });

  it('reads a contract declared as an interface', () => {
    expect(read.inboxEventTypesOf(at('interface.ts'), 'Contract')).toEqual(['NOTE.OPEN']);
  });

  it('follows a re-export to the module that declares it', () => {
    expect(read.inboxEventTypesOf(at('re-export.ts'), 'Contract')).toEqual(['A']);
  });

  it('names the type it looked for when the module declares none', () => {
    expect(() => read.inboxEventTypesOf(at('other-type.ts'), 'Contract')).toThrow(/declares no type "Contract"/);
  });

  // The counterpart of the old reader's failure: a value has no declared type to read
  it('names the type it looked for when the export is only a value', () => {
    expect(() => read.inboxEventTypesOf(at('value-only.ts'), 'Contract')).toThrow(/declares no type "Contract"/);
  });

  it('reads a contract that publishes state and opens no inbox as taking nothing', () => {
    expect(read.inboxEventTypesOf(at('state-only.ts'), 'Contract')).toEqual([]);
  });

  it('collects every audience the inbox opens', () => {
    expect(read.inboxEventTypesOf(at('two-audiences.ts'), 'Contract').sort()).toEqual(['A', 'B', 'C']);
  });

  it('refuses an audience that does not exist, rather than silently declaring nothing', () => {
    expect(() => read.inboxEventTypesOf(at('bad-audience.ts'), 'Contract')).toThrow(/"publik".*is not an audience/s);
  });
});


it('resolves virtual declaration re-exports without creating their directories', () => {
  const dir = path.join(root, 'virtual', 'declarations');
  const entry = path.join(dir, 'facade.ts');
  const shapes = path.join(dir, 'shapes.ts');
  const reader = createModuleExports(root, [entry, shapes], new Map([
    [entry, "export type { Shape as PackEntityShapes } from './shapes.ts';"],
    [shapes, 'export interface Shape { label: string }'],
  ]));
  expect(reader.hasTypeExport(entry, 'PackEntityShapes')).toBe(true);
  expect(fs.existsSync(dir)).toBe(false);
});


describe('surface entity destination types', () => {
  it('reads literal aliases, inherited interfaces and re-exports without executing modules', () => {
    expect(read.openedEntityTypesOf(at('opens-alias.ts'), 'Contract')).toEqual(['Action', 'Note']);
    expect(read.openedEntityTypesOf(at('opens-interface.ts'), 'Contract')).toEqual(['Note']);
    expect(read.openedEntityTypesOf(at('opens-reexport.ts'), 'Contract')).toEqual(['Note']);
    expect(read.openedEntityTypesOf(at('state-only.ts'), 'Contract')).toEqual([]);
  });
  it.each(['opens-string.ts', 'opens-empty.ts', 'opens-never.ts', 'opens-unknown.ts', 'opens-optional.ts', 'opens-missing.ts'] as const)(
    'refuses an indeterminate destination: %s', name => {
      expect(() => read.openedEntityTypesOf(at(name), 'Contract')).toThrow(/literal entity types|resolves to/);
    },
  );
});
