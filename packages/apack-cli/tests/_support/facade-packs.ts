/**
 * The two packs, the consumer sources and the compiler helpers that `facade-typing` asks its questions
 * with — and the suite itself, registered once per dependency layout.
 *
 * **It is one suite in a support module rather than two copies, because the split is by layout and
 * nothing else.** `facade-typing.integration.spec.ts` asks every question against the workspace SDK
 * source and `facade-typing-published.integration.spec.ts` against the npm-packed one; the cases are
 * identical and only `published` differs, so duplicating them would be two bodies to keep in step for a
 * parameter the fixture already takes.
 *
 * **Why the file was split, and what the split did not buy.** It was the integration half's floor —
 * measured 2026-10-06, 44.1s against a 30.2s `work/cores`, which `halfBound` calls floor-bound. The block
 * came apart as intended:
 *
 *     the file, in the pool          42.1s -> 19.6s + 18.3s (the two halves)
 *     the half's floor              42.1s -> 23.8s (`scaffold` is the floor now)
 *     the two files, run alone       23.1s -> 13.9s (in parallel)
 *     the whole integration pool     49.9s -> 51.4s  (medians of 3, 79% then 74% idle)
 *
 * **The pool did not get faster, and the last row is the one to read.** `halfBound`'s verdict is taken
 * over readings measured *inside* the pool, so both the floor and the work are inflated by the same
 * contention — the comparison between them is sound, but neither is the wall, and the wall sat ~6s above
 * both before the split and ~14s above both after. So "floor-bound" says which of two figures is larger;
 * it does not license the inference that splitting the floor file makes the run shorter. That inference
 * is what this split tested, and the answer was no.
 *
 * What it did buy is smaller and is not what this comment first claimed. It said the half's largest
 * *event-loop block* halved from 44.1s against birpc's 60s window — which was never true, because the
 * loop-turn hook below already caps a file at its longest single case rather than the sum of them. The
 * file's longest case is ~2s, so its block was `beforeAll` plus that, not the 44.1s the duration cache
 * records for the whole file. Measured with `npm run measure:loop` on 2026-10-06: 5.8s after the split,
 * against ~9s before, when one `beforeAll` installed the packed packages as well.
 *
 * So the honest payoff is the loop nobody was measuring: **running these tests alone is 23.1s before and
 * 13.9s after**, two files in parallel instead of one in series, which is what anyone iterating on the
 * facade gate pays. Plus the file-level floor, and two files named for what they cover.
 *
 * **And layout is the only axis that splits it without paying the fixture twice.** `buildPacks` runs two
 * real `apack pack build`s, and for the published layout an `installPublishedPackages()` that npm-packs three
 * tarballs and is *not* memoised. A split by subject — typechecks here, completions there — would run
 * that fixture in both files and raise the half's total work to lower its floor, which is the trade
 * `generate-entries` already made for nothing (`apack-sdk/tests/build/generate-entries/_support/pack.ts`
 * records that null result). Splitting on `LAYOUTS` leaves the total where it was: one `buildPacks` per
 * file, two as before.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { sealPackBuild } from '@apackdev/host/packs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PACKAGES_BUILT, REPO_ROOT, installPublishedPackages } from '@app/publish-checks';
import { callCli, packageJson, preparePack, tsconfig, typecheckPack, write } from './pack-builds';
import { PACK_LAYOUT } from '@apackdev/host/packs';

/**
 * A pack's typed facades (#generated/ears, events, services, repository) cover its own
 * declarations and its dependencies'. A real `apack pack build` of a dependency pack produces its facade
 * types; a dependent pack built against it (file: dependency) typechecks a consumer, with every
 * generated file, against the workspace SDK source and the packed SDK under node16 and bundler.
 */
// Relative and #generated imports name .js, so the sources are valid under node16 too
const BASE_PACK = {
  'package.json': packageJson('base-pack'),
  'tsconfig.json': tsconfig,
  'apack.json': JSON.stringify({
    id: 'base-pack', name: 'Base', version: '1.0.0',
    data: { entities: { Tag: { shape: "src/types.ts#TagEntity" }, Item: { shape: "src/types.ts#ItemEntity" } }, relations: { tagged: {} }, roles: ['featured'] },

    features: {
      calendar: { description: 'Feature declaration fixture.',
        system: { entry: 'src/system.ts', contract: 'src/system.contract.ts#Contract' },
        surface: { label: 'Fixture', state: 'src/surface.ts', contract: 'src/surface.types.ts#Contract' },
        services: { search: 'src/search.ts#searchService' },
        repositories: { tagQueries: 'src/repository.ts#tagQueries' },
      },
      // A second surface of the dependency, which declares no inbox: nothing may send it
      inbox: { description: 'Feature declaration fixture.',
        system: { entry: 'src/inbox.ts', contract: 'src/inbox.contract.ts#Contract' },
        surface: { label: 'Fixture', state: 'src/inbox-surface.ts' },
      },
    },
  }),
  'src/types.ts': 'export interface TagEntity { name: string }\nexport interface ItemEntity { title: string }\n',
  // The system's contract: a declared type the manifest names, which is what the facade publishes
  'src/system.contract.ts': [
    "export type OutgoingThreadsEvents = { type: 'TAG_ADDED'; name: string };",
    "export type Contract = { incoming: { type: 'ADD_TAG'; name: string }; outgoing: OutgoingThreadsEvents };",
  ].join('\n') + '\n',
  'src/system.ts': [
    "import { setup } from 'xstate';",
    "import { defineSystem } from '@apackdev/sdk/framework';",
    "import type { Contract } from './system.contract.ts';",
    'export const threadsSpec = defineSystem<Contract>();',
    'const entry = { spec: threadsSpec, machine: setup({ types: threadsSpec.types }).createMachine({ id: "calendar" }) };',
    'export default entry;',
  ].join('\n'),
  'src/surface.ts': [
    "import type { AnyStateMachine } from 'xstate';",
    "export default { id: 'calendar' } as unknown as AnyStateMachine;",
  ].join('\n') + '\n',
  // The surface's contract: a declared type in a leaf the surface's own module never imports, which is what the
  // dependent's facade carries as this surface's published inbox
  'src/surface.types.ts': "export type Contract = { state: { tags: string[] }; inbox: { public: { type: 'TAG_ADDED'; name: string } } };\n",
  'src/inbox.contract.ts': [
    "export type OutgoingInboxEvents = { type: 'MAIL_ARRIVED'; from: string };",
    "export type Contract = { incoming: { type: 'FETCH_MAIL' }; outgoing: OutgoingInboxEvents };",
  ].join('\n') + '\n',
  'src/inbox.ts': [
    "import { setup } from 'xstate';",
    "import { defineSystem } from '@apackdev/sdk/framework';",
    "import type { Contract } from './inbox.contract.ts';",
    'export const inboxSpec = defineSystem<Contract>();',
    'const entry = { spec: inboxSpec, machine: setup({ types: inboxSpec.types }).createMachine({ id: "inbox" }) };',
    'export default entry;',
  ].join('\n'),
  'src/inbox-surface.ts': "import type { AnyStateMachine } from 'xstate';\nexport default { id: 'inbox' } as unknown as AnyStateMachine;\n",
  'src/search.ts': 'export const searchService = { query: (q: string): string[] => [q] };\n',
  'src/repository.ts': [
    "import { query, EARS } from '#generated/ears.ts';",
    'export const tagQueries = { names: (): string[] => query(EARS.Entity.Tag).pickAll().map((tag) => tag.name) };',
  ].join('\n'),
};

const APP_PACK = {
  'package.json': packageJson('app-pack'),
  'tsconfig.json': tsconfig,
  'apack.json': JSON.stringify({
    id: 'app-pack', name: 'App', version: '1.0.0',
    dependencies: { 'base-pack': 'file:../base-pack' },
    consumes: { services: ['base-pack/search'] },
    data: { entities: { Memo: { shape: "src/types.ts#ItemEntity" } }, relations: { related: {} }, roles: ['pinned'] },
    // Same type name as the dependency's Item shape

    features: { memos: { description: 'Feature declaration fixture.', system: { entry: 'src/system.ts', contract: 'src/system.contract.ts#Contract' }, surface: { label: 'Fixture', state: 'src/surface.ts' } } },
  }),
  'src/types.ts': 'export interface ItemEntity { text: string; pinned: boolean; note?: string }\n',
  'src/surface.ts': "import type { AnyStateMachine } from 'xstate';\nexport default { id: 'memos' } as unknown as AnyStateMachine;\n",
  'src/system.contract.ts': [
    "export type OutgoingMemosEvents = { type: 'MEMO_ADDED'; text: string };",
    "export type IncomingMemosEvents = { type: 'ADD_MEMO'; text: string } | { type: 'CLEAR_MEMOS' } | { type: 'PIN_MEMO' | 'UNPIN_MEMO'; id: string };",
    'export type Contract = { incoming: IncomingMemosEvents; outgoing: OutgoingMemosEvents };',
  ].join('\n') + '\n',
  'src/system.ts': [
    "import { setup } from 'xstate';",
    "import { defineSystem } from '@apackdev/sdk/framework';",
    "import type { Contract } from './system.contract.ts';",
    'export const memosSpec = defineSystem<Contract>();',
    'const entry = { spec: memosSpec, machine: setup({ types: memosSpec.types }).createMachine({ id: "memos" }) };',
    'export default entry;',
  ].join('\n'),
};

const CONSUMER = `
import { query, create, upsert, write, newId, type EntityShape, type EntityName } from '#generated/ears.ts';
import { broadcastToSurface, sendToSystem } from '#generated/events.ts';
import { services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import type { EARS } from '@apackdev/sdk';
type IsAny<T> = 0 extends 1 & T ? true : false;
type Expect<T extends true> = T;
type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;

declare const memoId: EARS.EntityId<'Memo'>;
const memo = query.ids(memoId).pickOne()!;
export type OwnField = Expect<Equal<typeof memo.text, string>>;
export type NotAny = Expect<Equal<IsAny<typeof memo.pinned>, false>>;

const tags = query('Tag').pickAll();
export type DependencyField = Expect<Equal<(typeof tags)[number]['name'], string>>;
// The dependency's ItemEntity is a different type from this pack's
const items = query('Item').pickAll();
export type DependencyItem = Expect<Equal<(typeof items)[number]['title'], string>>;

const picked = query('Memo').pickOne(['text'] as const);
export type PickedField = Expect<Equal<NonNullable<typeof picked>['text'], string>>;
export type Branded = Expect<Equal<ReturnType<typeof newId<'Memo'>>, EARS.EntityId<'Memo'>>>;

export type DependencyService = Expect<Equal<ReturnType<typeof services.search.query>, string[]>>;
export type DependencyRepository = Expect<Equal<ReturnType<typeof repository.tagQueries.names>, string[]>>;
export type RepositoryService = Expect<Equal<typeof services.repository, typeof repository>>;
// @ts-expect-error not a service of this pack or its dependency
services.nope;

// A surface of the dependency, and the host's: each takes what its own owner declares it accepts
broadcastToSurface('base-pack/calendar', { type: 'TAG_ADDED', name: 'x' });
broadcastToSurface('memos', { type: 'MEMO_ADDED', text: 'x' });
broadcastToSurface('host/application', { type: 'SURFACE_VISIBILITY_UPDATED', surfaceVisibility: { 'demo-pack/memos': false } });
// A surface someone else owns keeps the events its owner declares it receives; a pack widens only its own
// @ts-expect-error the calendar surface doesn't receive this event
broadcastToSurface('base-pack/calendar', { type: 'MEMO_ADDED', text: 'x' });
// @ts-expect-error a dependency's surface is named <dependency>/<feature>
broadcastToSurface('calendar', { type: 'TAG_ADDED', name: 'x' });
// @ts-expect-error the host declares what its application surface receives
broadcastToSurface('host/application', { type: 'MEMO_ADDED', text: 'x' });
// @ts-expect-error the dependency's inbox surface declares no inbox, so nothing may be sent to it
broadcastToSurface('base-pack/inbox', { type: 'MAIL_ARRIVED', from: 'x' });

// Systems: this pack's by feature id, the dependency's as <dependency>/<feature>
sendToSystem('memos', { type: 'ADD_MEMO', text: 'x' });
sendToSystem('memos', { type: 'UNPIN_MEMO', id: 'm1' });
sendToSystem('base-pack/calendar', { type: 'ADD_TAG', name: 'x' });
// @ts-expect-error the memos system doesn't receive this event
sendToSystem('memos', { type: 'ADD_TAG', name: 'x' });
// @ts-expect-error PIN_MEMO needs its id
sendToSystem('memos', { type: 'PIN_MEMO' });
declare const memoEventType: 'ADD_MEMO' | 'CLEAR_MEMOS';
// @ts-expect-error one event type per send
sendToSystem('memos', { type: memoEventType, text: 'x' });
declare const systemId: 'memos' | 'base-pack/calendar';
// @ts-expect-error one system per send
sendToSystem(systemId, { type: 'ADD_TAG', name: 'x' });

// Actions get services.emitter, which names every system and surface <pack>/<feature>, this pack's own too.
// Its own pack included is the point: an action is content, not source — a row a user edits, exports and copies
// into another pack — and a bare name would rebind on that copy instead of staying visibly wrong.
services.emitter.sendToSystem('app-pack/memos', { type: 'ADD_MEMO', text: 'x' });
services.emitter.sendToSystem('base-pack/calendar', { type: 'ADD_TAG', name: 'x' });
services.emitter.broadcastToSurface('base-pack/calendar', { type: 'TAG_ADDED', name: 'x' });
// @ts-expect-error a bare name would rebind if this action were copied to another pack
services.emitter.sendToSystem('memos', { type: 'ADD_MEMO', text: 'x' });
// @ts-expect-error and its surfaces, for the same reason
services.emitter.broadcastToSurface('calendar', { type: 'TAG_ADDED', name: 'x' });
// @ts-expect-error ADD_MEMO needs its text
services.emitter.sendToSystem('app-pack/memos', { type: 'ADD_MEMO' });

export type Undeclared = Expect<Equal<EntityShape<'Nope'>['anything'], unknown>>;
// An entity name only known at runtime is accepted, and reads as unknown values
declare const runtimeName: string;
const other = query(runtimeName).pickAll()[0]!;
// @ts-expect-error unknown field can't be used without narrowing
other.anything.length;
query('Memo').out('contains', runtimeName).pickAll();
// A generic helper constrained to the declared names is checked, and its rows typed
export function memosOf<E extends EntityName>(entityType: E) { return query(entityType).pickAll(); }
export type GenericHelper = Expect<Equal<ReturnType<typeof memosOf<'Memo'>>[number]['text'], string>>;

// A literal must name an entity this pack or its dependency declares
// @ts-expect-error a generic over any string can't be checked (constrain it to EntityName)
export function anyOf<E extends string>(entityType: E) { return query(entityType).pickAll(); }
// @ts-expect-error undeclared entity name
query('Nope');
// @ts-expect-error undeclared entity name in an apply list
query(['Memo', 'Nope']);
// @ts-expect-error undeclared relation target
query('Memo').out('contains', 'Nope');
// @ts-expect-error undeclared entity name
newId('Nope');

// Ids from queries and rows carry their entity type, so the next lookup is typed
const firstMemo = query('Memo').first()!;
export type QueryIdTagged = Expect<Equal<typeof firstMemo, EARS.EntityId<'Memo'>>>;
const memoFromQuery = query.ids(firstMemo).pickOne()!;
// And a created row, read back from its write
const created = create('Memo', { text: 'x', pinned: false }).row();
export type CreatedRow = Expect<Equal<typeof created.text, string>>;
export type LookupFromQueryId = Expect<Equal<typeof memoFromQuery.text, string>>;
export type RowIdTagged = Expect<Equal<(typeof tags)[number]['id'], EARS.EntityId<'Tag'>>>;
// A plain id is accepted where a tagged one is expected; another entity's id is not
const openMemo = (id: EARS.EntityId<'Memo'>) => id;
declare const plainId: EARS.EntityId;
openMemo(plainId);
[firstMemo].includes(plainId);
// @ts-expect-error a Tag id where a Memo id is expected
openMemo(tags[0]!.id);
// A tagged link result passed straight to a generic function still infers the target's shape
const uniqueById = <T extends { id?: EARS.EntityId }>(nodes: T[]): T[] => nodes;
const linkedMemos = uniqueById(query.ids(memoId).out('related', ['Memo']).pick(['text']));
export type ContextualLinkPick = Expect<Equal<(typeof linkedMemos)[number]['text'], string>>;

// Writes that know the entity name only its declared fields and store their declared types
write(memoId).set('text', 'x').set('pinned', true);
write(firstMemo).set('pinned', false);
// A created row has every field its shape requires, and may bring its id and times
create('Memo', { text: 'x', pinned: false });
create('Memo', { id: plainId, createdAt: 1, text: 'x', pinned: true, note: 'n' });
// @ts-expect-error pinned is required
create('Memo', { text: 'x' });
// @ts-expect-error and so is the row
create('Memo');
// @ts-expect-error an undeclared field
write(memoId).set('undeclared', 42);
// @ts-expect-error in a created row too
create('Memo', { text: 'x', pinned: false, extra: 1 });
// @ts-expect-error the engine writes updatedAt
write(memoId).set('updatedAt', 1);
upsert('Memo', { id: plainId, text: 'x', pinned: false });
const createdMemo = create('Memo', { text: 'x', pinned: false }).id();
export type CreateIdTagged = Expect<Equal<typeof createdMemo, EARS.EntityId<'Memo'>>>;
// @ts-expect-error a declared field's value is checked
write(memoId).set('text', 42);
// @ts-expect-error in a created row too
create('Memo', { text: 'x', pinned: 'yes' });
// @ts-expect-error and through upsert, which names the type
upsert('Memo', { id: plainId, text: 'x', pinned: 'yes' });
// A dependency's entity is checked the same way
// @ts-expect-error Tag.name is a string
write(tags[0]!.id).set('name', 1);
// A relation is no entity type, so no query starts from one: findRelations reads them
// @ts-expect-error 'Relation' names no entity
query('Relation');
// The flow model is the SDK's: available and shaped without depending on default-setup
const action = query('Action').pickAll()[0]!;
export type ActionShape = Expect<Equal<typeof action.actionFn, string>>;
// Prompts too
const prompt = query('Prompt').pickAll()[0]!;
export type PromptShape = Expect<Equal<typeof prompt.templateFn, string>>;
// Settings belong to default-setup, and the app's state (AppState) to the host: neither is the SDK's
// @ts-expect-error Settings isn't declared by either pack or the SDK
query('Settings');
// @ts-expect-error AppState isn't an entity packs see
query('AppState');
// API keys aren't graph data: the host keeps them, packs see services.secrets
// Library and notes entities belong to default-setup, not the SDK
// A flow run is a record in the run history (services.runHistory), not an entity
// @ts-expect-error RunNode isn't an entity type
query('RunNode');
// Node rows are the dependency's step node types (app-pack defines none), a hand-written one that doesn't
// narrow nodeType, and adds no required field, included
const node = query('Node').pickAll()[0]!;
export type DependencyStepNode = Expect<Equal<Extract<typeof node, { nodeType: 'ping' }>['target'], string>>;
// A plain id leaves writes unchecked
write(plainId).set('text', 42);
// @ts-expect-error undeclared entity name
create('Nope');
// @ts-expect-error undeclared entity name
upsert('Nope', { id: plainId });
`;

/** The two packs, built, in a temp dir; node_modules link the workspace or the packed packages */
/** A step in base-pack, whose node types its dependents read: the scaffolded one and a hand-written one */
async function addBaseStep(dir: string): Promise<void> {
  // produces: the step whose scaffolded types this function then rewrites
  const added = await callCli(dir, 'add', ['step', 'ping']);
  if (added.code !== 0) throw new Error(`apack pack add step failed in base-pack:\n${added.output}`);
  const types = path.join(dir, 'src', 'extensions', 'steps', 'ping', 'types.ts');
  const scaffolded = fs.readFileSync(types, 'utf-8');
  if (!/export interface PingNode extends NodeBase \{\n {2}nodeType: 'ping';/.test(scaffolded)) {
    throw new Error(`unexpected step types scaffold:\n${scaffolded}`);
  }
  fs.writeFileSync(types, scaffolded
    .replace("nodeType: 'ping';", "nodeType: 'ping';\n  target: string;")
    + '\n/** A node type that doesn\'t narrow nodeType and adds no required field */\nexport interface NoteNode extends NodeBase {\n  note?: string;\n}\n');
}

async function buildPacks(published: boolean, dependencyStamp?: { format?: number; sdkVersion?: string }): Promise<string> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'facade-typing-'));
  const modules = published ? path.join(installPublishedPackages(), 'node_modules') : path.join(REPO_ROOT, 'node_modules');
  for (const [name, files] of [['base-pack', BASE_PACK], ['app-pack', APP_PACK]] as const) {
    const dir = preparePack(parent, name, files, modules);
    if (name === 'base-pack') await addBaseStep(dir);
    // produces: the built pack whose snapshot and declarations the tests read
    const build = await callCli(dir, 'build');
    if (build.code !== 0) throw new Error(`apack pack build failed in ${name}:\n${build.output}`);
    if (name === 'base-pack' && dependencyStamp) {
      const file = path.join(dir, 'dist/types/snapshot.json');
      const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(snapshot, dependencyStamp);
      fs.writeFileSync(file, JSON.stringify(snapshot));
      fs.writeFileSync(path.join(dir, 'dist/runtime/index.cjs'), 'throw new Error("Dependency runtime must not execute for type inspection");');
      fs.writeFileSync(path.join(dir, 'dist/build/steps.build.mjs'), 'throw new Error("Dependency build code must not execute for type inspection");');
      sealPackBuild(path.join(dir, 'dist'), snapshot.manifest, snapshot.sdkVersion);
    }

  }
  write(path.join(parent, 'app-pack'), { 'src/consumer.ts': CONSUMER });
  return parent;
}

/**
 * Editor completions in a pack, from the TypeScript language service. The typed EARS types can
 * compile and pass every type check while suggestions disappear (packages/apack-sdk/TYPED-EARS.md,
 * Incidents), so these positions are checked directly. `|name|` marks a position in the source.
 */
const COMPLETIONS = `
import { EARS, query, getAttr, newId, write, create } from '#generated/ears.ts';
import { sendToSystem } from '#generated/events.ts';
declare const memoId: EARS.EntityId<'Memo'>;
sendToSystem('|systemId|', { type: 'CLEAR_MEMOS' });
sendToSystem('memos', { type: '|eventType|' });
query('Memo').pick(['|pick|']);
query('Memo').pickOne(['|pickOne|']);
query.ids(memoId).out('related', 'Memo').pick(['|outPick|']);
query('Memo').where('|where|');
query('Memo').has('|has|');
query('Memo').lacks('|lacks|');
query('Memo').orderBy('|orderBy|');
query('Memo').distinct('|distinct|');
query('Memo').groupBy('|groupBy|');
query('Memo').search('x', { fields: ['|searchFields|'] });
query('Memo').search('x', { recency: { field: '|recencyField|', halfLife: 1 } });
query('Memo').search('x').hits({ fields: ['|hitsFields|'] });
query('Memo').hybrid('x', [1], { fields: ['|hybridFields|'] });
getAttr(memoId, '|getAttr|');
newId('|newId|');
query.ids(memoId).out('related', '|out|');
query.ids(memoId).in('related', '|in|');
query.ids(memoId).ancestors('related', '|ancestors|');
query.ids(memoId).descendants('related', '|descendants|');
query.ids(memoId).both('related', '|both|');
query.all().ofType('|ofType|');
query('|query|');
query('Memo').has('txet');
write(memoId).set('|set|', true);
write(memoId).append('|append|', true);
write(memoId).delete('|delete|');
write(memoId).removeAt('|removeAt|', 0);
write(memoId).set('pinnd', true);
query.ids(memoId).out('|outKind|');
query.ids(memoId).ancestors('|ancestorsKind|');
query.ids(memoId).descendants('|descendantsKind|');
query.ids(memoId).both('|bothKind|');
query.ids(memoId).pathTo(memoId, '|pathToKind|');
query.ids(memoId).degrees('|degreesKind|');
query('Memo').rank('|rankKind|');
query('Memo').weakComponents('|weakComponentsKind|');
query('Memo').strongComponents('|strongComponentsKind|');
query('Memo').communities('|communitiesKind|');
write(memoId).link('|linkKind|', memoId);
query('Memo').linkedTo('|linkedToKind|', memoId);
write(memoId).link('relatd', memoId);
write(memoId).grant('|grantRole|');
query.all().withRole('|withRole|');
write(memoId).grant('pinnned');
create('Memo', { |createRow| });
`;
const FIELD_POSITIONS = ['pick', 'pickOne', 'outPick', 'where', 'has', 'lacks', 'orderBy', 'distinct', 'groupBy', 'searchFields', 'recencyField', 'hitsFields', 'hybridFields', 'getAttr'];
/** The fields a write may name: the declared ones, without the engine's own (`createdAt`, `updatedAt`, …) */
const WRITE_POSITIONS = ['set', 'append', 'removeAt'];
/** Relation kinds: the pack's own, its dependency's and the SDK's */
const KIND_POSITIONS = ['outKind', 'linkKind', 'linkedToKind', 'ancestorsKind', 'descendantsKind', 'bothKind', 'pathToKind', 'degreesKind', 'rankKind', 'weakComponentsKind', 'strongComponentsKind', 'communitiesKind'];
/** Roles: the pack's own, its dependency's and the SDK's */
const ROLE_POSITIONS = ['grantRole', 'withRole'];
const NAME_POSITIONS = ['query', 'newId', 'out', 'in', 'ancestors', 'descendants', 'both', 'ofType'];

/** String completions at each marked position of COMPLETIONS, and the file's diagnostics */
function completionsIn(app: string, tsconfig: string): { at: Record<string, string[]>; diagnostics: string[] } {
  const file = path.join(app, 'src', 'completions.ts');
  const markers: Record<string, number> = {};
  let removed = 0;
  const text = COMPLETIONS.replace(/\|(\w+)\|/g, (marker: string, name: string, offset: number) => {
    markers[name] = offset - removed;
    removed += marker.length;
    return '';
  });
  fs.writeFileSync(file, text);
  const config = ts.getParsedCommandLineOfConfigFile(path.join(app, tsconfig), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
  const files = [...config.fileNames, file];
  const service = ts.createLanguageService({
    getScriptFileNames: () => files,
    getScriptVersion: () => '1',
    getScriptSnapshot: (name) => (fs.existsSync(name) ? ts.ScriptSnapshot.fromString(fs.readFileSync(name, 'utf-8')) : undefined),
    getCurrentDirectory: () => app,
    getCompilationSettings: () => config.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  });
  const at = Object.fromEntries(Object.entries(markers).map(([name, position]) => [
    name,
    (service.getCompletionsAtPosition(file, position, {})?.entries ?? [])
      .filter((entry) => entry.kind === ts.ScriptElementKind.string || entry.kind === ts.ScriptElementKind.memberVariableElement)
      .map((entry) => entry.name),
  ]));
  const diagnostics = service.getSemanticDiagnostics(file).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  return { at, diagnostics };
}

/** tsconfig for the app pack's consumer under a moduleResolution: the workspace source or the packed SDK */
function writeTsconfig(app: string, moduleResolution: 'bundler' | 'node16', published: boolean): string {
  const name = `tsconfig.${moduleResolution}.json`;
  fs.writeFileSync(path.join(app, name), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: moduleResolution === 'node16' ? 'node16' : 'esnext', moduleResolution,
      strict: true, skipLibCheck: true, noEmit: true, types: ['node'],
      // Every pack sets this, the scaffold included, and it is about the pack's *own* generated code rather
      // than where @apackdev came from: codegen writes `./services.ts`, the file that is there
      // (`goal-pack-imports-name-the-file.md`), so typechecking a generated facade needs it either way. The
      // `published` split below stays what it was about — which copy of @apackdev the consumer resolves.
      allowImportingTsExtensions: true,
      ...(published ? {} : { customConditions: ['@apackdev/source'] }),
      ...(moduleResolution === 'bundler' ? { paths: { '#generated/*': ['./src/__generated__/*'] } } : {}),
    },
    // Every generated facade, not only the ones the consumer imports
    include: ['src/__generated__/**/*.ts', 'src/consumer.ts'],
    exclude: ['src/__generated__/pack-entry-fe.ts', 'src/__generated__/references.ts'],
  }));
  return name;
}

/**
 * Diagnostics in the pack's own declaration files (its dependencies' facade bundles), checked with
 * skipLibCheck off for them only: installed packages' declarations stay unchecked.
 */
function packDeclarationDiagnostics(app: string, tsconfig: string): string[] {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(app, tsconfig), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
  const declarations = config.fileNames.filter((file) => file.endsWith('.d.ts'));
  expect(declarations, 'dependency facade declarations').toContainEqual(expect.stringContaining(path.join('src', '__generated__', 'deps', 'base-pack.d.ts')));
  const program = ts.createProgram({ rootNames: config.fileNames, options: { ...config.options, skipLibCheck: false } });
  return declarations.flatMap((file) => program.getSemanticDiagnostics(program.getSourceFile(file)))
    .map((d) => `${path.relative(app, d.file?.fileName ?? '')}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

/**
 * Every question this suite asks, against one dependency layout.
 *
 * The published layout is skipped rather than absent when the packages are not built, which is what the
 * `LAYOUTS` list did by omitting the entry: a skipped case says in its name why it did not run, where a
 * list one short says nothing at all.
 */
export function facadeSuite(name: string, published: boolean, dependencyStamp?: { format?: number; sdkVersion?: string }): void {

/**
 * Turn the event loop between tests.
 *
 * A pool worker runs each case synchronously, and `await` on a resolved promise only drains microtasks, so
 * a run of them is **one** event-loop block however many `it`s it spans — and a worker that never turns
 * its loop cannot read the reply to the `onTaskUpdate` it already sent. birpc's window is 60s and vitest
 * hardcodes it, so the run fails with `[vitest-worker]: Timeout calling` while every test passes.
 *
 * This caps the file at its longest single case, for one macrotask per test.
 */
afterEach(() => new Promise<void>((resolve) => { setImmediate(resolve); }));

  describe.skipIf(published && !PACKAGES_BUILT)(`generated facades with a dependency ('${name}')`, () => {
  let parent: string;
  beforeAll(async () => { parent = await buildPacks(published, dependencyStamp); }, 4 * 60_000);
  afterAll(() => { if (parent) fs.rmSync(parent, { recursive: true, force: true }); });

  it("writes the dependency's facade types into its snapshot", () => {
    const snapshot = JSON.parse(fs.readFileSync(path.join(parent, 'base-pack', 'dist', PACK_LAYOUT.snapshot), 'utf-8'));
    expect(snapshot.facades['pack-types']).toMatch(/export type \{[^}]*PackEntityShapes[^}]*\}/);
  });

  it("gives dependents the dependency's system events without its machines", () => {
    const snapshot = JSON.parse(fs.readFileSync(path.join(parent, 'base-pack', 'dist', PACK_LAYOUT.snapshot), 'utf-8'));
    expect(snapshot.facades['pack-types']).toMatch(/export type \{[^}]*PackSystemEvents[^}]*\}/);
    expect(snapshot.facades['pack-types']).toMatch(/type: ["']ADD_TAG["']/);
    expect(snapshot.facades['pack-types']).not.toContain('StateMachine');
  });

  it.each(['bundler', 'node16'] as const)('typechecks own and dependency types under moduleResolution %s', async (moduleResolution) => {
    const app = path.join(parent, 'app-pack');
    const tsconfig = writeTsconfig(app, moduleResolution, published);
    // typecheck: the same program packDeclarationDiagnostics below builds, for the whole tree
    const result = await typecheckPack(app, tsconfig);
    expect(result.code, result.output).toBe(0);
    // skipLibCheck skips the dependency's bundled facade (src/__generated__/deps/*.d.ts), where an invalid declaration reads as any
    expect(packDeclarationDiagnostics(app, tsconfig)).toEqual([]);
  });

  it.each(['bundler', 'node16'] as const)('offers field and entity-name completions under moduleResolution %s', (moduleResolution) => {
    const app = path.join(parent, 'app-pack');
    const { at, diagnostics } = completionsIn(app, writeTsconfig(app, moduleResolution, published));
    const missing = (positions: string[], expected: string[]) =>
      positions.filter((position) => !expected.every((name) => at[position]?.includes(name)));
    expect(missing(FIELD_POSITIONS, ['text', 'pinned']), 'positions without Memo field completions').toEqual([]);
    expect(missing(NAME_POSITIONS, ['Memo', 'Tag', 'Flow', 'Prompt']), 'positions without entity-name completions').toEqual([]);
    expect(missing(WRITE_POSITIONS, ['text', 'pinned']), 'write positions without Memo field completions').toEqual([]);
    expect(at.where, 'a read offers the engine\'s fields').toContain('createdAt');
    expect(WRITE_POSITIONS.filter((position) => at[position]?.includes('createdAt')), 'write positions offering an engine field').toEqual([]);
    // delete offers the optional fields alone: a required one is replaced with set
    expect(at.delete, 'delete completions').toContain('note');
    expect(at.delete, 'delete completions').not.toContain('text');
    // A typo's error lists the fields it could have been, for a read and a write
    expect(diagnostics.find((message) => message.includes('"txet"'))).toMatch(/"text"/);
    expect(diagnostics.find((message) => message.includes('"pinnd"'))).toMatch(/"pinned"/);
    expect(missing(KIND_POSITIONS, ['related', 'tagged', 'contains']), 'positions without relation-kind completions').toEqual([]);
    expect(diagnostics.find((message) => message.includes('"relatd"'))).toMatch(/"related"/);
    expect(missing(ROLE_POSITIONS, ['pinned', 'featured', 'root_flow']), 'positions without role completions').toEqual([]);
    expect(diagnostics.find((message) => message.includes('"pinnned"'))).toMatch(/"pinned"/);
    // A created row offers the shape's fields and the identity it may bring, and never the engine's other fields
    expect(at.createRow, 'created-row completions').toEqual(expect.arrayContaining(['text', 'pinned', 'note', 'id', 'createdAt']));
    expect(at.createRow, 'created-row completions').not.toContain('entityType');
  });

  it.each(['bundler', 'node16'] as const)('offers system-id and event-type completions for sendToSystem under moduleResolution %s', (moduleResolution) => {
    const app = path.join(parent, 'app-pack');
    const { at } = completionsIn(app, writeTsconfig(app, moduleResolution, published));
    expect(at.systemId, 'system-id completions').toEqual(expect.arrayContaining(['memos', 'base-pack/calendar']));
    expect(at.eventType, 'event-type completions').toEqual(expect.arrayContaining(['ADD_MEMO', 'CLEAR_MEMOS', 'PIN_MEMO', 'UNPIN_MEMO']));
    expect(at.eventType, 'only the chosen system\'s events').not.toContain('ADD_TAG');
  });

  // query takes entity names only (ids start from query.ids), so its argument completes to the declared names
  it.each(['bundler', 'node16'] as const)('offers entity-name completions in query() under moduleResolution %s', (moduleResolution) => {
    const app = path.join(parent, 'app-pack');
    const { at } = completionsIn(app, writeTsconfig(app, moduleResolution, published));
    expect(at.query, 'entity-name completions in query()').toEqual(expect.arrayContaining(['Memo', 'Tag', 'Flow', 'Prompt']));
    expect(at.query, 'a relation is no entity').not.toContain('Relation');
    expect(at.query, 'no completion for an entity no pack here declares').not.toContain('Settings');
  });

  if (dependencyStamp) it('refuses incompatible dependency build code when compiling content', async () => {
    const app = path.join(parent, 'app-pack');
    const file = path.join(app, 'apack.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.content = { formats: { items: { format: 'json' } }, datasets: { items: { path: 'src/content/items.json', format: 'items' } } };
    fs.writeFileSync(file, JSON.stringify(manifest));
    write(app, { 'src/content/items.json': '[]' });
    const result = await callCli(app, 'build');
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('Dependency "base-pack" cannot supply build code');
    expect(result.output).not.toContain('Dependency build code must not execute');
  });
  });
}
