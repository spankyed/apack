// What codegen says a surface receives and a system sends.
//
// The inbox a contract opens, the events a system declares, and what the generated pack entry records a
// surface as receiving.
//
// One of five files split from a 1,365-line original; `_support/pack.ts` holds the fixture and why.
//
// @slow: 27 cases, every one a temp pack and a full codegen pass — the file 5.7-9.0s
// Every case mkdtemps a pack and removes it (`setupPackFixture`) and runs `generatePackFiles` over a
// fresh manifest, so the cost is the work rather than the test, and it is per case rather than per file —
// which is why splitting the original by subject moved the three compiling cases into `compiles.spec.ts`
// and left the pure ones costing what they cost. `goal-one-job-pool.md` Phase 5 has the boundary.
//
// The range is the span across runs rather than noise: a pool spreads across workers, so these read
// faster when fewer projects run beside them — measured 2026-10-06, this file was at the low end in a
// two-project run and the high end in an eleven-project one. Which is why the count is the durable
// figure here and a per-case millisecond is not.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { setupPackFixture, dependency, facade, generate, surfaceWithContract, receives, root, system, withSurface, withSurfaceState, write, writeContract, writeSurfaceState, writeSystemEntry } from './_support/pack.ts';
import { GENERATED_EVENT_CONTRACTS_FILE } from '../../../src/build/generate-entries.ts';

setupPackFixture();

it('preserves quoted event names in both static data and generated runtime literals', async () => {
  writeSystemEntry('quoted', `{ type: "can't" }`);
  const files = await generate({ features: [withSurface(system('quoted'))] });
  expect(receives(files, 'quoted')).toEqual(["can't"]);
  expect(JSON.parse(files[GENERATED_EVENT_CONTRACTS_FILE]).quoted.surface.receives).toEqual(["can't"]);
});

it('captures endpoint contracts without executing modules or publishing internal events', async () => {
  writeSystemEntry('jobs', "{ type: 'DONE' }", "{ type: 'START' | 'CANCEL' }");
  write('src/features/jobs/be/contract.ts', `throw new Error('Never activate');
export type Contract = { incoming: { type: 'START' | 'CANCEL' }; internal: { type: 'PRIVATE' }; outgoing: { type: 'DONE' } };`);
  const files = await generate({ features: [withSurface(system('jobs', { events: { incoming: ['EXTERNAL', 'START'] } }), "{ type: 'SHOW' }")] });
  expect(JSON.parse(files[GENERATED_EVENT_CONTRACTS_FILE])).toEqual({ jobs: {
    system: { incoming: ['CANCEL', 'EXTERNAL', 'START'], outgoing: ['DONE'] },
    surface: { receives: ['DONE', 'SHOW'] },
  } });
  expect(files['src/__generated__/pack-entry.ts']).toContain('incoming: ["CANCEL","EXTERNAL","START"]');
});

describe('generated events', () => {
  it('keys each surface by its own system\'s events and the inbox it declares', async () => {
    const files = await generate({ features: [withSurface(system('actions')), withSurface(system('flows'), "{ type: 'FLOW.SELECT' }")] });
    const events = files['src/__generated__/events.ts'];
    // A surface that declares nothing takes only what its own feature's system sends it
    expect(events).toContain("'actions': __events_actions | __accepts_actions;");
    expect(events).toContain("'flows': __events_flows | __accepts_flows;");
    // What a dependent may send is the `public` audience alone: not the events between a feature's own halves, and
    // not the `pack` audience either, which is what this pack's features send each other
    expect(events).toContain("export type PackSurfaceEvents = {");
    expect(events).toContain("  'flows': __public_flows;");
    // Every host surface is sendable, as every dependency's system already is: the owner's declaration is the contract
    expect(events).toContain("export type QualifiedSurfaceEvents = Qualified<'demo-pack', OwnSurfaceEvents> & HostSurfaceEvents;");
    expect(events).toContain("export type SendableSurfaceEvents = WithOwnNames<'demo-pack', QualifiedSurfaceEvents>;");
  });

  it('records in the pack entry what each own surface receives: its system\'s events and its declared inbox', async () => {
    const files = await generate({ features: [withSurface(system('actions')), withSurface(system('flows'), "{ type: 'FLOW.SELECT' } | { type: 'FLOW.OPEN' }")] });
    expect(receives(files, 'actions')).toEqual(['ACTIONS_CONNECTED', 'ACTIONS_UPDATED']);
    // sorted and deduplicated across both halves
    expect(receives(files, 'flows')).toEqual(['FLOWS_CONNECTED', 'FLOWS_UPDATED', 'FLOW.OPEN', 'FLOW.SELECT'].sort());
  });

  // `{ type: 'A' | 'B' }` is one member covering two event types, a legal way to write an event whose
  // payload is the same either way — the style StepEvent already uses. Reading only single literals
  // rejected it, failing the build on a declaration nothing else objects to.
  it("expands a member whose `type` is a union of literals", async () => {
    writeSystemEntry('jobs', "{ type: 'CANCEL' | 'COMPLETE'; id: string } | { type: 'JOBS_CONNECTED' }");
    expect(receives(await generate({ features: [withSurface(system('jobs'))] }), 'jobs')).toEqual(['CANCEL', 'COMPLETE', 'JOBS_CONNECTED']);
  });

  it('still refuses a member whose `type` is not a literal at all', async () => {
    writeSystemEntry('loose', '{ type: string }');
    await expect(generate({ features: [withSurface(system('loose'))] })).rejects.toThrow(/Feature "loose": .*`type` is string, not a string literal or a union of them/);
  });

  // The spec is the one place a system's sent events are declared: no second, named union can drift from it
  it("reads the events from the spec, whatever else the entry exports", async () => {
    writeSystemEntry('memos', "{ type: 'MEMO_SAVED' }");
    fs.appendFileSync(path.join(root, 'src/features/memos/be/system.ts'), "export type OutgoingMemosEvents = { type: 'STALE' };\n");
    expect(receives(await generate({ features: [withSurface(system('memos'))] }), 'memos')).toEqual(['MEMO_SAVED']);
  });

  it('records no events for a system whose spec sends none', async () => {
    writeSystemEntry('quiet', 'never');
    expect(receives(await generate({ features: [withSurface(system('quiet'))] }), 'quiet')).toEqual([]);
  });

  // These four replace the defences the phantom read needed: an entry annotated `: SystemEntry`, an entry whose
  // spec lost its events, a spec whose import didn't resolve, and an entry with no default export. Codegen no
  // longer reads the default export at all, so none of those is a failure any more — what can go wrong now is
  // that the contract the manifest names isn't there, or isn't a type.
  it('refuses a system contract the module does not declare, naming the type it looked for', async () => {
    const entry = 'src/features/typed/be/system.ts';
    write(entry, 'export default { spec: undefined as never, machine: undefined as never };\n');
    write('src/features/typed/be/contract.ts', 'export type Other = { outgoing: { type: \'X\' } };\n');
    await expect(generate({ features: [withSurface({ id: 'typed', system: { entry, contract: 'src/features/typed/be/contract.ts#Contract' } })] })).rejects.toThrow(/Feature "typed": system\.contract: .*doesn't export "Contract"/);
  });

  it('refuses a system contract the module exports only as a value', async () => {
    const entry = 'src/features/valued/be/system.ts';
    write(entry, 'export default { spec: undefined as never, machine: undefined as never };\n');
    write('src/features/valued/be/contract.ts', 'export const Contract = { outgoing: {} };\n');
    await expect(generate({ features: [withSurface({ id: 'valued', system: { entry, contract: 'src/features/valued/be/contract.ts#Contract' } })] })).rejects.toThrow(/only as a value, not a type/);
  });

  it('refuses a contract that declares no outgoing events, rather than publishing an empty system', async () => {
    const entry = 'src/features/mute/be/system.ts';
    write(entry, 'export default { spec: undefined as never, machine: undefined as never };\n');
    write('src/features/mute/be/contract.ts', "export type Contract = { incoming: { type: 'GO' } };\n");
    await expect(generate({ features: [withSurface({ id: 'mute', system: { entry, contract: 'src/features/mute/be/contract.ts#Contract' } })] })).rejects.toThrow(/declares no `outgoing` events/);
  });

  // The inbox half of the refusal above. It went without one until 2026-09-27: a declared audience that accepted
  // nothing published an audience nothing may send to, and the pack built green — while the same mistake in a
  // system's `outgoing` threw. Asked before adding it: `npm run build:default-setup`, both fixture packs and this suite were
  // green with the check in, so nothing in the tree relied on the old behaviour.
  it('refuses an audience that accepts no events, rather than publishing an inbox nothing may send to', async () => {
    const surface = surfaceWithContract('src/features/sidebar/fe/index.ts', 'never');
    await expect(generate({ features: [{ id: 'sidebar', surface }] })).rejects.toThrow(/inbox declares `public` and it accepts no events/);
  });

  // The two shapes that are not that, and must keep working: no inbox at all, and a real one
  it('reads a surface with no inbox as accepting only its own system\'s events', async () => {
    const surface = surfaceWithContract('src/features/quiet/fe/index.ts');
    await expect(generate({ features: [{ id: 'quiet', surface }] })).resolves.toBeDefined();
  });

  // A system that sends nothing names no contract at all; its surface then receives only what it declares itself
  it('reads a system with no contract as sending nothing', async () => {
    const entry = 'src/features/quiet2/be/system.ts';
    write(entry, 'export default { spec: undefined as never, machine: undefined as never };\n');
    const files = await generate({ features: [withSurface({ id: 'quiet2', system: { entry } }, "{ type: 'POKE' }")] });
    expect(receives(files, 'quiet2')).toEqual(['POKE']);
  });

  it('records nothing for a surface no system sends to, so a send there is rejected', async () => {
    const files = await generate({ features: [withSurface(system('actions')), withSurface({ id: 'viewer', surface: { label: 'Fixture', state: writeSurfaceState('src/features/viewer/fe/index.ts') } })] });
    expect(receives(files, 'actions')).toEqual(['ACTIONS_CONNECTED', 'ACTIONS_UPDATED']);
    expect(receives(files, 'viewer')).toEqual([]);
  });

  it('records only this pack\'s own surfaces: a dependency\'s and the host\'s are their owners\' to declare', async () => {
    const deps = { 'base-pack': dependency({ features: [{ id: 'memos', system: { entry: 'x' }, surface: { label: 'Fixture', state: writeSurfaceState('y') } }] }, withSurfaceState(facade({ PackSurfaceEvents: "{ memos: { type: 'MEMO_ADDED' } }" }), ['memos'])) };
    const files = await generate({ dependencies: { 'base-pack': '1.0.0' }, features: [withSurface(system('actions'))] }, deps);
    expect(receives(files, 'actions')).toEqual(['ACTIONS_CONNECTED', 'ACTIONS_UPDATED']);
    // The pack entry carries its own features only: nothing there declares what another's surface receives
    expect(files['src/__generated__/pack-entry.ts']).not.toMatch(/'(base-pack\/memos|memos|host\/application)': \{/);
  });


  it('gives a feature with a system but no surface no key: nothing could receive the events', async () => {
    const files = await generate({ features: [withSurface(system('actions')), system('worker')] });
    const events = files['src/__generated__/events.ts'];
    expect(events).toContain("'actions': __events_actions | __accepts_actions;");
    expect(events).not.toContain("'worker': __events_worker | __accepts_worker;");
    expect(events).not.toContain('type __events_worker');
  });


  it('keys a surface-only feature by the inbox it declares, with no system of its own', async () => {
    const surface = surfaceWithContract('src/features/sidebar/fe/index.ts', "{ type: 'SIDEBAR.TOGGLE' }");
    const files = await generate({ features: [system('memos'), { id: 'sidebar', surface }] });
    expect(files['src/__generated__/events.ts']).toContain("'sidebar': __accepts_sidebar;");
    expect(receives(files, 'sidebar')).toEqual(['SIDEBAR.TOGGLE']);
  });

  // The contract is read as a declared type. A name exported only as a value is the mistake worth catching: the
  // old reader's opposite check — an `accepts` exported only as a type — went with the phantom it read.
  it('refuses a contract the module exports only as a value', async () => {
    const entry = writeSurfaceState('src/features/sidebar/fe/index.ts');
    write('src/features/sidebar/fe/contract.ts', 'export const Contract = { state: {} };\n');
    await expect(generate({ features: [system('memos'), { id: 'sidebar', surface: { label: 'Fixture', state: entry, contract: 'src/features/sidebar/fe/contract.ts#Contract' } }] })).rejects.toThrow(/only as a value, not a type/);
  });

  it('refuses a contract the module does not declare, naming the type it looked for', async () => {
    const entry = writeSurfaceState('src/features/sidebar/fe/index.ts');
    write('src/features/sidebar/fe/contract.ts', 'export type Other = { state: {} };\n');
    await expect(generate({ features: [system('memos'), { id: 'sidebar', surface: { label: 'Fixture', state: entry, contract: 'src/features/sidebar/fe/contract.ts#Contract' } }] })).rejects.toThrow(/doesn't export "Contract"/);
  });

  it('refuses an inbox opened to an audience that does not exist', async () => {
    const entry = writeSurfaceState('src/features/sidebar/fe/index.ts');
    write('src/features/sidebar/fe/contract.ts', "export type Contract = { state: {}; inbox: { publik: { type: 'X' } } };\n");
    await expect(generate({ features: [system('memos'), { id: 'sidebar', surface: { label: 'Fixture', state: entry, contract: 'src/features/sidebar/fe/contract.ts#Contract' } }] })).rejects.toThrow(/is not an audience/);
  });

  // A surface may publish state and take nothing: its own system's events still reach it
  it('reads a contract with no inbox as receiving only its own system events', async () => {
    const entry = writeSurfaceState('src/features/sidebar/fe/index.ts');
    const contract = writeContract('src/features/sidebar/fe/contract.ts');
    const files = await generate({ features: [{ ...system('sidebar'), surface: { label: 'Fixture', state: entry, contract } }] });
    expect(receives(files, 'sidebar')).toEqual(['SIDEBAR_CONNECTED', 'SIDEBAR_UPDATED']);
  });

  it("keys a dependency's surface that declares nothing to never, so no send to it compiles", async () => {
    const deps = { 'base-pack': dependency({ features: [{ id: 'memos', surface: { label: 'Fixture', state: 'y' } }] }, withSurfaceState(facade({ PackSurfaceEvents: '{ memos: never }' }), ['memos'])) };
    const files = await generate({ dependencies: { 'base-pack': '1.0.0' }, features: [withSurface(system('actions'))] }, deps);
    expect(files['src/__generated__/deps/base-pack.d.ts']).toContain('{ memos: never }');
    expect(files['src/__generated__/events.ts']).toContain("Qualified<'base-pack', __dep_base_pack_PackSurfaceEvents>");
  });

  it("takes every dependency's surfaces, with the inbox that dependency declares", async () => {
    const deps = { 'base-pack': dependency({ features: [{ id: 'memos', surface: { label: 'Fixture', state: 'y' } }] }, withSurfaceState(facade({ PackSurfaceEvents: "{ memos: { type: 'MEMO_ADDED' } }" }), ['memos'])) };
    const files = await generate({ dependencies: { 'base-pack': '1.0.0' }, features: [withSurface(system('actions'))] }, deps);
    const events = files['src/__generated__/events.ts'];
    expect(events).toContain("import type { PackSurfaceEvents as __dep_base_pack_PackSurfaceEvents } from './deps/base-pack.ts';");
    expect(events).toContain("Qualified<'base-pack', __dep_base_pack_PackSurfaceEvents>");
  });
});

// `_mergeProvenance`, which names a surface's owning pack, is covered on its own in provenance.spec.ts.

describe('generated system sends', () => {
  const baseTypes = facade();

  it("names the pack's own systems by feature id and its dependencies' as <dependency>/<feature>", async () => {
    const files = await generate({ features: [system('memos')] }, {
      'base-pack': dependency({ features: [system('calendar')] }, baseTypes),
      'default-setup': dependency({ id: 'default-setup', features: [system('memos')] }),
    });
    const events = files['src/__generated__/events.ts'];
    expect(events).toContain("export type PackSystemEvents = {\n  'memos': IncomingEventsOf<__SystemContracts['memos']>;\n};");
    expect(events).toContain("export type QualifiedSystemEvents = Qualified<'demo-pack', PackSystemEvents> & Qualified<'base-pack', __dep_base_pack_PackSystemEvents> & ");
    expect(events).toContain("export type SendableSystemEvents = WithOwnNames<'demo-pack', QualifiedSystemEvents>;");
    // The asks each system answers, by the same names: what types `ask` and `fromAsk`
    expect(events).toContain("export type PackSystemAsks = {\n  'memos': ContractAsks<__SystemContracts['memos']>;\n};");
    expect(events).toContain("export type QualifiedSystemAsks = Qualified<'demo-pack', PackSystemAsks> & Qualified<'base-pack', __dep_base_pack_PackSystemAsks> & ");
    // No table of names: the sends derive every address from the pack id (@apackdev/sdk/ids)
    expect(events).toContain("defineEvents<SendableSurfaceEvents, SendableSystemEvents, SendableSystemAsks>('demo-pack');");
    expect(events).not.toContain('systemIds');
    // Type-only, and over the contracts: it imports no system module, because those import the generated events
    // module this one feeds — reading them here would put the machine in front of the file that describes it
    expect(files['src/__generated__/system-specs.ts']).toContain("export type SystemContracts = {\n  'memos': __system_contract_memos;\n};");
    expect(files['src/__generated__/system-specs.ts']).not.toContain('be/system');
    // Pack code names systems; it gets no module of addresses
    expect(files['src/__generated__/system-ids.ts']).toBeUndefined();
    expect(files['src/__generated__/pack-types.ts']).toContain("export type { PackSurfaceEvents, PackSystemAsks, PackSystemEvents } from './events.ts';");
  });

  // Pack code resolves a name with `ref`, which is bound to its pack as the sends are. `packId` is the same id as a
  // value, for the one thing a name can't express: pack code that has to say which pack it is — the sandbox that
  // runs an action stamps it on what the action sends. Writing the literal would be wrong on the copy.
  it('binds ref to the pack, so pack code never passes its own pack id', async () => {
    const files = await generate({ features: [{ id: 'sidebar', surface: { label: 'Fixture', state: writeSurfaceState('src/features/sidebar/fe/surface.ts') } }] });
    expect(files['src/__generated__/ref.ts']).toContain("export const packId = 'demo-pack';");
    expect(files['src/__generated__/ref.ts']).toContain('export const ref = (name: FeatureName): FeatureRef => resolveName(name, packId);');
    expect(files['src/__generated__/bus-ids.ts']).toBeUndefined();
  });

  it("gives a pack without systems a tell for its dependencies' systems", async () => {
    const files = await generate({ features: [{ id: 'sidebar', surface: { label: 'Fixture', state: writeSurfaceState('src/features/sidebar/fe/surface.ts') } }] }, { 'base-pack': dependency({ features: [system('calendar')] }, baseTypes) });
    const events = files['src/__generated__/events.ts'];
    expect(events).not.toContain('system-specs');
    expect(events).toContain("defineEvents<SendableSurfaceEvents, SendableSystemEvents, SendableSystemAsks>('demo-pack');");
    expect(files['src/__generated__/system-specs.ts']).toBeUndefined();
  });
});

/**
 * `pack-types.ts` re-exports `PackSurfaceState` only for a pack that has surfaces, so a dependency without any
 * publishes no such type. `fe.ts` imported it from every dependency regardless, which left the dependent's own
 * typecheck unable to resolve the import.
 */
describe("a dependency that registers no surface", () => {
  it("is left out of fe.ts's state imports, and kept in everything else", async () => {
    const deps = {
      'headless-pack': dependency({ id: 'headless-pack', features: [{ id: 'jobs', system: { entry: 'x' } }] }, facade()),
    };
    const files = await generate({ dependencies: { 'headless-pack': '1.0.0' }, features: [withSurface(system('actions'))] }, deps);

    expect(files['src/__generated__/fe.ts']).not.toContain("from './deps/headless-pack.ts'");
    // its systems are still sendable, so the other facades keep naming it
    expect(files['src/__generated__/events.ts']).toContain("from './deps/headless-pack.ts'");
  });

  it("keeps a dependency that does register one", async () => {
    const deps = {
      // A pack with surfaces publishes PackSurfaceState; `facade()`'s defaults can't, since pack-types.ts
      // re-exports it only for such a pack
      'base-pack': dependency({ features: [{ id: 'memos', system: { entry: 'x' }, surface: { label: 'Fixture', state: 'y' } }] }, withSurfaceState(facade(), ['memos'])),
    };
    const files = await generate({ dependencies: { 'base-pack': '1.0.0' }, features: [withSurface(system('actions'))] }, deps);

    expect(files['src/__generated__/fe.ts']).toContain("import type { PackSurfaceState as");
    expect(files['src/__generated__/fe.ts']).toContain("from './deps/base-pack.ts'");
  });
});
