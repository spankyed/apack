import type { AppEnvironment } from '@apackdev/sdk/env';
import { findRunningApp, holdDatabaseWriteLock } from '@apackdev/host/database';

/** Hold the app's storage lock across pack placement and its installation record update. */
export async function withPackMutation<T>(context: AppEnvironment, command: string, run: () => Promise<T>): Promise<T> {
  using _lock = holdDatabaseWriteLock(context.userDataDir, `apack pack ${command}`);
  if (findRunningApp(context)) throw new Error(`Quit the app before changing its installed packs (${command}).`);
  return await run();
}
