/**
 * Tests verifying that default-setup imports from @apackdev/sdk resolve to the
 * runtime the harness binds.
 */
import { untypedCreate } from '@apackdev/sdk/ears';
import {
  query, write, create
} from '#generated/ears.ts';
import { resetTestData } from '@apackdev/sdk/testing';
import { EARS } from '#generated/ears.ts';

describe('Tier 1 — EARS delegates', () => {
  beforeEach(() => resetTestData());

  it('create creates and retrieves an entity', () => {
    const id = untypedCreate(EARS.Entity.Action, { label: 'test-action', input: {}, actionFn: 'return 1' }).id();
    expect(id).toBeDefined();
    expect(id).toMatch(/^Action-/);

    const label = query.ids(id).pickOne(['label'])?.label;
    expect(label).toBe('test-action');
  });

  it('create numbers an Action with its short code', () => {
    const entity = create(EARS.Entity.Action, { input: {}, label: 'SDK Test', actionFn: 'noop()' }).row();
    expect(entity.id).toMatch(/^Action-/);
    expect(entity.label).toBe('SDK Test');
    expect(entity.shortCode).toMatch(/^ACT-/);
    expect(entity.createdAt).toBeTypeOf('number');
  });

  it('a row by id, by type and by a field reads back', () => {
    const entity = create(EARS.Entity.Action, { input: {}, label: 'Findable', actionFn: 'fn()', category: 'test' }).row();

    expect(query.ids(entity.id).pickOne()).toBeDefined();
    expect(query(EARS.Entity.Action as any).pickAll().length).toBe(1);
    expect(query(EARS.Entity.Action as any).where('category', 'test').pickAll().length).toBe(1);
  });

  it('query.withTrashed reaches an entity in the trash, which a plain query does not', () => {
    const entity = create(EARS.Entity.Action, { input: {}, label: 'ToDelete', actionFn: 'fn()' }).row();
    write(entity.id).trash(5);

    expect(query.ids(entity.id).pickOne()).toBeUndefined();
    expect(query.withTrashed.ids(entity.id).pickOne(['trashedAt'])?.trashedAt).toBe(5);
  });

  it('query.ids(id).exists() answers for existing entities', () => {
    const entity = create(EARS.Entity.Action, { input: {}, label: 'Exists', actionFn: 'fn()' }).row();
    expect(query.ids(entity.id).exists()).toBe(true);
    expect(query.ids('Action-nonexistent' as any).exists()).toBe(false);
  });

});

describe('Tier 2 — EARS types', () => {
  it('SDK EARS namespace exports its entities and helpers, a relation being none', async () => {
    const { EARS: sdkEARS } = await import('@apackdev/sdk/types');
    expect(sdkEARS.Entity.Flow).toBe('Flow');
    expect('Relation' in sdkEARS.Entity).toBe(false);
    expect(typeof sdkEARS.AttrKind.Custom).toBe('function');
    expect(sdkEARS.RelKind.CONTAINS).toBe('contains');
  });

  it('generated EARS registry has domain entities', () => {
    expect(EARS.Entity.Action).toBe('Action');
    expect(EARS.Entity.Thread).toBe('Thread');
    expect(EARS.Entity.Flow).toBe('Flow');
  });
});

describe('Tier 3 — System Framework delegates', () => {
  it('defineSystem is callable', async () => {
    const { defineSystem } = await import('@apackdev/sdk/framework');
    expect(typeof defineSystem).toBe('function');
  });

  it('safeEvents is exported', async () => {
    const { safeEvents } = await import('@apackdev/sdk/helpers');
    expect(typeof safeEvents).toBe('function');
  });

  it('the id grammar is exported', async () => {
    const { FEATURE_ID_PATTERN, PACK_ID_PATTERN } = await import('@apackdev/sdk/ids');
    expect(PACK_ID_PATTERN.test('default-setup')).toBe(true);
    expect(FEATURE_ID_PATTERN.test('notes')).toBe(true);
  });
});

describe('Tier 4 — Logger delegate', () => {
  it('createLogger returns a logger with standard methods', async () => {
    const { createLogger } = await import('@apackdev/sdk/logger');
    const logger = createLogger('test-logger');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});

describe('Tier 5 — Templates and app info', () => {
  it('executeTemplate runs a prompt function body with its params', async () => {
    const { executeTemplate } = await import('@apackdev/sdk/templates');
    expect(executeTemplate('return `Hi ${params.name}`', { name: 'Ada' })).toBe('Hi Ada');
  });

});

describe('Tier 6 — Utility delegates', () => {
  it('path utilities are callable', async () => {
    const { createExportDir, ensureDirectoryExists } = await import('@apackdev/sdk/utils');
    expect(typeof createExportDir).toBe('function');
    expect(typeof ensureDirectoryExists).toBe('function');
  });

  // A pack's own data dir is reached through the generated facade, which binds its id — the SDK's
  // `_packDataDir` takes one and no pack writes its own. The name is checked, so a pack cannot climb out.
  it('this pack\'s data directory is namespaced to it', async () => {
    const { getDataDirPath } = await import('#generated/paths.ts');
    expect(getDataDirPath('models-cache')).toMatch(/pack-data[/\\]default-setup[/\\]models-cache$/);
    expect(() => getDataDirPath('../..')).toThrow(/isn't a usable data directory name/);
  });

  it('media utilities are callable', async () => {
    const { extractMediaRefs, copyMediaByRef, restoreJsonMediaRefs } = await import('@apackdev/sdk/utils');
    expect(typeof extractMediaRefs).toBe('function');
    expect(typeof copyMediaByRef).toBe('function');
    expect(typeof restoreJsonMediaRefs).toBe('function');
  });

  it('export utilities are callable', async () => {
    const { writeExportJson, stripInternalFields, toSlug } = await import('@apackdev/sdk/utils');
    expect(typeof writeExportJson).toBe('function');
    expect(typeof stripInternalFields).toBe('function');
    expect(typeof toSlug).toBe('function');
  });

  it('randomId is callable', async () => {
    const { randomId } = await import('@apackdev/sdk/utils');
    expect(typeof randomId).toBe('function');
  });

  it('BinaryOperator is accessible', async () => {
    const { BinaryOperator } = await import('@apackdev/sdk/utils');
    expect(BinaryOperator).toBeDefined();
  });

});
