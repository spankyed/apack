import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EarsDatabase } from '../../src/index.ts';
import { exportLogicalSnapshot, openDatabase, stageLogicalSnapshot } from '../../src/sqlite/index.ts';
const roots: string[] = [], stores: EarsDatabase[] = [];
afterEach(() => { for (const db of stores.splice(0)) db.close(); for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'ears-snapshot-api-')); roots.push(path);
  const db = openDatabase({ path: join(path, 'source'), syncs: false, schema: { types: { Row: { required: [],
    embed: { from: ['text'], model: 'snapshot', dims: 3 } } }, relations: {}, roles: [] } }); stores.push(db);
  const e = createEarsEngine({ database: db }); e.create('Row', { id: 'Row-one', text: 'retained', negative: -0, bytes: new Uint8Array([0, 255]) });
  const pending = e.pendingEmbeddings('Row'); e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
  return { path, db, e, stage: join(path, 'stage') };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('app-only logical snapshot API', () => {
  it('returns only a closed audited child store, preserves the source and removes its ingestion spool', async () => {
    const f = fixture(), sequence = f.e.lastCommit();
    const result = await stageLogicalSnapshot(exportLogicalSnapshot(f.db), f.stage);
    expect(result).toMatchObject({ path: join(f.stage, 'store'), sequence, audit: { ok: true, checkedEntities: 1 } });
    expect(readdirSync(f.stage)).toEqual(['store']); expect(existsSync(join(f.stage, 'data.sqlite3'))).toBe(false);
    const restored = openDatabase({ path: result.path, readOnly: true }); stores.push(restored);
    const e = createEarsEngine({ database: restored });
    expect(Object.is(e.getAttr('Row-one', 'negative'), -0)).toBe(true); expect(e.getAttr('Row-one', 'bytes')).toEqual(new Uint8Array([0, 255]));
    expect(e.query('Row').near([1, 0, 0]).ids()).toEqual(['Row-one']); expect(f.e.lastCommit()).toBe(sequence);
  });
  it('refuses an existing container without consuming input or taking ownership', async () => {
    const f = fixture(), marker = join(f.path, 'incumbent'); writeFileSync(marker, 'retained'); let read = false;
    async function* input() { read = true; yield new Uint8Array(); }
    await expect(stageLogicalSnapshot(input(), f.path)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(read).toBe(false); expect(readFileSync(marker, 'utf8')).toBe('retained');
  });
  it('removes its container and retains the input error before any store can be published', async () => {
    const f = fixture(), error = Object.assign(new Error('input IO'), { code: 'EIO' }); let closed = false;
    async function* input() { try { yield Buffer.from('APACK-EARS-SQLITE-LOGICAL-1\n'); throw error; } finally { closed = true; } }
    await expect(stageLogicalSnapshot(input(), f.stage)).rejects.toBe(error);
    expect(closed).toBe(true); expect(existsSync(f.stage)).toBe(false);
    await expect(stageLogicalSnapshot(exportLogicalSnapshot(f.db), f.stage)).resolves.toMatchObject({ audit: { ok: true } });
  });
  it('refuses a frame limit and trailing bytes without leaving staging behind', async () => {
    const f = fixture();
    await expect(stageLogicalSnapshot(exportLogicalSnapshot(f.db), f.stage, { maxFrameBytes: 0 })).rejects.toMatchObject({ code: 'DUMP_INVALID' });
    expect(existsSync(f.stage)).toBe(false);
    async function* input() { yield* exportLogicalSnapshot(f.db); yield Buffer.from([0]); }
    await expect(stageLogicalSnapshot(input(), f.stage)).rejects.toMatchObject({ code: 'DUMP_INVALID' });
    expect(existsSync(f.stage)).toBe(false);
  });
  it('requires a real SQLite export owner', () => {
    expect(() => exportLogicalSnapshot({} as EarsDatabase)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED' }));
  });
});
