// The Database console's code runners, which the Database surface and `apack db query`/`exec` share
import * as os from 'node:os';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSchemaStats, untypedCreate, untypedQuery } from '@apackdev/sdk/ears';
import { consoleEars, installedEars, READ_HELPER_NAMES, runQueryCode, runTransactionCode, WRITE_HELPER_NAMES } from '../../src/database-console/index.ts';
import { testPacks } from '../../src/testing/packs.ts';
import { EARS } from '../../src/types/index.ts';
import { resetTestData, startTestRuntime } from '../../src/testing/index.ts';

process.env.APACK_ENV ??= 'test';
process.env.APACK_USER_DATA_DIR ??= os.tmpdir();
startTestRuntime();

beforeEach(() => resetTestData());

const scope = { EARS: { Entity: { Flow: 'Flow' }, RelKind: {} } };
/** Every helper is an operation, but `engineCalls`, which holds three */
const typeOf = (helper: string) => (helper === 'engineCalls' ? 'object' : 'function');

describe('the helpers console code sees', () => {
  // Spelled out, so adding or moving one is a deliberate change: the Database console, the `query` flow step and
  // `apack db query`/`exec` all rest on what a query can and cannot reach
  it('gives a query these, and nothing that writes', async () => {
    expect([...READ_HELPER_NAMES].sort()).toEqual([
      'engineCalls', 'findRelations', 'getAttr', 'getRelation', 'getRoles', 'getRow', 'getSchemaStats', 'query',
    ]);
    for (const name of READ_HELPER_NAMES) {
      await expect(runQueryCode(`return typeof ${name}`, scope), name).resolves.toBe(typeOf(name));
    }
  });

  it('gives a transaction the write helpers as well', async () => {
    expect([...WRITE_HELPER_NAMES].sort()).toEqual([
      'create', 'removeRelation', 'upsert', 'write',
    ]);
    for (const name of [...READ_HELPER_NAMES, ...WRITE_HELPER_NAMES]) {
      await expect(runTransactionCode(`return typeof ${name}`, scope), name).resolves.toBe(typeOf(name));
    }
  });
});

describe('runQueryCode', () => {
  it('returns what the code returns, reading the installed engine and the EARS it is given', async () => {
    // The row brings its code, so no numbering sequence joins the entities the stats count
    untypedCreate('Flow', { id: 'Flow-1', shortCode: 'FLW-1', label: 'Main', flowType: 'workflow' });
    await expect(runQueryCode("return query(EARS.Entity.Flow).pickAll().map((f) => f.label)", scope)).resolves.toEqual(['Main']);
    await expect(runQueryCode('return getRow("Flow-1")?.label', scope)).resolves.toBe('Main');
    await expect(runQueryCode('return getSchemaStats().entities', scope)).resolves.toEqual({ Flow: 1 });
  });

  it("can't write: every write helper is undefined, and the error is the code's", async () => {
    for (const name of WRITE_HELPER_NAMES) {
      await expect(runQueryCode(`return ${name}`, scope)).rejects.toThrow(new Error(`${name} is not defined`));
    }
    expect(untypedQuery('Flow').ids()).toEqual([]);
  });

  it('refuses blank code rather than answering undefined', async () => {
    // Whitespace alone is a function body that returns nothing, which would read as a query that found nothing
    for (const blank of ['', '   ', '\n\t ']) {
      await expect(runQueryCode(blank, scope)).rejects.toThrow('No code to run');
      await expect(runTransactionCode(blank, scope)).rejects.toThrow('No code to run');
    }
  });
});

describe('runTransactionCode', () => {
  it('writes with the write helpers and reads with the read helpers', async () => {
    const id = await runTransactionCode("const id = create(EARS.Entity.Flow, { label: 'New', flowType: 'workflow' }).id(); return getRow(id)?.label", scope);
    expect(id).toBe('New');
    expect(untypedQuery('Flow').ids()).toHaveLength(1);
  });

  it('keeps none of its writes when it throws part way, and prefixes its error', async () => {
    await expect(runTransactionCode("create(EARS.Entity.Flow, { label: 'Lost', flowType: 'workflow' }); throw new Error('boom')", scope)).rejects
      .toThrow('Transaction failed: boom\n  Nothing it wrote was kept: a transaction is undone as a whole.');
    expect(untypedQuery('Flow').ids()).toEqual([]);
  });

  it('refuses code that would split the unit: an await, or a returned promise, keeping nothing', async () => {
    await expect(runTransactionCode("await 1; create(EARS.Entity.Flow, { label: 'Lost', flowType: 'workflow' })", scope)).rejects.toThrow(/^Transaction failed:/);
    await expect(runTransactionCode("create(EARS.Entity.Flow, { label: 'Lost', flowType: 'workflow' }); return Promise.resolve(3)", scope)).rejects
      .toThrow(/^Transaction failed: transaction code must be synchronous, and this returned a promise/);
    expect(untypedQuery('Flow').ids()).toEqual([]);
  });

  it('says what a returned promise kept: the writes after its first await, outside the unit', async () => {
    const code = "return (async () => { create(EARS.Entity.Flow, { label: 'Undone', flowType: 'workflow' }); await 0; create(EARS.Entity.Flow, { label: 'Kept', flowType: 'workflow' }); })()";
    await expect(runTransactionCode(code, scope)).rejects
      .toThrow(/What it wrote before its first await was undone; what it writes after that runs outside the transaction and is kept/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(untypedQuery('Flow').pick(['label']).map((row) => row.label)).toEqual(['Kept']);
  });
});

describe('engineCalls', () => {
  it("refuses in an app that doesn't count its calls, naming what it is for", async () => {
    // The test runtime is no development app: it binds no diagnostics
    await expect(runQueryCode('return engineCalls.report()', scope)).rejects.toThrow(/development app/);
  });
});

describe('getSchemaStats', () => {
  it('counts entities, attribute kinds, relation kinds and roles', () => {
    untypedCreate('Flow', { id: 'Flow-1', label: 'a', flowType: 'workflow' });
    untypedCreate('Flow', { id: 'Flow-2', label: 'b', flowType: 'workflow' }).link('contains', 'Flow-1').grant('root_flow');
    const stats = getSchemaStats();
    expect(stats.entities.Flow).toBe(2);
    expect(stats.attributes.label).toEqual({ entityCount: 2, totalValues: 2 });
    expect(stats.relations.contains).toEqual({ total: 1, uniqueSources: 1, uniqueTargets: 1 });
    expect(stats.roles).toEqual({ root_flow: 1 });
  });
});

// Console code queries the whole database, so it names every installed pack's entity types, whichever pack runs the
// console: the Database surface and `apack db` read the same names
describe('the EARS console code sees', () => {
  it("adds the packs' entity types and relation kinds to the SDK's, keeping the SDK's own", () => {
    const ears = consoleEars({ entities: { Memo: 'Memo' }, relKinds: { mentions: 'mentions' }, roles: {} }) as
      { Entity: Record<string, string>; RelKind: Record<string, string> };

    expect(ears.Entity).toMatchObject({ Memo: 'Memo', Flow: 'Flow' });
    expect(ears.RelKind).toMatchObject({ mentions: 'mentions', CONTAINS: 'contains' });
  });

  it("names a registered pack's entity type, not only the pack whose console it is", async () => {
    const ears = installedEars() as { Entity: Record<string, string> };
    expect(ears.Entity.Flow).toBe('Flow');

    // Another installed pack's type, as its registration declares it
    startTestRuntime({ entityTypes: ['Memo', 'Note'] });
    testPacks.earsEntities.set('Memo', 'Memo');
    untypedCreate('Memo', { id: 'Memo-1' as EARS.EntityId }).set('title', 'theirs');
    untypedCreate('Note', { id: 'Note-1' as EARS.EntityId }).set('title', 'ours');

    await expect(runQueryCode('return EARS.Entity.Memo', { EARS: installedEars() })).resolves.toBe('Memo');
    await expect(runQueryCode('return query(EARS.Entity.Memo).ids()', { EARS: installedEars() }))
      .resolves.toEqual(['Memo-1']);

    // `Note` has rows and no pack declares it. Reading it as `undefined` made `query` answer with the whole
    // database — both entities here, where one was asked for — so the namespace refuses the name instead.
    await expect(runQueryCode('return query(EARS.Entity.Note).ids()', { EARS: installedEars() }))
      .rejects.toThrow('"Note" is not an entity type this database can account for');
  });
});

describe('a name the database cannot account for', () => {
  beforeEach(() => {
    startTestRuntime({ entityTypes: ['Memo'] });
    testPacks.earsEntities.set('Memo', 'Memo');
    testPacks.earsRelKinds.set('MENTIONS', 'mentions');
  });

  const ears = () => installedEars() as Record<string, Record<string, string>>;

  it('says what is known, and what would supply the rest', () => {
    expect(() => ears().Entity.Bookmark).toThrow(/^"Bookmark" is not an entity type this database can account for\./);
    expect(() => ears().Entity.Bookmark).toThrow(/Known: .*\bMemo\b/);
    expect(() => ears().RelKind.REFERENCES).toThrow('"REFERENCES" is not a relation kind this database can account for');

    const withHint = consoleEars({ entities: { Memo: 'Memo' }, relKinds: {}, roles: {} }, { hint: 'Try --schema-from.' }) as Record<string, Record<string, string>>;
    expect(() => withHint.Entity.Bookmark).toThrow('Try --schema-from.');
  });

  // `db script` is handed this object raw, so everything a script does with it has to keep working
  it('can still be enumerated, spread and serialised', () => {
    const EARS_SCOPE = ears();
    expect(Object.keys(EARS_SCOPE.Entity)).toContain('Memo');
    expect({ ...EARS_SCOPE.Entity }.Memo).toBe('Memo');
    expect(JSON.parse(JSON.stringify(EARS_SCOPE.Entity)).Memo).toBe('Memo');
    expect(() => JSON.stringify(EARS_SCOPE)).not.toThrow();
    expect(Object.entries(EARS_SCOPE.RelKind).map(([name]) => name)).toContain('MENTIONS');
  });

  // Asking whether a name is there is a question, and awaiting a result must not look like asking for one
  it('answers a probe rather than throwing', async () => {
    expect('Bookmark' in ears().Entity).toBe(false);
    expect('Memo' in ears().Entity).toBe(true);
    await expect(Promise.resolve(ears().Entity)).resolves.toBeDefined();
  });
});
