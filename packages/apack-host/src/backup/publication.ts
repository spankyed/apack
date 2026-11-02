// Publish a verified, closed backup tree without replacing a competing destination.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Offline CLI publication; Windows delegates its exclusive move to the system's .NET filesystem API. */
export function publishBackupDirectory(staged: string, destination: string): void {
  if (!fs.lstatSync(staged).isDirectory()) throw new Error(`Backup staging must be an ordinary directory: ${staged}`);
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot) throw new Error('Windows backup publication requires SystemRoot');
    // Node's Windows rename may replace an existing file or symlink even when the source is a directory.
    // Directory.Move refuses every occupied destination. Paths travel as data, never PowerShell source.
    const command = "$ErrorActionPreference='Stop'; try { [IO.Directory]::Move($env:APACK_BACKUP_SOURCE_DIRECTORY,$env:APACK_BACKUP_TARGET_DIRECTORY); exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
    try {
      execFileSync(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
          env: { ...process.env, APACK_BACKUP_SOURCE_DIRECTORY: staged, APACK_BACKUP_TARGET_DIRECTORY: destination },
          windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (cause) {
      // A terminated helper might already have moved the tree. Never remove the destination on failure.
      throw Object.assign(new Error(`Windows backup publication did not confirm success; inspect ${destination}`, { cause }),
        { code: 'PUBLICATION_UNKNOWN', destinationPath: destination });
    }
    return;
  }
  // POSIX may replace an empty directory, so reserve it exclusively before renaming onto our reservation.
  fs.mkdirSync(destination, { mode: 0o700 });
  try { fs.renameSync(staged, destination); }
  catch (error) {
    try { fs.rmdirSync(destination); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Backup publication and reservation cleanup failed', { cause: error }); }
    throw error;
  }
}
