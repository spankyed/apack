// A pack that depends on default-setup content Notes and documents from its own markdown
// (tests/_support/fixtures/dependent-pack): its notes through an entry naming default-setup's notes format, its
// documents through the SDK's own `documents` key, and no field maps, compiler modules or content writers of
// its own. Its notes go through default-setup's Note hooks and its documents through the SDK's compiler and
// writers, so it gets the rows default-setup's own entries content from the same sources: NOTE shortCodes,
// display order, nesting, REFERENCES links, DOC shortCodes, sections, media and contentHash.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildPackConfigFromManifest, compilePack, formatEntities, generatePackFiles, resolveContentSources, type ContentDependency } from '@apackdev/pack-build';
import { parseManifest, type PackManifest, type PackSnapshot } from '@apackdev/pack-format';
import { createDocumentsApplier, createFormatApplier } from '@apackdev/sdk/content';
import { untypedCreate } from '@apackdev/sdk/ears';
import type { EARS } from '#generated/ears.ts';
import { PACK_DIR, resetDatabase, snapshot } from './harness.ts';
import { noteRow } from '../_support/rows.ts';

const FIXTURE = path.join(PACK_DIR, 'tests/_support/fixtures/dependent-pack');
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'apack.json'), 'utf-8')) as PackManifest;
/** default-setup as a dependent's build sees it: its built snapshot and build dir */
const depSnapshot = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'dist/types/snapshot.json'), 'utf-8')) as PackSnapshot;
const dependencies = new Map<string, ContentDependency>([['default-setup', { manifest: depSnapshot.manifest, buildDir: path.join(PACK_DIR, 'dist/build') }]]);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function compile(packDir: string, pack: PackManifest, deps?: ReadonlyMap<string, ContentDependency>): Promise<string> {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependent-pack-'));
  dirs.push(outputDir);
  await compilePack({ packDir, outputDir, packConfig: await buildPackConfigFromManifest(pack, packDir, { dependencies: deps }) });
  return outputDir;
}

/** Content each compiled format key, and the documents key, the way the generated appliers.ts registers them */
function importAll(compiledDir: string, pack: PackManifest, packDir: string, deps?: ReadonlyMap<string, ContentDependency>) {
  return Object.fromEntries(Object.entries(resolveContentSources(pack, packDir, deps)).flatMap(([key, content]) => {
    if (key === 'documents') return [[key, createDocumentsApplier().apply({ compiledDir, log: () => {} })]];
    if (content.kind !== 'format') return [];
    const { identity, tree, media } = content.format;
    return [[key, createFormatApplier({ key, entities: formatEntities(content.format), identity, relKind: tree?.relKind, media: !!media }).apply({ compiledDir, log: () => {} })]];
  }));
}

describe('a pack depending on default-setup content with its notes format and the SDK documents key', () => {
  it("declares a path and default-setup's format for its notes, only a path for its documents, and no hooks", async () => {
    expect(messagesOf(parseManifest(manifest))).toEqual([]);
    expect(Object.keys(manifest.content!.sources!['team-notes'] as object).sort()).toEqual(['format', 'path']);
    expect(manifest.content!.sources!.documents).toBe('src/content/documents');
    const files = await generatePackFiles(manifest, { packRoot: FIXTURE, depSnapshots: new Map([['default-setup', depSnapshot]]) });
    expect(files['src/__generated__/appliers.ts']).toContain('"key":"team-notes"');
    expect(files['src/__generated__/appliers.ts']).toContain('createDocumentsApplier()');
    expect(files['src/__generated__/pack-entry.ts']).not.toContain('contentWriters');
    // Without the dependency, its formats can't be resolved
    await expect(generatePackFiles({ ...manifest, dependencies: {} }, { packRoot: FIXTURE })).rejects.toThrow(/default-setup/);
  });

  it('gets DOC shortCodes, order, nesting, sections, media and REFERENCES from the formats and writers', async () => {
    resetDatabase();
    // The note the handbook links to: a content note's id is made when it is written, so a link by id reaches a note
    // that is already there, and a reference is indexed only to a note that exists
    untypedCreate('Note', { id: 'Note-roadmap-plan' as EARS.EntityId, ...noteRow({ title: 'Plan' }) });
    const counts = importAll(await compile(FIXTURE, manifest, dependencies), manifest, FIXTURE, dependencies);
    expect(counts).toEqual({
      'team-notes': { created: 4, updated: 0, skipped: 0 },
      documents: { created: 2, updated: 0, skipped: 0 },
    });

    const { rows, relations, media } = snapshot();
    expect(rows['Note:Team Handbook']).toMatchObject({ icon: '📘', favorite: true, lastSeen: 0, hideCompletedChildren: false, contentHash: expect.any(String) });
    expect(rows['Note:Roadmap']).toMatchObject({ noteType: 'tasklist', displayOrder: 1 });
    expect(rows['Note:Roadmap/ship it']).toMatchObject({ noteType: 'task', displayOrder: 0, completed: false });
    expect(rows['Note:Roadmap/write docs']).toMatchObject({ noteType: 'task', displayOrder: 1, completed: true });
    expect(rows['Collection:Team Playbooks']).toMatchObject({ description: 'How the team runs things', contentHash: expect.any(String) });
    expect(rows['Document:On-call']).toMatchObject({
      shortCode: expect.stringMatching(/^DOC-\d+$/),
      tags: ['ops', 'rota'],
      content: [
        { type: 'markdown', text: 'Page the owner first. ![rota](media://Document:On-call/rota.png)' },
        { type: 'list', items: ['Acknowledge', 'Mitigate'] },
      ],
    });
    expect(media).toEqual(['Document:On-call/rota.png=ROTA']);
    expect(relations).toEqual(expect.arrayContaining([
      'Note:Roadmap --contains--> Note:Roadmap/ship it',
      'Note:Roadmap --contains--> Note:Roadmap/write docs',
      'Note:Team Handbook --references--> Note:Plan',
      'Collection:Team Playbooks --contains--> Document:On-call',
    ]));
  });

  it("content the same rows as default-setup's own entries on the same sources", async () => {
    resetDatabase();
    importAll(await compile(FIXTURE, manifest, dependencies), manifest, FIXTURE, dependencies);
    const dependent = snapshot();

    resetDatabase();
    const source = (dir: string) => path.relative(PACK_DIR, path.join(FIXTURE, 'src/content', dir));
    const own = {
      ...depSnapshot.manifest, steps: undefined, artifacts: undefined, blocks: undefined,
      content: {
        ...depSnapshot.manifest.content,
        artifacts: undefined,
        sources: { 'team-notes': { path: source('team-notes'), format: 'notes' }, documents: source('documents') },
      },
    } as PackManifest;
    importAll(await compile(PACK_DIR, own), own, PACK_DIR);

    expect(dependent).toEqual(snapshot());
  });
});

function messagesOf(result: { diagnostics: { message: string }[] }): string[] {
  return result.diagnostics.map(issue => issue.message);
}
