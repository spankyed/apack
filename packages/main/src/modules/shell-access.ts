// What this process hands to the OS on a window's word: a URL for the user's browser, a file for its default app.
// A window renders what the user wrote, what a model answered and what a pack's frontend built, so a request arriving
// here is untrusted whatever asked for it, and these two rules are where that is decided — not a list of approved
// sites, which would either block the links people actually open or grow until it approves everything.
//
// @see https://www.electronjs.org/docs/latest/tutorial/security#14-do-not-use-openexternal-with-untrusted-content
import {shell} from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {URL} from 'node:url';
import {summarizeUrl, webUrlProblem} from '@apackdev/sdk/utils/pure';

/**
 * Why `url` isn't a link to open in the user's browser, or undefined when it is.
 *
 * The scheme and credential rules are shared with the in-app tab (`webUrlProblem`), because the same
 * untrusted text reaches both doors and a rule written twice is a rule one door loses (S4). What is this
 * door's alone is the help host, which addresses an article inside the app and not a site.
 */
export function externalUrlProblem(url: string): string | undefined {
  const problem = webUrlProblem(url);
  if (problem) return problem;
  if (new URL(url).hostname === 'help.apack.invalid') return 'it addresses an internal help article';
  return undefined;
}

/** Extensions the OS runs rather than opens. Refused whatever a window says they are: a `.app` is a folder, and runs */
const RUNS_ON_OPEN = new Set(['.app', '.command', '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.ps1', '.vbs', '.jar']);

/** Why `filePath` isn't a file to hand to its default app, or undefined when it is */
export async function openablePathProblem(filePath: string): Promise<string | undefined> {
  if (!filePath) return 'it is empty';
  if (RUNS_ON_OPEN.has(path.extname(filePath).toLowerCase())) return 'the system would run it rather than open it';
  try {
    await fs.stat(filePath);
  } catch {
    return 'there is no such file';
  }
  return undefined;
}

/** Opens `url` in the user's browser, or refuses it, saying which host was asked for and why it was refused */
export async function openExternalUrl(url: string): Promise<void> {
  const problem = externalUrlProblem(url);
  if (problem) {
    console.warn(`[shell] Refused to open "${summarizeUrl(url)}": ${problem}`);
    return;
  }
  await shell.openExternal(url);
}

/** Opens `filePath` with its default application, or refuses it */
export async function openFilePath(filePath: string): Promise<void> {
  const problem = await openablePathProblem(filePath);
  if (problem) {
    console.warn(`[shell] Refused to open "${filePath}": ${problem}`);
    return;
  }
  const failure = await shell.openPath(filePath);
  if (failure) throw new Error(failure);
}

