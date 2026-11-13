// What a program's terminal link may open. A link is what a program printed, so the decisions here are the ones that keep an
// untrusted link from reaching the OS: a file never opens, a custom scheme opens only when the person says so, and the
// answer to that question is the main process's own dialog, not something the window says.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {BrowserWindow, dialog, ipcMain, resetElectronStub, shell} from './electron-stub.ts';
import {
  MAX_TERMINAL_LINK_LENGTH,
  openTerminalLink,
  registerTerminalLinkHandler,
  terminalLinkDecision,
} from '../src/modules/terminal-link-access.ts';

const window = {name: 'the window the link came from'};

beforeEach(() => {
  resetElectronStub();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** What the person says to the question: 0 is Cancel, the default, and 1 is Open */
function answerAsk(response: 0 | 1) {
  return vi.spyOn(dialog, 'showMessageBox').mockResolvedValue({response, checkboxChecked: false});
}

describe('a link that opens without asking', () => {
  it.each(['http://localhost:5173/', 'https://example.com/docs?q=1', 'mailto:someone@example.com'])('opens %s', async (url) => {
    const ask = answerAsk(0);

    expect(await openTerminalLink(url, window as never)).toBe(true);

    expect(shell.opened).toEqual([url]);
    expect(ask, 'a link that opens directly was put to the person first').not.toHaveBeenCalled();
  });
});

describe('a file link', () => {
  it('is refused when it names no host, and nothing is asked or opened', async () => {
    const ask = answerAsk(1);

    expect(await openTerminalLink('file:///etc/passwd', window as never)).toBe(false);

    expect(shell.opened).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('a file link with no host is refused'));
  });

  it('is refused when it names a host, and the refusal says the file is on another machine', async () => {
    expect(await openTerminalLink('file://fileserver/share/report.pdf', window as never)).toBe(false);

    expect(shell.opened).toEqual([]);
    expect(terminalLinkDecision('file://fileserver/share/report.pdf')).toEqual({
      action: 'refuse',
      reason: 'it names the host "fileserver", so it is a file on another machine or a network share',
    });
  });
});

describe('a link in another scheme', () => {
  it('opens only when the person chooses Open', async () => {
    const ask = answerAsk(1);

    expect(await openTerminalLink('vscode://file/work/app.ts:3', window as never)).toBe(true);

    expect(shell.opened).toEqual(['vscode://file/work/app.ts:3']);
    expect(ask).toHaveBeenCalledTimes(1);
    const [parent, options] = ask.mock.calls[0]!;
    expect(parent, 'the question is asked over the window the link came from').toBe(window);
    expect(options).toMatchObject({ defaultId: 0, cancelId: 0, buttons: ['Cancel', 'Open'] });
    expect(options.detail).toContain('vscode:');
    expect(options.detail).toContain('vscode://file/work/app.ts:3');
  });

  it('is not opened when the person chooses Cancel', async () => {
    const ask = answerAsk(0);

    expect(await openTerminalLink('vscode://file/work/app.ts:3', window as never)).toBe(false);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(shell.opened).toEqual([]);
  });

  it('is refused without asking when there is no window to ask over', async () => {
    const ask = answerAsk(1);

    expect(await openTerminalLink('vscode://file/work/app.ts:3', null)).toBe(false);

    expect(ask).not.toHaveBeenCalled();
    expect(shell.opened).toEqual([]);
  });

  it('shows a long link in the question without its full length', async () => {
    const ask = answerAsk(0);
    const long = `https-like://${'a'.repeat(2000)}`;

    await openTerminalLink(long, window as never);

    expect(ask.mock.calls[0]![1]!.detail!.length).toBeLessThan(700);
  });
});

describe('credentials', () => {
  it.each(['https://apple.com@evil.example/keys', 'https://user:secret@example.com/', 'vscode://user:secret@host/x'])(
    'refuses %s, which hides the host it opens, and asks nothing about it',
    async (url) => {
      const ask = answerAsk(1);

      expect(await openTerminalLink(url, window as never)).toBe(false);

      expect(ask).not.toHaveBeenCalled();
      expect(shell.opened).toEqual([]);
    },
  );
});

describe('what is not a link', () => {
  it.each([undefined, null, 42, {href: 'https://example.com'}, ['https://example.com']])('refuses %s, which is not text', async (value) => {
    expect(await openTerminalLink(value, window as never)).toBe(false);
    expect(shell.opened).toEqual([]);
  });

  it('refuses a link longer than one link may hold, rather than cutting it', async () => {
    const long = `https://example.com/${'a'.repeat(MAX_TERMINAL_LINK_LENGTH)}`;

    expect(terminalLinkDecision(long)).toEqual({ action: 'refuse', reason: `it is longer than ${MAX_TERMINAL_LINK_LENGTH} characters` });
    expect(await openTerminalLink(long, window as never)).toBe(false);
    expect(shell.opened).toEqual([]);
  });

  it('accepts a link of exactly the most one may hold', () => {
    const full = `https://example.com/${'a'.repeat(MAX_TERMINAL_LINK_LENGTH - 'https://example.com/'.length)}`;
    expect(full.length).toBe(MAX_TERMINAL_LINK_LENGTH);
    expect(terminalLinkDecision(full)).toEqual({ action: 'open' });
  });

  it('refuses text that is not a URL', async () => {
    expect(await openTerminalLink('not a link at all', window as never)).toBe(false);
    expect(shell.opened).toEqual([]);
  });
});

describe('the channel a window reaches', () => {
  it('opens the link over the window that asked for it', async () => {
    registerTerminalLinkHandler(ipcMain);
    BrowserWindow.current = window;
    const listener = ipcMain.handlers.get('shell:openTerminalLink')!;
    expect(listener, 'the channel is registered').toBeDefined();

    expect(await listener({ sender: {} }, 'mailto:someone@example.com')).toBe(true);
    expect(shell.opened).toEqual(['mailto:someone@example.com']);
  });

  it('asks over the window that asked, and opens nothing the person did not choose', async () => {
    registerTerminalLinkHandler(ipcMain);
    BrowserWindow.current = window;
    const ask = answerAsk(0);

    expect(await ipcMain.handlers.get('shell:openTerminalLink')!({ sender: {} }, 'zoom://meeting/1')).toBe(false);

    expect(ask.mock.calls[0]![0]).toBe(window);
    expect(shell.opened).toEqual([]);
  });
});

describe('the schemes that run or display code', () => {
  it('are refused outright, and are never put to the person as a question', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:msgbox(1)']) {
      expect(terminalLinkDecision(url).action, url).toBe('refuse');
    }
  });
});
