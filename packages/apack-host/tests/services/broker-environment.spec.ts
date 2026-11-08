// What a user's shell does not inherit from this app, which is S1's second half and G4.
//
// The app's identity reaches every process it starts: `@app/main` sets ten variables when it spawns the API,
// the API starts the broker, and the broker spawns the shells. A shell that inherits `ELECTRON_RUN_AS_NODE=1`
// breaks any Electron app the user launches from it; one that inherits `APACK_USER_DATA_DIR` or
// `SHIPPED_PACKS_DIR` tells anything they run where the app's data is.
//
// **It is checked here because the spawn is here.** The pack had a strip of its own, written for the `spawn`
// it used to do, and it was left with no caller the moment the broker took that over — so a change that
// moved a process also moved where this has to be asserted, and for the length of it the shell inherited all
// ten again.
import { describe, expect, it } from 'vitest';
import { APP_PROCESS_ENV_VARS } from '@apackdev/sdk/env';
import { brokerEnvironment, socketPath } from '../../src/services/terminal.ts';

/** Every variable the app sets on the API's process, as if this were that process */
const asTheApiProcess = (): NodeJS.ProcessEnv => ({
  PATH: '/usr/bin:/bin',
  HOME: '/Users/someone',
  NODE_OPTIONS: '--conditions=@apackdev/source',
  LD_PRELOAD: '/tmp/anything.so',
  ...Object.fromEntries(APP_PROCESS_ENV_VARS.map((name) => [name, `the-app-set-${name}`])),
});

describe("what the broker's shells inherit", () => {
  it('keeps none of the variables the app set on its own process', () => {
    const shell = brokerEnvironment(asTheApiProcess());

    // Derived, so a variable added to the construction that sets them is stripped without anyone adding it
    // here — a hand-written deny-list is the shape that rots, and S2 is what that shape cost
    for (const name of APP_PROCESS_ENV_VARS) {
      expect(shell[name], `${name} reached the user's shell`).toBeUndefined();
    }
  });

  it('keeps no dynamic-loader variable, whoever set it', () => {
    const shell = brokerEnvironment(asTheApiProcess());

    // `NODE_OPTIONS` is one this repo sets itself for a source run: a user's shell inheriting
    // `--conditions=@apackdev/source` is a development setup leaking onto their machine
    expect(shell.NODE_OPTIONS).toBeUndefined();
    expect(shell.LD_PRELOAD).toBeUndefined();
  });

  it("keeps the user's own environment, which is the whole point of inheriting one", () => {
    const shell = brokerEnvironment(asTheApiProcess());

    expect(shell.PATH).toBe('/usr/bin:/bin');
    expect(shell.HOME).toBe('/Users/someone');
  });

  it('says what terminal this is, rather than letting the shell inherit an answer', () => {
    // **X13**: nothing else declares `TERM` — `portable-pty` sets none — so the shell took whatever this
    // process happened to have, which is the shell the app was launched from in development and nothing at
    // all in a packaged app opened from the Dock. A shell with no `TERM` gives `less`, `vim` and `top` their
    // dumb fallbacks, and nothing about that failure names the app
    const inheritedSomethingElse = brokerEnvironment({ ...asTheApiProcess(), TERM: 'dumb' });

    expect(inheritedSomethingElse.TERM).toBe('xterm-256color');
    expect(inheritedSomethingElse.TERM_PROGRAM).toBe('apack');
    expect(inheritedSomethingElse.COLORTERM).toBe('truecolor');
  });

  it('strips every name the list holds, so the list is not describing nothing', () => {
    // A population check over the declaration itself: a rule derived from an empty list passes every case
    // above while protecting nothing
    expect(APP_PROCESS_ENV_VARS.length).toBeGreaterThan(5);
    expect(APP_PROCESS_ENV_VARS).toContain('ELECTRON_RUN_AS_NODE');
    expect(APP_PROCESS_ENV_VARS).toContain('APACK_API_TOKEN');
  });
});

// Where the broker listens, which is **a name and not a path**, and spelled differently on each platform.
//
// A Unix socket address holds 104 bytes on macOS, so a data dir under a long home directory or a synced
// folder cannot be one — which is why the name is derived from a hash rather than carrying the dir. And
// Windows has no Unix socket in this transport at all: a filesystem path there is refused outright,
// *expected a named pipe path*, which is what the broker's own suite got on its first Windows run instead
// of a broker.
describe('where the broker listens', () => {
  // Long enough to make the point about the 104-byte limit, and **not a platform data dir**: naming one
  // here would be this repo deriving an app path outside `@apackdev/sdk/env`, which `identity-guard`
  // refuses in a spec as readily as in source. What `socketPath` takes is any string; what it must not do
  // is put it in the address.
  const DATA_DIR = '/Users/someone/a-deeply-nested-synced-folder/apack/profiles/.ephemeral/12345-abcdefghij';

  it('is a named pipe on Windows, where a path is refused', () => {
    const socket = socketPath('win32', DATA_DIR);

    expect(socket.startsWith('\\\\.\\pipe\\apack-terminal-')).toBe(true);
    expect(socket).not.toContain('/');
  });

  it('is one pipe per data dir, because the namespace is the whole machine', () => {
    expect(socketPath('win32', DATA_DIR)).toBe(socketPath('win32', DATA_DIR));
    expect(socketPath('win32', DATA_DIR)).not.toBe(socketPath('win32', `${DATA_DIR}-other`));
  });

  it('fits a Unix socket address on POSIX, whatever the data dir is called', () => {
    const socket = socketPath('darwin', DATA_DIR);

    // The limit is the address structure's, not the filesystem's, so a `mkdir` being happy says nothing
    expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(100);
    expect(socket).toContain('apack-term-');
  });

  it('gives two data dirs two sockets on POSIX too', () => {
    expect(socketPath('darwin', DATA_DIR)).not.toBe(socketPath('darwin', `${DATA_DIR}-other`));
  });
});
