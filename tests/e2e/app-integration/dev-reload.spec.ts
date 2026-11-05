// `apack pack dev` and the built-in pack's watcher rebuild a pack and then POST /dev/reload. The reload has to
// leave the pack as a boot would: its runtime pointed at the compiled content, and content a rebuild changed
// imported. This drives the real endpoint against the running app, and the library's tree is what shows it:
// the document it renames is one of default-setup's command documents, compiled under its `commands` key.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { API_TOKEN_HEADER } from '@apackdev/sdk/utils/pure';
import { test, expect } from '@apackdev/testing';
import { PACK_LAYOUT, readPackBuild, sealPackBuild } from '@apackdev/host/packs';
import { libraryDocuments } from './library-documents.ts';

const DIST = path.resolve(import.meta.dirname, '../../../packages/default-setup/dist');
const CONTENT_FILE = path.join(DIST, 'runtime/content/commands.content.json');
const WRITTEN_DOCUMENT = 'Codex commands';
const REBUILT_DOCUMENT = 'Codex commands after a rebuild';

interface LibraryRecord { entity?: string; name?: string; children?: LibraryRecord[] }

/** Renames a compiled record, as recompiling the pack's content sources after an edit would */
function renameWrittenDocument(records: LibraryRecord[], from: string, to: string): boolean {
  for (const record of records) {
    if (record.entity === 'Document' && record.name === from) {
      record.name = to;
      return true;
    }
    if (record.children && renameWrittenDocument(record.children, from, to)) return true;
  }
  return false;
}

/**
 * The test edits a compiled content file in the checkout, so the restore can't live in the test body: a
 * Playwright timeout rejects the test without unwinding it, and a `finally` left unrun would leave the
 * renamed document on disk, failing every later run on its first assertion. A hook runs either way.
 */
const originalFiles = new Map<string, Buffer>();
test.afterEach(() => {
  for (const [file, bytes] of originalFiles) fs.writeFileSync(file, bytes);
  originalFiles.clear();
});

test('a rebuilt built-in pack reloads with the content the rebuild changed', async ({ app, appPage }) => {
  const { apiPort, apiToken } = await appPage.evaluate(async () => {
    const api = (window as { electronAPI?: { apiStatus: { whenReady: () => Promise<{ port: number }> }; apiToken?: string } }).electronAPI;
    return { apiPort: (await api?.apiStatus.whenReady())?.port, apiToken: api?.apiToken ?? '' };
  });
  expect(apiPort, 'the renderer knows the API port').toBeTruthy();
  expect(apiToken, 'the renderer knows the API token').toBeTruthy();

  await app.waitForSurface('default-setup/library');
  await app.navigate('default-setup/library');
  await expect.poll(() => libraryDocuments(appPage)).toContain(WRITTEN_DOCUMENT);

  const build = readPackBuild(DIST);
  for (const file of [CONTENT_FILE, path.join(DIST, PACK_LAYOUT.integrity), path.join(DIST, PACK_LAYOUT.manifest)]) {
    originalFiles.set(file, fs.readFileSync(file));
  }
  const content = JSON.parse(originalFiles.get(CONTENT_FILE)!.toString()) as { records: LibraryRecord[] };
  expect(renameWrittenDocument(content.records, WRITTEN_DOCUMENT, REBUILT_DOCUMENT), `${CONTENT_FILE} holds "${WRITTEN_DOCUMENT}"`).toBe(true);
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(content, null, 2));
  // Model completed output: a real build seals its changed content before reload can admit it.
  // Preserve the authored declaration and its key order; the parsed snapshot is normalized.
  const manifest = JSON.parse(originalFiles.get(path.join(DIST, PACK_LAYOUT.manifest))!.toString());
  sealPackBuild(DIST, manifest, build.integrity.sdkVersion);

  const response = await fetch(`http://127.0.0.1:${apiPort}/dev/reload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [API_TOKEN_HEADER]: apiToken },
    body: JSON.stringify({ packId: 'default-setup' }),
  });
  expect(response.status, await response.text()).toBe(200);

  // The reload re-applies the content, and the library's views carry the change to the tree
  await expect.poll(() => libraryDocuments(appPage), { timeout: 15_000 }).toContain(REBUILT_DOCUMENT);
});
