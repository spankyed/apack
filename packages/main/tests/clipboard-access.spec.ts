// What a program may put on the clipboard: text, and no more than one write holds. The write is the main process's, so
// it is checked here without a window: the test reads what reached the clipboard, not whether a call was made.
import {beforeEach, describe, expect, it} from 'vitest';
import {clipboard, resetElectronStub} from './electron-stub.ts';
import {MAX_CLIPBOARD_TEXT, clipboardTextProblem, writeClipboardText} from '../src/modules/clipboard-access.ts';

beforeEach(() => resetElectronStub());

describe('what a program may put on the clipboard', () => {
  it('writes text, and says it did', () => {
    expect(writeClipboardText('hello world')).toBe(true);
    expect(clipboard.written).toEqual(['hello world']);
  });

  it('writes an empty text, which is a text the program meant to put there', () => {
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
});
