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
import { brokerEnvironment } from '../../src/services/terminal.ts';

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

  it('says the terminal is a capable one', () => {
    const shell = brokerEnvironment(asTheApiProcess());

    expect(shell.TERM_PROGRAM).toBe('apack');
    expect(shell.COLORTERM).toBe('truecolor');
  });

  it('strips every name the list holds, so the list is not describing nothing', () => {
    // A population check over the declaration itself: a rule derived from an empty list passes every case
    // above while protecting nothing
    expect(APP_PROCESS_ENV_VARS.length).toBeGreaterThan(5);
    expect(APP_PROCESS_ENV_VARS).toContain('ELECTRON_RUN_AS_NODE');
    expect(APP_PROCESS_ENV_VARS).toContain('APACK_API_TOKEN');
  });
});
