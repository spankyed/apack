// Who ends a session, driven against the real broker binary.
//
// **The rule this covers cannot be seen from either side alone.** The broker's own suite proves that a
// `lifetime` connection holds its sessions and that a client leaving ends them when nothing does; what it
// cannot prove is that this app's client and its hold ask for those roles — a client that greeted as an
// owner would keep every shell running after the app was gone, and every case on both sides would still
// pass. So this drives the two together, against the binary the app actually runs.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { holdBrokerSessions, startBroker, type Broker } from '../../src/broker/client.ts';
import { findBrokerBinary } from '../../src/services/terminal.ts';

// **Asked for the same way the app asks**, which is what makes this run where the app would: the
// `apack-terminal` package's binary, wherever it was staged. It named a path into the checkout's
// `target/debug` before, which exists on no CI runner, so every case here was skipped on every CI run — a
// suite that reported nothing because it had looked at nothing.
//
// Empty rather than absent so the cases below need no assertion: the describe they are in does not run.
const BINARY = findBrokerBinary() ?? '';

/** Whether a pid is still running, asked of the OS rather than of the broker */
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Waits for the OS to agree the process is gone, or gives up so a case fails rather than hangs */
async function reaped(pid: number): Promise<boolean> {
  for (let waited = 0; waited < 100; waited += 1) {
    if (!alive(pid)) return true;
    await new Promise(settle => setTimeout(settle, 50));
  }
  return false;
}

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
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-lifetime-'));
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\apack-lifetime-${process.pid}-${path.basename(directory)}`
    : path.join(directory, 'b.sock');
}

const held = <T extends { close(): void | Promise<void> }>(one: T): T => { open.push(one); return one; };

describe.skipIf(!BINARY)('who ends a session', () => {
  it('keeps a session when its client leaves and an owner holds the broker', async () => {
    const at = socket();
    held(await holdBrokerSessions({ binary: BINARY, socket: at }));
    const client = held(await startBroker({ binary: BINARY, socket: at })) as Broker;

    const session = await client.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });
    await client.close();

    // **Nothing to await, so the wait is bare and listed as such.** The subject is a session that must
    // *not* end, and attach is deliberately absent from this client — a second one cannot ask about a
    // session it did not open — so there is no event that says "still here". Load can only make this pass
    // falsely, never fail falsely, which is the shape `BARE_WAIT_BY_DESIGN` is for.
    await new Promise(settle => setTimeout(settle, 500));

    expect(alive(session.pid!), 'the shell outlived the client that opened it').toBe(true);
  });

  /**
   * **The half that stops the first one being a leak.** A hold that never ends anything would satisfy the
   * case above and leave a user's shells running after they quit.
   */
  it('ends every session when the owner lets go', async () => {
    const at = socket();
    const hold = await holdBrokerSessions({ binary: BINARY, socket: at });
    const client = held(await startBroker({ binary: BINARY, socket: at })) as Broker;
    let ended: number | null | undefined;
    let notify = () => {};
    const session = await client.open(
      { cols: 80, rows: 24 },
      { onOutput() {}, onExit(code) { ended = code; notify(); } },
    );

    hold.close();

    // The client is still connected, so the session ending is an event it hears — await that rather than
    // the OS forgetting a pid, which is the same fact arriving later and through a worse witness
    await _whenSatisfied(
      (tell) => { notify = tell; return () => { notify = () => {}; }; },
      () => (ended !== undefined ? { ended } : undefined),
      'the session to end when its owner let go',
      10_000,
    );

    expect(ended, 'the broker reported the session ending').not.toBeUndefined();
    expect(alive(session.pid!), 'the shell outlived the app that owned it').toBe(false);
  });

  /**
   * With nobody holding the broker, a client leaving ends its sessions — which is what keeps a dev run, a
   * test and the CLI from leaving shells behind, and is why failing to take the hold is safe.
   */
  it('ends a session when the last client leaves and nothing owns the broker', async () => {
    const at = socket();
    const client = (await startBroker({ binary: BINARY, socket: at })) as Broker;
    const session = await client.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    await client.close();

    expect(await reaped(session.pid!), 'a client with no owner left its shell running').toBe(true);
  });
});
