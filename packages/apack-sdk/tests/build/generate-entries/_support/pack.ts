import { _declarationRevision } from '../../../../src/build/declaration-revision.ts';
/**
 * The fixture every `generate-entries` spec shares: a temp pack root per case, and the helpers that write
 * manifests, dependencies and entries into it.
 *
 * **Why five files, and what splitting them did not buy.** They were one 1,365-line file of 96 cases across
 * 23 describes. The split is for that — five files named for what they cover — and **not** for speed, which
 * was measured and did not move:
 *
 *     floor (slowest single file)   18.3s -> 6.6s
 *     this file's own set           14.6s -> 4.0s   (five files, in parallel)
 *     worst `npm run spec` loop     23.6s -> 22.6s  (median of 3 before, 76% idle; after is one run)
 *     `test:unit:host --all`        28.3s -> 29.0s  (median of 3 after, 73% idle)
 *
 * **`goal-one-job-pool.md` Phase 5 asked for this split, tried it and reverted on exactly that result** —
 * *"a number that did not move is a result"*. Its stated test was whether the floor binds, and this was
 * re-derived as floor-bound (18.3s against a `work/cores` of 8.7s) before the work started. That
 * re-derivation was wrong, and the reason is worth more than the split: **`work` came from the duration
 * cache, whose `ms` is `diagnostic().duration` — tests and hooks only, excluding `collect`.** Module
 * evaluation and transform are reported separately and are 68-85s in these runs, as large as the test time,
 * so `work/cores` is ~14-19s rather than 8.7s and an 18.3s floor was barely binding. `max(floor,
 * work/cores)` means nothing unless `collect` is inside `work`.
 *
 * So the floor fell 2.8x and bought about a second, which is what Phase 5 recorded the first time. What the
 * floor being 6.6s rather than 18.3s does leave is a smaller single block: this file's worst recorded
 * reading was 34.4s against the 60s window birpc gives a call, and the hook below is what kept that from
 * being one block.
 *
 * The three cases that build a TypeScript program are their own file, which is the boundary that phase
 * originally named: *"91 pure, 3 that invoke a compiler, which is a real tier boundary."*
 *
 * `root` is a live binding rather than a parameter: the hooks reassign it per case, so the ~400 call sites
 * across the five files read the current value without being rewritten to thread it.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { PACK_TYPES_FACADE, generatePackFiles } from '../../../../src/build/generate-entries.ts';
import { PACK_SNAPSHOT_FORMAT } from '../../../../src/build/manifest.ts';
import type { PackManifest, PackSnapshot } from '../../../../src/build/manifest.ts';

/**
 * Re-exported because the fixture already imports them for its own helpers, so a spec file that asserts on
 * codegen's output takes them from here rather than reaching past this module to the same source.
 */
export { PACK_SNAPSHOT_FORMAT, PACK_TYPES_FACADE, generatePackFiles };

/** The case's own pack root, reassigned per case below and read live by every helper here. */
export let root: string;

/**
 * The per-case fixture, registered by each spec file.
 *
 * **The event-loop turn is not boilerplate.** A pool worker runs each case synchronously and `await` on a
 * resolved promise only drains microtasks, so a file of synchronous cases is *one* block however many `it`s
 * it holds — measured at 9.7s alone and 39.5s under the chain's lanes, against the 60s window birpc gives a
 * call and vitest hardcodes. A worker that never turns its loop cannot read the reply to the `onTaskUpdate`
 * it already sent, so the run fails with `[vitest-worker]: Timeout calling` while every test passes. This
 * caps a file at its longest single case, and a split file without it inherits the hazard at a fifth of the
 * size.
 */
export function setupPackFixture(): void {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-codegen-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  afterEach(() => new Promise<void>((resolve) => { setImmediate(resolve); }));
}

export function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

/** The contribution keys a manifest holds under `extensions`, which a case here may write flat */
const EXTENSION_KEYS = ['steps', 'artifacts', 'blocks', 'commands', 'dsl', 'textEditor', 'appExtensions', 'services'] as const;

/**
 * A manifest for a case, over the minimum, with two conveniences the cases below are the reason for.
 *
 * `features` may be written as a list of entries carrying their `id`, which this keys by that id, and a
 * contribution key may be written at the root, which this moves under `extensions`. Both are because
 * these cases are about what codegen *emits*: a list reads better where a case declares several features
 * and the `system()`/`withSurface()` helpers build them, and one flat key reads better than a section
 * wrapping it. The manifest's own shape is `manifest-schema.spec.ts`'s subject — that a duplicate feature
 * id is unrepresentable, and that a contribution key at the root is refused.
 */
export function manifest(fields: Record<string, unknown>): PackManifest {
  const features = Array.isArray(fields.features)
    ? Object.fromEntries((fields.features as { id: string }[]).map(({ id, ...entry }) => [id, entry]))
    : fields.features;
  const flat = EXTENSION_KEYS.filter((key) => key in fields);
  const extensions = flat.length > 0 || fields.extensions
    ? { ...(fields.extensions as object), ...Object.fromEntries(flat.map((key) => [key, fields[key]])) }
    : undefined;
  const rest = Object.fromEntries(Object.entries(fields).filter(([key]) => !flat.includes(key as typeof EXTENSION_KEYS[number])));
  return {
    id: 'demo-pack', name: 'Demo', version: '1.0.0',
    ...rest,
    ...(features ? { features } : {}),
    ...(extensions ? { extensions } : {}),
  } as unknown as PackManifest;
}

/** The exports every facade `apack pack build` bundles publishes, and the declaration each gets by default */
export const FACADE_DEFAULTS = {
  PackEntityShapes: '{}',
  PackStepNodes: 'never',
  PackSurfaceEvents: '{}',
  PackSystemEvents: '{}',
  PackSystemAsks: '{}',
  PackFeatureSettings: '{}',
  PackGroupSettings: '{}',
  Services: '{}',
  Repositories: '{}',
};

/**
 * A dependency's facade as `apack pack build` bundles one, with `overrides` replacing a named export's
 * declaration. Generated code imports these from every dependency.
 */
export function facade(overrides: Partial<Record<keyof typeof FACADE_DEFAULTS, string>> = {}): Record<string, string> {
  const body = Object.entries({ ...FACADE_DEFAULTS, ...overrides })
    .map(([name, type]) => `export type ${name} = ${type};`)
    .join('\n');
  return { [PACK_TYPES_FACADE]: body };
}

/** A dependency facade whose surfaces declare no state contract, so each publishes never. */
export function withSurfaceState(facades: Record<string, string>, surfaces: readonly string[]): Record<string, string> {
  const state = surfaces.map(id => `${JSON.stringify(id)}: never`).join('; ');
  return { ...facades, [PACK_TYPES_FACADE]: `${facades[PACK_TYPES_FACADE]}\nexport type PackSurfaceState = { ${state} };` };
}

export function dependency(fields: Record<string, unknown>, facades: Record<string, string> = facade()): PackSnapshot {
  return { declarationRevision: _declarationRevision(manifest({ id: 'base-pack', ...fields })), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades, manifest: manifest({ id: 'base-pack', ...fields }), format: PACK_SNAPSHOT_FORMAT };
}

export async function generate(fields: Record<string, unknown>, deps: Record<string, PackSnapshot> = {}): Promise<Record<string, string>> {
  return await generatePackFiles(manifest(fields), { packRoot: root, depSnapshots: new Map(Object.entries(deps)) });
}

/**
 * A system entry whose spec declares the events the system receives and sends, typed as `defineSystem` types
 * them, with no import: codegen reads the sent events from the default export's spec.
 */
/**
 * A surface entry, and beside it the contract leaf when the surface declares one. The contract is a plain declared
 * type: these fixtures are bare temp dirs with no `@apackdev/sdk` to resolve, and a declared type needs no import to
 * read — which is the point of reading one rather than a value's phantom property.
 */
export function writeSurfaceState(file: string, inbox?: string): string {
  write(file.endsWith('.ts') ? file : `${file}.ts`, ['declare const state: import("xstate").AnyStateMachine;', 'export default state;'].join('\n') + '\n');
  if (inbox !== undefined) writeContract(`${file.replace(/(\.ts)?$/, '')}.types.ts`, inbox);
  return file;
}

/** A contract leaf: the state the surface publishes, and the inbox it opens */
export function writeContract(file: string, inbox?: string, state = '{ ready: boolean }'): string {
  write(file, `export type Contract = { state: ${state}${inbox === undefined ? '' : `; inbox: { public: ${inbox} }`} };\n`);
  return `${file}#Contract`;
}

/** The manifest `surface` object for a feature whose contract sits beside its entry */
export const surfaceWithContract = (entry: string, inbox?: string) => ({
  label: 'Fixture', state: writeSurfaceState(entry, inbox),
  ...(inbox === undefined ? {} : { contract: `${entry.replace(/(\.ts)?$/, '')}.types.ts#Contract` }),
});

export function writeSystemEntry(id: string, outgoing: string, incoming = `{ type: '${id.toUpperCase()}_RUN' }`): string {
  const entry = `src/features/${id}/be/system.ts`;
  // A real spec: the generated pack entry asserts the machine was built from the contract apack.json names
  write(entry, [
    "import { defineSystem } from '@apackdev/sdk/framework';",
    "import type { Contract } from './contract.ts';",
    'export default { spec: defineSystem<Contract>(), machine: undefined as never };',
  ].join('\n') + '\n');
  writeSystemContract(id, outgoing, incoming);
  return entry;
}

/**
 * A system's contract, as `apack.json` names it. A plain declared type: these fixtures are bare temp dirs with no
 * `@apackdev/sdk` to resolve, and a declared type needs no import to read — which is the point of reading one rather
 * than a value's phantom property, and why the system module above can be empty.
 */
export function writeSystemContract(id: string, outgoing: string, incoming = `{ type: '${id.toUpperCase()}_RUN' }`): string {
  write(`src/features/${id}/be/contract.ts`, `export type Contract = { incoming: ${incoming}; outgoing: ${outgoing} };\n`);
  return `src/features/${id}/be/contract.ts#Contract`;
}

/**
 * A feature with a system, and the system entry it names. The entry declares the events the system
 * emits: each surface's generated `receives` is read from it, so a fixture without one is a pack
 * whose sends could not be checked.
 */
export const system = (id: string, extra: Record<string, unknown> = {}) => {
  const entry = `src/features/${id}/be/system.ts`;
  // A test that writes its own richer system entry keeps it
  if (!fs.existsSync(path.join(root, entry))) {
    writeSystemEntry(id, `{ type: '${id.toUpperCase()}_CONNECTED' } | { type: '${id.toUpperCase()}_UPDATED' }`);
  }
  const contract = fs.existsSync(path.join(root, `src/features/${id}/be/contract.ts`))
    ? { contract: `src/features/${id}/be/contract.ts#Contract` }
    : {};
  return { id, description: `Test system for ${id}.`, system: { entry, ...contract, ...extra } };
};
export const withSurface = (feature: Record<string, unknown>, inbox?: string) => ({ ...feature, surface: surfaceWithContract(`src/features/${feature.id}/fe/index.ts`, inbox) });

/** The event types the generated pack entry says a feature's surface receives, or undefined when it has no surface */
export function receives(files: Record<string, string>, featureId: string): string[] | undefined {
  const entry = files['src/__generated__/pack-entry.ts'];
  const feature = entry.slice(entry.indexOf(`    '${featureId}': {`));
  const match = /^ {4}'[^']+': \{\n(?:(?! {4}\}).*\n)*? {6}surface: \{ receives: \[(.*)\] \}/.exec(feature);
  return match ? JSON.parse(`[${match[1]}]`) as string[] : undefined;
}
