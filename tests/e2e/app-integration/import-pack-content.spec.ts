// Settings → Import Pack Content end to end: a content directory compiled from default-setup's own content
// entries (a notes markdown tree and its commands, the SDK's document compiler), previewed from its content.json,
// imported with an item deselected, then imported again in keep-existing mode. The imported document's image,
// which the API copies into its media folder, loads through main's media:// protocol.
import type { PackContentPreview } from '@apackdev/sdk/content';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildPackConfigFromManifest, compilePack, type PackManifest } from '@apackdev/sdk/build';
import { test, expect } from '@apackdev/testing';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const PACK_DIR = path.join(ROOT, 'packages/default-setup');
const RUN = Date.now().toString(36);
const PIC = `e2e-pic-${RUN}.png`;
// A 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

type PackContentImport = {
  status: string;
  // The published type rather than a copy of its shape: a restatement here went on compiling after the
  // field was renamed, so the one spec that reads a preview was the last thing to know
  preview: PackContentPreview | null;
  selection: Record<string, string[]>;
  result: Record<string, { created: number; updated: number; skipped: number; errors?: string[] }> | null;
  error: string | null;
};

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Compiles default-setup's notes and commands entries over fresh sources into a content directory */
async function compileContent(work: string): Promise<string> {
  write(path.join(work, 'notes/e2e-plan/index.md'), `---\ntitle: E2E Plan ${RUN}\ntype: tasklist\n---\nThe plan.\n`);
  write(path.join(work, 'notes/e2e-plan/first-step.md'), `---\ntitle: E2E Step ${RUN}\ntype: task\n---\nDo it.\n`);
  write(path.join(work, 'notes/e2e-skipped.md'), `---\ntitle: E2E Skipped ${RUN}\n---\nNot imported.\n`);
  write(path.join(work, 'commands/e2e-guide.md'), `---\nname: "E2E Guide ${RUN}"\ntags: [e2e]\n---\nA guide.\n\n![pic](media/${PIC})\n`);
  fs.mkdirSync(path.join(work, 'commands/media'), { recursive: true });
  fs.writeFileSync(path.join(work, 'commands/media', PIC), PNG);

  const manifest = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'apack.json'), 'utf-8')) as PackManifest;
  const sources = manifest.content!.sources!;
  const entry = (key: string, source: string) => ({ ...(sources[key] as object), path: path.relative(PACK_DIR, source) });
  // Documents are written by an applier the pack registers for a key it declares, and commands is
  // default-setup's one document key
  const pack = { ...manifest, steps: undefined, content: { ...manifest.content, datasets: undefined, sources: { notes: entry('notes', path.join(work, 'notes')), commands: entry('commands', path.join(work, 'commands')) } } } as PackManifest;
  const outputDir = path.join(work, 'compiled');
  const { tsImport } = await import('tsx/esm/api');
  await compilePack({
    packDir: PACK_DIR,
    outputDir,
    packConfig: await buildPackConfigFromManifest(pack, PACK_DIR),
    importModule: (file) => tsImport(file, import.meta.url) as Promise<Record<string, unknown>>,
  });
  return outputDir;
}

/** Every file under a directory */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test('previews a compiled content directory by its content.json and imports the selected items', async ({ app, appPage, electronApp }) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-import-content-'));
  try {
    const directory = await compileContent(work);
    await app.navigate('host/settings');

    const send = (event: Record<string, unknown>) => appPage.evaluate((e) => {
      (window as any).applicationState.system.get('host/settings').send(e);
    }, event);
    const importState = () => appPage.evaluate(() => (window as any).applicationState.system.get('host/settings').getSnapshot().context.packContentImport) as Promise<PackContentImport>;
    const waitForStatus = (status: string) => appPage.waitForFunction(
      (s) => ['error', s].includes((window as any).applicationState.system.get('host/settings').getSnapshot().context.packContentImport.status),
      status,
    );

    await send({ type: 'PACK_CONTENT.PREVIEW', directory });
    await waitForStatus('selecting');
    const previewed = await importState();
    expect(previewed.error).toBeNull();
    expect(previewed.preview!.content).toEqual({
      commands: [{ key: `E2E Guide ${RUN}` }],
      notes: [{ key: `E2E Plan ${RUN}`, childCount: 1 }, { key: `E2E Skipped ${RUN}` }],
    });
    expect(previewed.preview!.unavailable).toEqual([]);
    expect(previewed.selection).toEqual({ commands: [`E2E Guide ${RUN}`], notes: [`E2E Plan ${RUN}`, `E2E Skipped ${RUN}`] });

    await send({ type: 'PACK_CONTENT.TOGGLE_ITEM', key: 'notes', item: `E2E Skipped ${RUN}` });
    await send({ type: 'PACK_CONTENT.CONFIRM_IMPORT' });
    await waitForStatus('success');
    const imported = await importState();
    expect(imported.error).toBeNull();
    expect(imported.result!.notes).toEqual({ created: 2, updated: 0, skipped: 0 });
    expect(imported.result!.commands).toEqual({ created: 1, updated: 0, skipped: 0 });

    // The API copied the image into the document's media folder, wherever it keeps media; main serves it from there
    const userData = await electronApp.evaluate(({ app: electron }) => electron.getPath('userData'));
    const copies = filesUnder(userData).filter((file) => path.basename(file) === PIC);
    expect(copies).toHaveLength(1);
    const documentId = path.basename(path.dirname(copies[0]));
    const loaded = await appPage.evaluate((src) => new Promise<{ width: number } | { error: true }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth });
      img.onerror = () => resolve({ error: true });
      img.src = src;
    }), `media://${documentId}/${PIC}`);
    expect(loaded).toEqual({ width: 1 });

    // The same items again, keeping what exists: every imported row is found
    await send({ type: 'PACK_CONTENT.PREVIEW', directory });
    await waitForStatus('selecting');
    await send({ type: 'PACK_CONTENT.TOGGLE_ITEM', key: 'notes', item: `E2E Skipped ${RUN}` });
    await send({ type: 'PACK_CONTENT.SET_MODE', mode: 'keep-existing' });
    await send({ type: 'PACK_CONTENT.CONFIRM_IMPORT' });
    await waitForStatus('success');
    const kept = await importState();
    expect(kept.result!.notes).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(kept.result!.commands).toEqual({ created: 0, updated: 0, skipped: 1 });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
