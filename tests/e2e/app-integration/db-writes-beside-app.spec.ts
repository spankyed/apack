// `apack db exec` writes from its own process, where nothing in the app can hear the commit. This runs the real CLI
// against a running app's data dir, and the library's tree is what shows the app was told: it renders a live view, and
// a view runs again only when its engine hears a commit.
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { test, expect } from '@apackdev/testing';

const CLI = path.resolve(import.meta.dirname, '../../../packages/apack-cli/bin/apack.mjs');
const WRITTEN_DOCUMENT = 'Codex commands';
const CHANGED_DOCUMENT = 'Codex commands from a terminal';

interface ShownItem { id: string; type: 'folder' | 'document'; name: string }
interface LibraryShown { items: ShownItem[]; expandedFolderIds: string[]; expandedFolderChildren: Record<string, ShownItem[]> }

/** The documents the library's tree shows, each call expanding what it finds as a user opening the tree would */
async function libraryDocuments(appPage: Page): Promise<string[]> {
  return appPage.evaluate(() => {
    type Actor = { getSnapshot(): { context: LibraryShown }; send(event: { type: 'EXPAND_FOLDER'; folderId: string }): void };
    const actor = (window as { applicationState?: { system?: { get(id: string): Actor | undefined } } })
      .applicationState?.system?.get('default-setup/library');
    if (!actor) return [];
    const { items, expandedFolderIds, expandedFolderChildren } = actor.getSnapshot().context;
    const shown = [...items, ...Object.values(expandedFolderChildren).flat()];
    for (const item of shown) {
      if (item.type === 'folder' && !expandedFolderIds.includes(item.id)) actor.send({ type: 'EXPAND_FOLDER', folderId: item.id });
    }
    return shown.filter((item) => item.type === 'document').map((item) => item.name);
  });
}

test('a write from apack db exec shows in the running app, without a restart', async ({ app, appPage, electronApp }) => {
  await app.waitForSurface('default-setup/library');
  await app.navigate('default-setup/library');
  await expect.poll(() => libraryDocuments(appPage)).toContain(WRITTEN_DOCUMENT);

  const dataDir = await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR);
  expect(dataDir, 'the app says which data dir it runs on').toBeTruthy();
  const code = `const [id] = query(EARS.Entity.Document).where('name', ${JSON.stringify(WRITTEN_DOCUMENT)}).ids();
    write(id).set('name', ${JSON.stringify(CHANGED_DOCUMENT)}); return id;`;
  const { stderr } = await promisify(execFile)(process.execPath, [CLI, 'db', 'exec', code, '--data-dir', dataDir!], {
    env: { ...process.env, APACK_ENV: 'test' },
  });
  expect(stderr).toContain('apack is running on it');

  await expect.poll(() => libraryDocuments(appPage), { timeout: 15_000 }).toContain(CHANGED_DOCUMENT);
  expect(await libraryDocuments(appPage)).not.toContain(WRITTEN_DOCUMENT);
});
