// What a program may put on the clipboard: text, and no more than one write holds. The write is the main process's, so
// it is checked here without a window: the test reads what reached the clipboard, not whether a call was made.
import {beforeEach, describe, expect, it} from 'vitest';
import {clipboard, ipcMain, resetElectronStub} from './electron-stub.ts';
import {MAX_CLIPBOARD_TEXT, clipboardTextProblem, registerClipboardHandler, writeClipboardText} from '../src/modules/clipboard-access.ts';

beforeEach(() => resetElectronStub());

describe('what a program may put on the clipboard', () => {
  it('writes text, and says it did', () => {
    expect(writeClipboardText('hello world')).toBe(true);
    expect(clipboard.written).toEqual(['hello world']);
  });

  it('writes an empty text, which is a text the program meant to put there', () => {
    clipboard.current = 'something copied before';
    expect(writeClipboardText('')).toBe(true);
    expect(clipboard.written).toEqual(['']);
  });

  it('refuses what is not text, and writes nothing for it', () => {
    for (const value of [undefined, null, 42, {text: 'x'}, ['x']]) {
      expect(writeClipboardText(value), String(value)).toBe(false);
    }
    expect(clipboard.written).toEqual([]);
  });

  it('refuses a text longer than one write holds, rather than cutting it', () => {
    const long = 'x'.repeat(MAX_CLIPBOARD_TEXT + 1);
    expect(clipboardTextProblem(long)).toMatch(/longer than/);
    expect(writeClipboardText(long)).toBe(false);
    expect(clipboard.written).toEqual([]);
  });

  it('writes a text of exactly the most one write holds', () => {
    const full = 'x'.repeat(MAX_CLIPBOARD_TEXT);
    expect(writeClipboardText(full)).toBe(true);
    expect(clipboard.written).toEqual([full]);
  });

  it('is what a window reaches when it asks for a write over the registered channel', () => {
    registerClipboardHandler(ipcMain);
    const listener = ipcMain.handlers.get('clipboard:write-text');
    expect(listener, 'the channel is registered').toBeDefined();
    expect(listener!({}, 'from the window')).toBe(true);
    expect(clipboard.written).toEqual(['from the window']);
    expect(listener!({}, 42)).toBe(false);
    expect(clipboard.written).toEqual(['from the window']);
  });

  it('writes a text once when every window that shows the code surface asks for it', () => {
    registerClipboardHandler(ipcMain);
    const listener = ipcMain.handlers.get('clipboard:write-text')!;
    for (let window = 0; window < 3; window++) expect(listener({}, 'copied by a program')).toBe(true);
    expect(clipboard.written).toEqual(['copied by a program']);
  });

  it('writes a text again when the clipboard no longer holds it, as a later deliberate copy of it does', () => {
    expect(writeClipboardText('same text')).toBe(true);
    clipboard.current = 'something the person copied since';
    expect(writeClipboardText('same text')).toBe(true);
    expect(clipboard.written).toEqual(['same text', 'same text']);
  });
});
