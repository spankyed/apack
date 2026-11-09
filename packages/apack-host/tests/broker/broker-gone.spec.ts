// What the app is told when the broker dies, driven against the real broker binary.
//
// **A pty dies with the process that owns it, so a broker's death is every session's death** — and the app
// hearing nothing is worse than hearing it. Nothing observed the broker exiting: the client spawns it
// detached, releases the handle, and the only trace of a crash was a socket closing, which drains the calls
// in flight and leaves every session's listener untouched. A terminal then stays drawn as live in front of a
// shell that no longer exists, and nothing in the app ever corrects it.
//
// **It cannot be seen from the broker's side at all**, which is why it is here: a broker that is gone sends
// nothing, so no case in its own suite can be about what its absence means to a client. And it is driven
// against the binary rather than a double for the reason its neighbour `lifetime.spec.ts` is — what is in
// question is this client's reading of a real connection ending.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { holdBrokerSessions, startBroker, type Broker } from '../../src/broker/client.ts';
import { findBrokerBinary } from '../../src/services/terminal.ts';
import { startBrokerProcess } from '../_support/broker-process.ts';

// Asked for the same way the app asks, so this runs where the app would. Empty rather than absent so the
// cases below need no assertion: the describe they are in does not run.
const BINARY = findBrokerBinary() ?? '';

let open: Array<{ close(): void | Promise<void> }> = [];
let directory: string | undefined;

afterEach(async () => {
  for (const one of open.reverse()) await one.close();
  open = [];
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

/** A socket of this case's own, so two cases never share a broker */
function socket(): string {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-gone-'));
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\apack-gone-${process.pid}-${path.basename(directory)}`
    : path.join(directory, 'b.sock');
}

const held = <T extends { close(): void | Promise<void> }>(one: T): T => { open.push(one); return one; };

/** Collects what a session's listener was told, and lets a case await the first of it */
function listener() {
  const exits: Array<number | null> = [];
  let notify = () => {};
  return {
    listeners: { onOutput() {}, onExit(code: number | null) { exits.push(code); notify(); } },
    exits,
    told: (what: string) => _whenSatisfied(
      (tell) => { notify = tell; return () => { notify = () => {}; }; },
      () => (exits.length > 0 ? { exits } : undefined),
      what,
      10_000,
    ),
  };
}

describe.skipIf(!BINARY)('when the broker is gone', () => {
  it('reports every session exited', async () => {
    const at = socket();
    const broker = await startBrokerProcess(BINARY, at);
    const client = await startBroker({ binary: BINARY, socket: at });
    const first = listener();
    const second = listener();
    await client.open({ cols: 80, rows: 24 }, first.listeners);
    await client.open({ cols: 80, rows: 24 }, second.listeners);

    broker.kill();

    await first.told('the first session to be reported exited when the broker died');
    await second.told('the second session to be reported exited when the broker died');

    // `null` and not a status: the shell ended because its owner did, which is what this listener's `null`
    // means everywhere else and what the window words as "without a status (a signal)"
    expect(first.exits, 'the first session was reported exited exactly once').toEqual([null]);
    expect(second.exits, 'every session is reported, not only the first').toEqual([null]);
  });

  it('tells whoever holds it to forget it', async () => {
    const at = socket();
    const broker = await startBrokerProcess(BINARY, at);
    const client = await startBroker({ binary: BINARY, socket: at });
    let forgotten = 0;
    let notify = () => {};
    client.onGone(() => { forgotten += 1; notify(); });
    await client.open({ cols: 80, rows: 24 }, listener().listeners);

    broker.kill();

    await _whenSatisfied(
      (tell) => { notify = tell; return () => { notify = () => {}; }; },
      () => (forgotten > 0 ? { forgotten } : undefined),
      'the broker to be reported gone',
      10_000,
    );
    expect(forgotten, 'a broker that is gone is reported once').toBe(1);
  });

  /**
   * **The half that stops the first case making every shutdown look like a crash.**
   *
   * `close()` leaves the broker without ending its sessions — that is the whole point of the hold — so the
   * socket closing there means the opposite of what it means above, and a client that could not tell the two
   * apart would report every session of a quitting app as crashed and write a red notice into each one.
   *
   * **The wait is a real event rather than a sleep.** A second client's connect and handshake is a round trip
   * to the broker and back, begun after `close()` returned; the close this case is about is local to this
   * process and a tick or two behind `end()`. So a synthesised exit, if one came, has come by the time the
   * second client has a session — the regression fires early and the assertion reads late, which is the
   * direction that cannot pass falsely.
   */
  it('reports nothing when this client leaves deliberately', async () => {
    const at = socket();
    held(await holdBrokerSessions({ binary: BINARY, socket: at }));
    const client = await startBroker({ binary: BINARY, socket: at });
    const leaving = listener();
    let forgotten = 0;
    client.onGone(() => { forgotten += 1; });
    await client.open({ cols: 80, rows: 24 }, leaving.listeners);

    await client.close();

    const other = held(await startBroker({ binary: BINARY, socket: at })) as Broker;
    await other.open({ cols: 80, rows: 24 }, listener().listeners);

    expect(leaving.exits, 'a session this client left behind was reported dead').toEqual([]);
    expect(forgotten, 'a deliberate departure was reported as the broker being gone').toBe(0);
  });
});
