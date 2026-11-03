// The lock a tool holds while it replaces what others are using in a data dir: its whole database (`apack db reset`,
// `import`), its stored settings or its packs. An app that starts meanwhile refuses to open the database rather than
// run on what is being replaced, and a check alone can't do that: the app could start in the moment between the check
// and the write. A tool changing rows holds none, since LMDB orders its commits with everything else writing.
//
// The mechanism is `../exclusive-lock.ts`, shared with the CLI's code generation. What is this module's own is the
// policy: where the file lives, what the refusal says, and that the app asserts on it before opening a store.
import * as path from 'node:path';
import { _appDirOf } from '@apackdev/sdk/env';
import { findLockHolder, holdExclusiveLock } from '../exclusive-lock.ts';


const lockFile = (userDataDir: string) => path.join(_appDirOf(userDataDir), 'db-write.lock');

/**
 * What a tool is changing in this data dir's database right now, or `null` when nothing is: a lock whose process has
 * exited doesn't count. Two cases can't be resolved and count as held: a lock this version can't read, and one
 * naming another machine, whose pid means nothing here.
 */
export function findDatabaseWriter(userDataDir: string): string | null {
  return findLockHolder(lockFile(userDataDir));
}

/** Where the lock is, and that removing it is the way out when no tool is really running */
const clearHint = (userDataDir: string) =>
  `If no tool is running, delete ${lockFile(userDataDir)} and try again.`;

/** A lock a tool holds; `release()` is safe to call more than once */
export interface DatabaseWriteLock {
  release(): void;
}

/**
 * Takes the lock for `userDataDir` while a tool changes its database. Throws when another tool holds it; a lock left
 * by a process that has exited is taken over. The caller releases it, whatever happens.
 */
export function holdDatabaseWriteLock(userDataDir: string, what: string): DatabaseWriteLock {
  return holdExclusiveLock({
    file: lockFile(userDataDir),
    what,
    refuse: (holder) => new Error(`Another tool is changing the database in ${userDataDir}: ${holder}. ${clearHint(userDataDir)}`),
  });
}

/**
 * Throws when a tool holds the lock for `userDataDir`: neither an app nor a tool changing rows opens a database another
 * process is in the middle of replacing.
 */
export function assertNoDatabaseWriter(userDataDir: string): void {
  const held = findDatabaseWriter(userDataDir);
  if (held) {
    throw new Error(
      `The database in ${userDataDir} is being changed by ${held}. Wait for it to finish, then try again. `
      + clearHint(userDataDir),
    );
  }
}
