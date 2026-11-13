// What a program may put on the system clipboard. A program asks through its terminal (OSC 52), the broker reports the
// write, and a window puts it there. The write is the main process's and not the window's, because the browser refuses
// a document's own clipboard write while the document has no focus, and a program's write arrives when the person is
// usually somewhere else. The text is untrusted whatever asked for it, so its size is the one rule decided here.
import {clipboard, type IpcMain} from 'electron';

/** The most text one write may hold. Larger text is refused rather than cut, since a cut text is a different text. */
export const MAX_CLIPBOARD_TEXT = 8 * 1024 * 1024;

/** Why `text` may not be written to the clipboard, or undefined when it may */
export function clipboardTextProblem(text: unknown): string | undefined {
  if (typeof text !== 'string') return 'it is not text';
  if (text.length > MAX_CLIPBOARD_TEXT) return `it is longer than ${MAX_CLIPBOARD_TEXT} characters`;
  return undefined;
}

let pendingWrite: Promise<boolean> = Promise.resolve(true);

/**
 * Writes `text` to the system clipboard, answering whether it was written. Every window showing the code surface asks
 * for the same write, so a text the clipboard already holds is not written again: the second ask finds it there.
 */
export function writeClipboardText(text: unknown): Promise<boolean> {
  if (clipboardTextProblem(text) !== undefined) return Promise.resolve(false);
  // Windows may ask concurrently. Read after the preceding write settles so duplicates see its result.
  pendingWrite = pendingWrite.then(async () => {
    try {
      if (await clipboard.readText() !== text) await clipboard.writeText(text as string);
      return true;
    } catch {
      return false;
    }
  });
  return pendingWrite;
}

/** Answers the window's `clipboard:write-text` request with `writeClipboardText` */
export function registerClipboardHandler(ipc: Pick<IpcMain, 'handle'>): void {
  ipc.handle('clipboard:write-text', (_event, text: unknown) => writeClipboardText(text));
}
