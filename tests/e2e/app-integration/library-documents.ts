// What the library's tree shows, read from the surface's actor
import type { Page } from '@playwright/test';

interface ShownItem { id: string; type: 'folder' | 'document'; name: string }
interface LibraryShown { items: ShownItem[]; expandedFolderIds: string[]; expandedFolderChildren: Record<string, ShownItem[]> }

/**
 * The documents the library's tree shows, as its actor holds them. Each call expands every folder shown and not yet
 * expanded, as a user opening the tree would, so polling it reaches a document however deep its folder is.
 */
export async function libraryDocuments(appPage: Page): Promise<string[]> {
  return appPage.evaluate(() => {
    type Actor = { getSnapshot(): { context: LibraryShown }; send(event: { type: 'EXPAND_FOLDER'; folderId: string }): void };
    const actor = (window as { applicationState?: { system?: { get(id: string): Actor | undefined } } }).applicationState?.system?.get('default-setup/library');
    if (!actor) return [];
    const { items, expandedFolderIds, expandedFolderChildren } = actor.getSnapshot().context;
    const shown = [...items, ...Object.values(expandedFolderChildren).flat()];
    for (const item of shown) {
      if (item.type === 'folder' && !expandedFolderIds.includes(item.id)) actor.send({ type: 'EXPAND_FOLDER', folderId: item.id });
    }
    return shown.filter((item) => item.type === 'document').map((item) => item.name);
  });
}
