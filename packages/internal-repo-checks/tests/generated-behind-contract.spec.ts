// `GENERATED_BEHIND_A_CONTRACT` (check-import-specifiers.ts) names the generated modules a contract leaf's closure
// may not reach. It is a list restating a property of codegen's output, and a list of someone else's inputs is a
// guess: it was measured by hand once, and the next generated module to import a contract would be missing from it
// while the rule it guards reported nothing.
//
// So this derives the property from codegen instead of restating it again. `generatePackFiles` returns
// filename -> contents and writes nothing, so a fixture manifest plus the files codegen *reads* is the whole cost.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generatePackFiles, type PackManifest } from '@apackdev/sdk/build';
import { GENERATED_BEHIND_A_CONTRACT } from '../../../scripts/check-import-specifiers.ts';

/**
 * Every module codegen can emit under `src/__generated__/`, which is the population the rule classifies. Recorded
 * rather than derived, and it is the *other* half of the check: a twenty-first module fails this by name until
 * someone decides whether a contract is behind it. Deriving it from the same call it is compared against would
 * assert nothing.
 */
const GENERATED_MODULES = [
  'appliers', 'content-runtime', 'ears', 'events', 'fe', 'flow-helpers', 'pack-entry', 'pack-entry-fe', 'pack-types',
  'paths', 'ref', 'references', 'repositories', 'repository', 'runtime-services', 'services', 'settings', 'settings-fe',
  'step-types', 'steps-build', 'system-specs', 'types',
];

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'behind-contract-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

const CONTRACTS = ['src/features/memos/be/contract.ts', 'src/features/memos/fe/contract.ts'] as const;
const ENTRIES = ['src/features/memos/be/system.ts', 'src/features/memos/fe/surface.ts'] as const;

/**
 * A pack that makes codegen emit **all** of `GENERATED_MODULES`. A minimal one-feature manifest emits fifteen, and
 * a module the fixture does not emit is a module this check never looks at — so the three conditional ones are
 * bought deliberately: `repositories` by a declared repository, `step-types` by a step with a declared types module, `steps-build` by any declared step.
 *
 * The contracts are plain declared types with no imports, which is all codegen reads them as — the temp dir has no
 * `node_modules` for an import to resolve against.
 */
function fixture(): PackManifest {
  write(CONTRACTS[0]!, "export type Contract = { incoming: { type: 'NOTES_RUN' }; outgoing: { type: 'NOTES_CONNECTED' } };\n");
  write(CONTRACTS[1]!, "export type Contract = { state: { ready: boolean }; inbox: { public: { type: 'NOTE.OPEN' } } };\n");
  write(ENTRIES[0]!, 'export default { spec: undefined as never, machine: undefined as never };\n');
  write(ENTRIES[1]!, 'declare const surface: { label: string };\nexport default surface;\n');
  write('src/features/memos/be/repository/index.ts', 'export const memoQueries = { all: () => [] };\n');
  write('src/extensions/steps/tick/types.ts', "export type TickNode = { every: string };\n");
  write('src/defs/action.ts', 'export interface NoteDTO { text: string }');
  write('src/extensions/steps/tick/build.ts', "export function compile() { return {}; } export function decompile() { return {}; }\n");
  return {
    id: 'demo-pack',
    name: 'Demo',
    version: '1.0.0',
    features: {
      memos: {
        description: 'Manage memos.',
        system: { entry: ENTRIES[0], contract: `${CONTRACTS[0]}#Contract` },
        surface: { label: 'Fixture', state: ENTRIES[1], contract: `${CONTRACTS[1]}#Contract` },
        repositories: { memoQueries: 'src/features/memos/be/repository/index.ts#memoQueries' },
      },
    },
    extensions: {
      steps: { tick: { node: { label: 'Tick' }, types: 'src/extensions/steps/tick/types.ts', kind: 'trigger', trigger: { trackField: 'every', compile: 'src/extensions/steps/tick/build.ts#compile', decompile: 'src/extensions/steps/tick/build.ts#decompile' } } },
      dsl: { action: { entry: 'src/defs/action.ts', prefix: '@', targets: ['monaco'], globals: { memos: 'NoteDTO' } } },
    },
  };
}

/** The generated modules, by the basename the rule classifies them under */
async function generated(): Promise<Map<string, string>> {
  const files = await generatePackFiles(fixture(), { packRoot: root });
  return new Map(Object.entries(files)
    .filter(([file]) => /^src\/__generated__\/[^/]+\.ts$/.test(file))
    .map(([file, contents]) => [path.basename(file, '.ts'), contents]));
}

/**
 * The specifiers codegen wrote, from TypeScript's own scanner rather than a text match. Generated modules carry
 * comments that name the very paths this is looking for — `system-specs.ts` explains that it imports the contracts
 * and not the system modules — so a regex would read the explanation as an import.
 */
function specifiersOf(contents: string): string[] {
  return ts.preProcessFile(contents, true, true).importedFiles.map(({ fileName }) => fileName);
}

/**
 * How a manifest path reaches a generated module's import: `toImportPath` strips `src/` and prefixes `../`, since
 * the generated files sit in `src/__generated__/`, and keeps an extension the author wrote. Every path in the
 * fixture is spelled with `.ts` so this mirrors one branch rather than re-implementing the probing one.
 */
const asSpecifier = (manifestPath: string) => `../${manifestPath.replace(/^src\//, '')}`;

describe('the generated modules a contract is behind', () => {
  it('is the whole set codegen emits, so a new one has to be classified', async () => {
    const emitted = [...(await generated()).keys()].sort();
    expect(emitted).toEqual([...GENERATED_MODULES].sort());
  });

  it('is exactly the modules that import a contract or an actor entry', async () => {
    const behind = [...(await generated())]
      .filter(([, contents]) => {
        const specifiers = new Set(specifiersOf(contents));
        return [...CONTRACTS, ...ENTRIES].some((declared) => specifiers.has(asSpecifier(declared)));
      })
      .map(([name]) => name);
    expect(behind.sort()).toEqual([...GENERATED_BEHIND_A_CONTRACT].sort());
  });

  // The fixture is the subject of both cases above, so a fixture that stopped producing one would make them pass by
  // looking at nothing: `events` reads a contract and `pack-entry` an entry, one for each half of the claim.
  it('reads a fixture that really does reach both', async () => {
    const modules = await generated();
    expect(specifiersOf(modules.get('events') ?? '')).toContain(asSpecifier(CONTRACTS[1]!));
    expect(specifiersOf(modules.get('pack-entry') ?? '')).toContain(asSpecifier(ENTRIES[0]!));
  });
});
