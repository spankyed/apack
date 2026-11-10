// What the one bridge between a window and the main process does, asked of the object it hands over.
//
// **Why this package has a suite at all.** It is the narrowest layer in the repo and the only one a
// renderer — and every pack's frontend, which runs in the same window — can reach directly, so a mistake
// here is reachable by code the app did not write. The three claims below are the ones nothing else holds:
// where the API token comes from, that a port argument is a port, and that every subscription can be
// undone. Everything else about this module is a list of channels, which `CLAUDE.md` tables and a spec
// could only restate.
import { describe, expect, it, vi } from 'vitest';
import type { contextBridge as Bridge, ipcRenderer as Renderer } from '../tests/electron-stub';

/**
 * The bridge runs its side effect on import and reads `process.argv` as it does, so each case loads it
 * fresh with the arguments it wants to ask about.
 *
 * **The stub comes out of the same fresh registry as the module**, which is the trap `@app/main`'s guide
 * records: `vi.resetModules()` hands the module a new copy of every import, so a stub taken at the top of
 * this file is a different object from the one the bridge just called and every case reads an empty map.
 */
async function load(argv: string[] = []): Promise<{
  api: Record<string, any>;
  bridge: typeof Bridge;
  renderer: typeof Renderer;
}> {
  process.argv = ['electron', 'app', ...argv];
  vi.resetModules();
  const { contextBridge, ipcRenderer } = await import('../tests/electron-stub');
  ipcRenderer.syncAnswers.set('api:token', 'a-token-from-main');
  await import('../src/index.ts');
  return {
    api: contextBridge.exposed.get('electronAPI') as Record<string, any>,
    bridge: contextBridge,
    renderer: ipcRenderer,
  };
}

describe('the API token', () => {
  /**
   * **It is read from main, never from the command line**, and that is the whole of why this case exists:
   * `process.argv` is readable by any process on the machine, so a token passed that way would be a token
   * every other process on the box has. Main sends it over a synchronous channel as the preload loads.
   */
  it('comes from main over api:token', async () => {
    const { api } = await load();

    expect(api.apiToken).toBe('a-token-from-main');
  });

  /** The firing case for that claim: an argument offering one is not where the token comes from. */
  it('is not taken from an argument, however the argument is spelled', async () => {
    const { api } = await load(['--api-token=from-the-command-line', '--apiToken=from-the-command-line']);

    expect(api.apiToken).toBe('a-token-from-main');
  });
});

describe('the API port', () => {
  it('is the one main passed', async () => {
    expect((await load(['--api-port=3099'])).api.apiPort).toBe(3099);
  });

  it('falls back to 3001 when no argument names one', async () => {
    expect((await load()).api.apiPort).toBe(3001);
  });

  /**
   * A port is a port or it is the default. Main builds this argument from a number it already has
   * (`WindowManager`), so nothing reachable from the UI produces a malformed one — which makes this an
   * assertion about the pair rather than a gate on input. **The edit that makes it fire** is dropping the
   * guard: `parseInt` answers `NaN` for an empty or non-numeric value, and a window would then connect to
   * `ws://localhost:NaN` and fail with a message about the URL rather than about the argument.
   */
  it('is the default rather than a number that is not one', async () => {
    for (const value of ['', 'abc', '-1', '0']) {
      expect((await load([`--api-port=${value}`])).api.apiPort, value).toBe(3001);
    }
  });
});

describe('every subscription', () => {
  /**
   * The guide says each `on*` returns an unsubscribe; this is what holds it. A listener left behind after
   * its component has gone is a leak that only shows as a callback into a dead view — and the two that
   * register *several* listeners for one subscription (`apiStatus.onEvent` takes five channels) are where
   * a partial unsubscribe would hide.
   */
  it('can be undone, and leaves no listener behind', async () => {
    const { api, renderer } = await load();
    const listening = (): number => [...renderer.listeners.values()].reduce((total, each) => total + each.length, 0);
    const subscriptions: [string, () => void][] = [
      ['speechRecognition.onEvent', api.speechRecognition.onEvent(() => {})],
      ['apiStatus.onEvent', api.apiStatus.onEvent(() => {})],
      ['protocolAction.onAction', api.protocolAction.onAction(() => {})],
      ['browser.onTabCreated', api.browser.onTabCreated(() => {})],
      ['browser.onTabRemoved', api.browser.onTabRemoved(() => {})],
      ['browser.onTabUpdated', api.browser.onTabUpdated(() => {})],
      ['browser.onActiveTabChanged', api.browser.onActiveTabChanged(() => {})],
      ['browser.onFocusAddressBar', api.browser.onFocusAddressBar(() => {})],
    ];
    // The subject is not empty, which is the half that keeps failing: a renamed member would otherwise
    // leave this asserting that nothing leaks nothing
    expect(listening()).toBeGreaterThanOrEqual(subscriptions.length);

    for (const [name, unsubscribe] of subscriptions) {
      expect(typeof unsubscribe, name).toBe('function');
      unsubscribe();
    }

    expect(listening()).toBe(0);
  });
});

describe('what reaches the window', () => {
  /**
   * One global, so there is one surface to reason about. A second name exposed here would be a second
   * thing every pack frontend in the window can reach, and nothing outside this file would say so.
   */
  it('is one named object and nothing else', async () => {
    const { bridge } = await load();

    expect([...bridge.exposed.keys()]).toEqual(['electronAPI']);
  });
});

describe('a window\'s connection to the terminal broker', () => {
  /**
   * A socket a case holds the other end of, standing in for the broker: what the window sent, and a way to
   * answer. A real socket, since the bridge's whole job here is what it does with one.
   */
  async function broker() {
    const net = await import('node:net');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'preload-term-'));
    const socket = process.platform === 'win32' ? `\\\\.\\pipe\\preload-term-${process.pid}-${Date.now()}` : path.join(directory, 't.sock');
    const received: Buffer[] = [];
    let peer: import('node:net').Socket | undefined;
    const arrived = new Set<() => void>();
    const server = net.createServer((connection) => {
      peer = connection;
      connection.on('data', (chunk) => {
        received.push(chunk);
        for (const wake of arrived) wake();
      });
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    /** Resolves once everything received, joined, satisfies `enough` */
    const until = (enough: (all: string) => boolean) => new Promise<string>((resolve) => {
      const check = () => {
        const all = Buffer.concat(received).toString('latin1');
        if (!enough(all)) return;
        arrived.delete(check);
        resolve(all);
      };
      arrived.add(check);
      check();
    });
    return {
      socket,
      until,
      say: (bytes: string | Uint8Array) => { peer!.write(bytes); },
      hangUp: () => { peer!.destroy(); },
      close: () => {
        peer?.destroy();
        server.close();
        fs.rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  const GREETING = '{"kind":"hello","protocol":1,"role":"view"}\n';

  async function connected(endpoint: { socket: string; greeting: string } | null) {
    process.argv = ['electron', 'app'];
    vi.resetModules();
    const { contextBridge, ipcRenderer } = await import('../tests/electron-stub');
    ipcRenderer.syncAnswers.set('terminal:view-endpoint', endpoint);
    await import('../src/index.ts');
    const api = contextBridge.exposed.get('electronAPI') as Record<string, any>;
    const stream = api.terminal.views();
    const chunks: Uint8Array[] = [];
    let closed = 0;
    const woken = new Set<() => void>();
    stream.onData((chunk: Uint8Array) => { chunks.push(chunk); for (const wake of woken) wake(); });
    stream.onClose(() => { closed += 1; for (const wake of woken) wake(); });
    const until = (enough: () => boolean) => new Promise<void>((resolve) => {
      const check = () => { if (enough()) { woken.delete(check); resolve(); } };
      woken.add(check);
      check();
    });
    return { stream, until, text: () => Buffer.concat(chunks).toString('latin1'), closed: () => closed };
  }

  /**
   * **The greeting is the only thing the bridge reads.** Main supplies the line to send, the broker answers
   * with one of its own, and from the byte after that the connection is the page's — including whatever
   * arrived in the same read as the answer.
   */
  it('greets the broker with the line main gave it, and hands over what follows the answer', async () => {
    const far = await broker();
    try {
      const near = await connected({ socket: far.socket, greeting: GREETING });
      expect(await far.until((all) => all.includes('\n'))).toBe(GREETING);

      far.say('{"kind":"hello","protocol":1,"history":1000}\nABC');
      await near.until(() => near.text().length >= 3);
      far.say('DEF');
      await near.until(() => near.text().length >= 6);
      expect(near.text()).toBe('ABCDEF');
    } finally { far.close(); }
  });

  /**
   * What the page sends before the broker has answered is held. A broker still reading the greeting reads
   * lines, and the page's first message is not one.
   */
  it('holds what the page sends until the broker has answered the greeting', async () => {
    const far = await broker();
    try {
      const near = await connected({ socket: far.socket, greeting: GREETING });
      near.stream.send(Uint8Array.of(1, 2, 3));
      await far.until((all) => all.includes('\n'));
      expect(await far.until(() => true), 'bytes reached the broker ahead of its answer').toBe(GREETING);

      far.say('{"kind":"hello","protocol":1,"history":1000}\n');
      near.stream.send(Uint8Array.of(4));
      expect(await far.until((all) => all.length >= GREETING.length + 4)).toBe(`${GREETING}\x01\x02\x03\x04`);
    } finally { far.close(); }
  });

  it('is over when the broker refuses the greeting, and nothing of the refusal reaches the page', async () => {
    const far = await broker();
    try {
      const near = await connected({ socket: far.socket, greeting: GREETING });
      await far.until((all) => all.includes('\n'));
      far.say('{"kind":"failed","session":null,"code":"HANDSHAKE","message":"no"}\nXYZ');
      await near.until(() => near.closed() > 0);
      expect(near.closed()).toBe(1);
      expect(near.text()).toBe('');
    } finally { far.close(); }
  });

  it('is over, once, when the broker goes or the page closes it', async () => {
    const far = await broker();
    try {
      const near = await connected({ socket: far.socket, greeting: GREETING });
      await far.until((all) => all.includes('\n'));
      far.say('{"kind":"hello","protocol":1,"history":1000}\n');
      far.hangUp();
      await near.until(() => near.closed() > 0);
      near.stream.close();
      near.stream.send(Uint8Array.of(9));
      expect(near.closed()).toBe(1);
    } finally { far.close(); }
  });

  /** Main answers nothing when there is no broker: the window is told its terminals have none, not hung */
  it('is over at once where main has no broker to point at, or nothing is listening there', async () => {
    const none = await connected(null);
    await none.until(() => none.closed() > 0);

    const far = await broker();
    far.close();
    const refused = await connected({ socket: far.socket, greeting: GREETING });
    await refused.until(() => refused.closed() > 0);
    expect([none.closed(), refused.closed()]).toEqual([1, 1]);
  });
});
