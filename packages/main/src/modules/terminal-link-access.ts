// What a program may open from a terminal link: a URL it printed, or one it declared with an OSC 8 hyperlink. The link is
// whatever a program wrote, so it is untrusted whatever asked for it. The app's shared rule for what a window may open
// (`webUrlProblem`) lets only http and https through, and that rule is not widened here: it governs every other door.
// A terminal link also reaches `mailto:`, which the person chose to follow, and any other scheme, which only the person
// can decide about, so that one is put to them before anything opens.
import {BrowserWindow, dialog, shell, type IpcMain} from 'electron';
import {summarizeUrl} from '@apackdev/sdk/utils/pure';

/** The most text one link may hold. A longer one is refused rather than cut, since a cut link is a different link. */
export const MAX_TERMINAL_LINK_LENGTH = 8192;

/** The schemes that open without asking: a browser for web addresses, and the mail program for `mailto:`. */
const OPEN_DIRECTLY = new Set(['http:', 'https:', 'mailto:']);

/** How much of a link the question shows. The full text is held by the link itself; the dialog only needs to be readable. */
const SHOWN_LENGTH = 500;

/** The button index that means "Open" in the question. Index 0 is Cancel, and Cancel is the default and the escape. */
const OPEN_BUTTON = 1;

export type TerminalLinkDecision =
  | {action: 'open'}
  | {action: 'ask'; scheme: string}
  | {action: 'refuse'; reason: string};

/** What to do with `url` as a terminal link: open it, ask the person first, or refuse it, with the reason */
export function terminalLinkDecision(url: unknown): TerminalLinkDecision {
  if (typeof url !== 'string') return {action: 'refuse', reason: 'it is not text'};
  if (url.length > MAX_TERMINAL_LINK_LENGTH) return {action: 'refuse', reason: `it is longer than ${MAX_TERMINAL_LINK_LENGTH} characters`};

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {action: 'refuse', reason: 'it is not a URL'};
  }
  // A file link names a file on a machine. With no host it names one on this machine, which a program has no business
  // handing to the OS; with a host it names one on another machine or a network share, which this window does not open.
  if (parsed.protocol === 'file:') {
    if (parsed.host) return {action: 'refuse', reason: `it names the host "${parsed.host}", so it is a file on another machine or a network share`};
    return {action: 'refuse', reason: 'a file link with no host is refused'};
  }
  // "https://apple.com@evil.example" is a link to evil.example, read as one to apple.com
  if (parsed.username || parsed.password) return {action: 'refuse', reason: 'it carries credentials, which hide the host it opens'};
  if (OPEN_DIRECTLY.has(parsed.protocol)) return {action: 'open'};
  return {action: 'ask', scheme: parsed.protocol.slice(0, -1)};
}

/** The text of `url` as a log line names it: never the query, which may carry a token */
function describe(url: unknown): string {
  return typeof url === 'string' ? summarizeUrl(url) : `a ${typeof url}`;
}

/**
 * Opens `url` for a terminal link, answering whether it was opened. A link that needs asking is put to the person in a
 * dialog over `parent`, the window the link came from, and opens only when the person chooses Open. Without a window
 * to ask over, such a link is refused: nothing answers for the person in its place.
 */
export async function openTerminalLink(url: unknown, parent: BrowserWindow | null): Promise<boolean> {
  const decision = terminalLinkDecision(url);
  if (decision.action === 'refuse') {
    console.warn(`[shell] Refused to open terminal link "${describe(url)}": ${decision.reason}`);
    return false;
  }
  if (decision.action === 'ask') {
    if (!parent) {
      console.warn(`[shell] Refused to open terminal link "${describe(url)}": no window to ask over`);
      return false;
    }
    const shown = (url as string).length > SHOWN_LENGTH ? `${(url as string).slice(0, SHOWN_LENGTH)}...` : url as string;
    const {response} = await dialog.showMessageBox(parent, {
      type: 'question',
      title: 'Open link',
      message: `Open this ${decision.scheme} link in another program?`,
      detail: `${decision.scheme}:\n${shown}`,
      buttons: ['Cancel', 'Open'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response !== OPEN_BUTTON) return false;
  }
  await shell.openExternal(url as string);
  return true;
}

/** Answers the window's `shell:openTerminalLink` request with `openTerminalLink`, over the window that asked */
export function registerTerminalLinkHandler(ipc: Pick<IpcMain, 'handle'>): void {
  ipc.handle('shell:openTerminalLink', (event, url: unknown) => openTerminalLink(url, BrowserWindow.fromWebContents(event.sender)));
}
