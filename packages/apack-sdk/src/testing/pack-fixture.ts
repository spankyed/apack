import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * One feature, both halves, each naming an entry and a contract — which is what makes a rule about contracts
 * able to fire. Which module is a contract is what `apack.json` says, not what a file looks like, so a fixture
 * without a manifest is one several pack rules cannot speak about at all.
 *
 * **The feature id is deliberately not one `@app/default-setup` has.** It was `notes`, which that pack really
 * ships, so `src/features/notes/` named a fixture's invention and a real feature at once — in a grep, in a
 * failure message, and in a spec that writes a path meant to read as the real pack's (`findRepositoryCasts`
 * does, a few hundred lines into `import-specifiers.integration.spec.ts`). Keep it a name no pack takes.
 */
const DEFAULT_MANIFEST = {
  id: 'demo-pack', name: 'Demo', version: '1.0.0',
  features: {
    memos: {
      description: 'Manage fixture memos.',
      surface: { label: 'Memos', state: 'src/features/memos/fe/state.ts', contract: 'src/features/memos/fe/contract.ts#Contract' },
      system: { entry: 'src/features/memos/be/system.ts', contract: 'src/features/memos/be/contract.ts#Contract' },
    },
  },
};

/**
 * The entity type a fixture's content format writes, which the fixture declares itself (`data: FIXTURE_DATA`):
 * a spec about building content names its own type rather than borrowing one the SDK declares, so a change to the
 * SDK's entities never reaches it
 */
export const FIXTURE_ENTITY = 'Row';

/** The `data` a fixture writing content declares: its one entity type, with no shape */
export const FIXTURE_DATA = { entities: { [FIXTURE_ENTITY]: {} } };

export interface PackFixtureOptions {
  /** Where to write it. A fresh temp directory by default, which the caller owns and removes. */
  readonly at?: string;
  /** Written over the base, keyed by path relative to the pack: the offending module a case is about. */
  readonly files?: Record<string, string>;
  /**
   * Merged over the default manifest, one key deep — `{ id: 'other' }` keeps the feature the default
   * declares, and `{ dependencies: {…} }` adds one without restating the rest.
   *
   * **Merge rather than replace, because that is what the call sites want.** Surveyed 2026-10-02 over the 54
   * manifest-writing sites in the two packages that may import this: 23 of the 28 written inline are the
   * minimum plus at most one key — `{ id, name, version }`, sometimes with `features`, `dependencies`,
   * `entities` or `hostVersion`. Replacing meant each of those restated a whole manifest, which is how they came
   * to differ from each other in ways no case was about.
   */
  readonly manifest?: Record<string, unknown>;
  /**
   * Symlinked as the pack's `node_modules`, which is what makes `@apackdev/*` resolve from inside the fixture —
   * every spec that builds or bundles one needs it.
   *
   * Here because it repeated: four specs wrote the same `mkdtemp` + manifest + `symlinkSync(REPO_ROOT/
   * node_modules)` preamble (`host-import-guard`, `fe-bundler-proxy-exports`, `fe-bundler-shared-ui`,
   * `content-runtime-load`), and `preparePack` is that pair with a name. A spec that only reads the tree passes
   * nothing and gets no symlink.
   */
  readonly nodeModules?: string;
  /**
   * Written verbatim, for a case whose subject *is* the manifest: one the installer must reject, one missing
   * a required key, one that is not an object. Five of the 28 are this.
   *
   * Separate from `manifest` rather than a mode on it, because a merge cannot express a *missing* key and a
   * reader should not have to work out which of two meanings applies. Passing both is refused.
   */
  readonly rawManifest?: unknown;
}

/**
 * A pack on disk, complete by default: both subpath maps, a manifest declaring a feature's two halves, and the
 * files those paths name.
 *
 * **It is a helper, and the preamble is what it saves.** Eleven specs wrote some version of `mkdtemp`, a
 * manifest, a `package.json` and a symlinked `node_modules` before getting to what they were about, and four
 * of them wrote that symlink identically. Complete *by default* is a convenience on top: a case that adds one
 * offending file gets a tree where every rule can speak, so it does not have to think about which parts of a
 * pack a rule needs.
 *
 * **It is not what catches a fixture too thin for a rule to fire** — that reading of it is how a mandate gets
 * built on top, and one was. `import-specifiers.integration.spec.ts` asserts per rule that it *found something
 * in a tree written to offend it*, so a rule that cannot fire fails loudly, naming itself, whatever wrote the
 * tree. That assertion landed in `1ee9b5a4c` on 2026-09-27, five days before this fixture existed, and it is
 * the mechanism. A check sweeping every spec for hand-written manifests was a second record of the same fact
 * and is deleted (`487a8c115`); if a thin fixture is ever the worry again, the answer is an assertion in the
 * spec that would be wrong, not a rule about how other specs write files.
 *
 * **It sits in a published package and is unreachable from outside it**, as `@apackdev/sdk/testing/pack-fixture`:
 * an entry whose only branch is `@apackdev/source`, which `publishedManifest` drops from the published manifest
 * outright. So nothing can resolve the specifier — not a consumer of the tarball, which has no such entry, and
 * not a pack, whose config may not declare that condition (`check:specifiers`). It appears in no `etc/*.api.md`
 * either, so `api:check` does not review it. `./runtime/internals` is the same shape.
 *
 * **What that shape does not buy, measured rather than assumed, because the first draft claimed otherwise.**
 * The compiled file *ships*: `files` is `["dist", …]`, and `publish/dist/testing/pack-fixture.{js,d.ts}` are in
 * the staged tree, as `runtime/internals`' are — dropping the entry hides it, it does not leave it out.
 * Deliberately not exported from `testing/index.ts`, which is published.
 *
 * **The condition that would make it public API: a published pack-reading API.** Today every consumer of a pack
 * directory is private — the pack rules and the source parser are `@apackdev/cli`'s, which publishes no
 * declarations, and the layout, subpath-imports and own-module-specifier readers are the private
 * `@apackdev/host`'s. A fixture for tooling nobody outside can import has no user outside, and a pack author
 * tests their own pack, which is already a directory (`PACK_DIR`), or their pack's code through
 * `setupPackTests`, which takes a registration rather than a tree. Publish any of that pack-reading surface and
 * this should go public in the same change; until then publishing it would fix the default manifest's shape,
 * the `manifest`/`rawManifest` split and these stub files as contract — and the default is chosen to make
 * *this repo's* pack rules fire, which is the wrong promise to make to anyone else.
 *
 * **It makes a pack's *source* tree and stops there.** Building one is `buildPack(dir)` and installing one is
 * the installer's own helper: composition, not options, because both already take a directory. A `built: true`
 * option was considered and dropped for that reason — it would own a second way to call something that works.
 * The *installed* shape (a manifest beside `integrity.json`, a snapshot and `dist/runtime`) is a different
 * build whose layout `@apackdev/host` owns (`PACK_LAYOUT`), and host's own tests build it in host, where the
 * layer rule keeps it.
 */
export function packFixture({ at, files = {}, manifest, rawManifest, nodeModules }: PackFixtureOptions = {}): string {
  if (manifest !== undefined && rawManifest !== undefined) {
    throw new Error('packFixture: pass `manifest` to vary the default or `rawManifest` to write one verbatim, not both');
  }
  const written = rawManifest !== undefined ? rawManifest : { ...DEFAULT_MANIFEST, ...manifest };
  const dir = at ?? fs.mkdtempSync(path.join(os.tmpdir(), 'apack-pack-fixture-'));
  const base: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'demo-pack', type: 'module',
      imports: { '#generated/*': './src/__generated__/*', '#features/*': './src/features/*' },
    }),
    'apack.json': JSON.stringify(written),
    'src/__generated__/events.ts': 'export const tell = 1;\n',
    'src/sibling.ts': 'export const sibling = 1;\n',
    'src/features/memos/fe/state.ts': 'export default {}; export type P = { id: string };\n',
    'src/features/memos/be/system.ts': 'export const system = 1;\n',
    'src/features/memos/fe/contract.ts': 'export type Contract = { state: {} };\n',
    'src/features/memos/be/contract.ts': "export type Contract = { outgoing: { type: 'A' } };\n",
  };
  for (const [rel, body] of Object.entries({ ...base, ...files })) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  if (nodeModules !== undefined) fs.symlinkSync(nodeModules, path.join(dir, 'node_modules'), 'dir');
  return dir;
}
