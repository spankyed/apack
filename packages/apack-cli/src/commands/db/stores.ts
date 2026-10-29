// Select existing profile stores before maintenance starts; run history is never replaced by this path.
import { existsSync } from 'node:fs';
import { openRunHistory, type AppDatabase } from '@apackdev/host/database';
import type { EarsDatabase } from '@apackdev/ears';
import { withDatabase } from './target';

type StoreSelection = 'primary' | 'runs' | 'all';
export function databaseSelection(value: unknown): StoreSelection {
  if (value === 'primary' || value === 'runs' || value === 'all') return value;
  throw new Error('--database must be primary, runs or all');
}
export interface SelectedDatabase { name: 'primary' | 'runs'; database: EarsDatabase }
export async function withSelectedDatabases<T>(app: AppDatabase, selection: StoreSelection, write: boolean,
  use: (stores: readonly SelectedDatabase[]) => Promise<T>): Promise<T> {
  if (selection !== 'primary' && !existsSync(app.paths.runHistory))
    throw new Error(`No run history database at ${app.paths.runHistory}; nothing was created`);
  const history = selection !== 'primary' ? openRunHistory(app.paths.runHistory, {
    readOnly: !write, storageFormat: app.database.format, replaceUnreadable: false,
  }) : undefined;
  const stores: SelectedDatabase[] = [
    ...(selection !== 'runs' ? [{ name: 'primary' as const, database: app.database }] : []),
    ...(history ? [{ name: 'runs' as const, database: history.database }] : []),
  ];
  return history ? withDatabase({ close: () => history.database.close() }, () => use(stores)) : use(stores);
}
