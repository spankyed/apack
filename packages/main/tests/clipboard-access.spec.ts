// What a program may put on the clipboard: text, and no more than one write holds. The write is the main process's, so
// it is checked here without a window: the test reads what reached the clipboard, not whether a call was made.
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {clipboard, ipcMain, resetElectronStub} from './electron-stub.ts';
import {MAX_CLIPBOARD_TEXT, clipboardTextProblem, registerClipboardHandler, writeClipboardText} from '../src/modules/clipboard-access.ts';

beforeEach(() => {
  vi.restoreAllMocks();
  resetElectronStub();
});

describe('what a program may put on the clipboard', () => {
  it('writes text, and says it did', async () => {
    expect(await writeClipboardText('hello world')).toBe(true);
    expect(clipboard.written).toEqual(['hello world']);
  });

  it('writes an empty text, which is a text the program meant to put there', async () => {
    clipboard.current = 'something copied before';
    expect(await writeClipboardText('')).toBe(true);
    expect(clipboard.written).toEqual(['']);
  });

  it('refuses what is not text, and writes nothing for it', async () => {
    for (const value of [undefined, null, 42, {text: 'x'}, ['x']]) {
      expect(await writeClipboardText(value), String(value)).toBe(false);
    }
    expect(clipboard.written).toEqual([]);
  });

  it('refuses a text longer than one write holds, rather than cutting it', async () => {
    const long = 'x'.repeat(MAX_CLIPBOARD_TEXT + 1);
    expect(clipboardTextProblem(long)).toMatch(/longer than/);
    expect(await writeClipboardText(long)).toBe(false);
    expect(clipboard.written).toEqual([]);
  });

  it('writes a text of exactly the most one write holds', async () => {
    const full = 'x'.repeat(MAX_CLIPBOARD_TEXT);
    expect(await writeClipboardText(full)).toBe(true);
    expect(clipboard.written).toEqual([full]);
  });

  it('is what a window reaches when it asks for a write over the registered channel', async () => {
    registerClipboardHandler(ipcMain);
    const listener = ipcMain.handlers.get('clipboard:write-text');
    expect(listener, 'the channel is registered').toBeDefined();
    expect(await listener!({}, 'from the window')).toBe(true);
    expect(clipboard.written).toEqual(['from the window']);
    expect(await listener!({}, 42)).toBe(false);
    expect(clipboard.written).toEqual(['from the window']);
  });

  it('writes a text once when every window that shows the code surface asks for it', async () => {
    registerClipboardHandler(ipcMain);
    const listener = ipcMain.handlers.get('clipboard:write-text')!;
    expect(await Promise.all(Array.from({length: 3}, () => listener({}, 'copied by a program')))).toEqual([true, true, true]);
    expect(clipboard.written).toEqual(['copied by a program']);
  });

  it('writes a text again when the clipboard no longer holds it, as a later deliberate copy of it does', async () => {
    expect(await writeClipboardText('same text')).toBe(true);
    clipboard.current = 'something the person copied since';
    expect(await writeClipboardText('same text')).toBe(true);
    expect(clipboard.written).toEqual(['same text', 'same text']);
  });

  it('acknowledges only after the OS write finishes and preserves request order', async () => {
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    const write = clipboard.writeText.bind(clipboard);
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(clipboard, 'writeText').mockImplementationOnce(async text => {
      entered();
      await held;
      await write(text);
    });
    let acknowledged = false;
    const first = writeClipboardText('first').then(result => { acknowledged = true; return result; });
    const duplicate = writeClipboardText('first');
    const next = writeClipboardText('next');
    await started;
    expect(acknowledged).toBe(false);
    expect(clipboard.written).toEqual([]);
    finish();
    expect(await Promise.all([first, duplicate, next])).toEqual([true, true, true]);
    expect(clipboard.written).toEqual(['first', 'next']);
  });

  it('refuses a failed read or write and lets later requests proceed', async () => {
    vi.spyOn(clipboard, 'readText').mockRejectedValueOnce(new Error('read refused'));
    expect(await writeClipboardText('read failure')).toBe(false);
    vi.spyOn(clipboard, 'writeText').mockRejectedValueOnce(new Error('write refused'));
    const failed = writeClipboardText('retry');
    const recovered = writeClipboardText('retry');
    expect(await failed).toBe(false);
    expect(await recovered).toBe(true);
    expect(clipboard.written).toEqual(['retry']);
  });

});
