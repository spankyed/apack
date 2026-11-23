// A built pack's content runtime (dist/build/content-runtime.mjs) loaded into a bare SDK test runtime: no
// host, no app. default-setup's is the example: a Note written through it gets default-setup's rows.
import { type EARS } from '@elmdb/ears';
import { boundEars as ears } from '@apackdev/sdk/ears';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerContentRuntime, resetTestData, startTestRuntime } from '../../src/testing/index.ts';
import type { ContentRuntime } from '../../src/framework/content-runtime.ts';
import { compileBuiltinFormat } from '../../src/build/content/items.ts';
import { createFormatApplier } from '../../src/content/format-applier.ts';
import { findRelations } from '@apackdev/sdk/ears';
import type { PackManifest } from '../../src/build/manifest.ts';

const DEFAULT_SETUP = path.resolve(import.meta.dirname, '../../../../.temp/shipped-distribution/shipped-packs/default-setup');
const FACET = path.join(DEFAULT_SETUP, 'build', 'content-runtime.mjs');
// CI stages the shipped release and requires the facet.
const built = fs.existsSync(FACET);
if (!built && process.env.REQUIRE_CONTENT_RUNTIME) throw new Error(`${FACET} is required (REQUIRE_CONTENT_RUNTIME) but not built`);

describe.skipIf(!built)("a built pack's content runtime", () => {
  let dir: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-runtime-'));
    process.env.APACK_ENV ??= 'test';
    process.env.APACK_USER_DATA_DIR ??= dir;
    startTestRuntime();
    const { contentRuntime } = await import(pathToFileURL(FACET).href) as { contentRuntime: ContentRuntime };
    registerContentRuntime(contentRuntime);
    resetTestData();
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("registers the pack's repositories and content writers, so applying goes through them", async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DEFAULT_SETUP, 'apack.json'), 'utf-8')) as PackManifest;
    const source = path.join(dir, 'notes');
    fs.mkdirSync(path.join(source, 'plan'), { recursive: true });
    fs.writeFileSync(path.join(source, 'intro.md'), '---\ntitle: Intro\n---\nSee the [plan](apack-ref://note/Note-plan-target).\n');
    fs.writeFileSync(path.join(source, 'plan', 'index.md'), '---\ntitle: Plan\ntype: tasklist\n---\nSteps.\n');
    fs.writeFileSync(path.join(source, 'plan', 'first.md'), '---\ntype: task\n---\nDo it.\n');
    const compiled = path.join(dir, 'compiled');
    fs.mkdirSync(compiled);
    fs.writeFileSync(path.join(compiled, 'content.json'), JSON.stringify({ version: 1, packId: 'default-setup', entries: [] }));
    fs.writeFileSync(path.join(compiled, 'notes.content.json'), JSON.stringify({ records: compileBuiltinFormat('notes', manifest.content!.formats!.notes, source) }));

    const format = manifest.content!.formats!.notes;
    const counts = createFormatApplier({ key: 'notes', entities: ['Note'], identity: format.identity, relKind: format.tree?.relKind }).apply({ compiledDir: compiled, log: () => {} });
    expect(counts).toEqual({ created: 3, updated: 0, skipped: 0 });

    const notes = (ears().query('Note').where('title', 'Intro').pickAll() as Array<Record<string, unknown> & { id: EARS.EntityId }>);
    // What noteCommands writes and a bare record doesn't carry: the note went through default-setup's hooks
    expect(notes[0]).toMatchObject({ hideCompletedChildren: false, lastSeen: 0 });
    // A note's references index the notes its links name that exist; this one names a note there is none of
    expect(findRelations({ source: notes[0].id, kind: 'references' })).toEqual([]);
    const [plan] = (ears().query('Note').where('title', 'Plan').pickAll() as Array<Record<string, unknown> & { id: EARS.EntityId }>);
    expect(findRelations({ source: plan.id, kind: 'contains' })).toHaveLength(1);
  });
});
