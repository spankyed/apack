// What the next session gets after the broker the service was holding has died.
//
// **The recovery is that the service forgets, and nothing more.** A session is already started lazily — the
// first `open()` starts the broker — so the path that recovers is the path that starts one in the first
// place, and what stops it running is a resolved promise naming a broker that is gone. This is the case that
// says the forgetting happens, and it is a service case rather than a client one because the remembering is
// the service's.
//
// Without it, the next `open()` writes its request to a destroyed socket and waits for an answer that can
// never come — the connection closing is what would have refused it, and that has already happened. So the
// failure this guards against is a hang rather than an error, which is the shape worth having a case for.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { createTerminalService, findBrokerBinary, socketPath } from '../../src/services/terminal.ts';
import { startBrokerProcess } from '../_support/broker-process.ts';

const BINARY = findBrokerBinary() ?? '';

// A data dir of this file's own, which is what `socketPath` derives the broker's socket from: one broker per
// data dir is the rule, so this is also what keeps it off the developer's own broker
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-recovery-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;

/** Whether a pid is still running, asked of the OS rather than of the broker */
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

let service: { shutdown(): Promise<void> } | undefined;

afterEach(async () => {
  await service?.shutdown();
  service = undefined;
});

describe.skipIf(!BINARY)('after the broker it was holding died', () => {
  it('starts a fresh one for the next session', async () => {
    const at = socketPath();
    const broker = await startBrokerProcess(BINARY, at);
    const started = createTerminalService();
    service = started;

    const exits: Array<number | null> = [];
    let notify = () => {};
    const first = await started.open(
      { cols: 80, rows: 24 },
      { onOutput() {}, onExit(code) { exits.push(code); notify(); } },
    );

    broker.kill();

    await _whenSatisfied(
      (tell) => { notify = tell; return () => { notify = () => {}; }; },
      () => (exits.length > 0 ? { exits } : undefined),
      'the session to be reported exited when the broker died',
      10_000,
    );

    // The broker left its socket path behind, which must not refuse the next one's bind — it takes the
    // address with `try_overwrite` for exactly this. So the next session is a fresh broker's, started
    // through the same lazy path a first session takes.
    const next = await started.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    // **The pid and not the session id.** A session id is a counter the broker keeps, so a fresh broker
    // numbers its first session exactly as the dead one did — `s-1` both times, which is what this case
    // asserted first and why it is worth writing down. The shell's pid is the OS's, so it is the one of the
    // two that says a new process answered; that the call returned at all is the rest of the proof, since
    // the socket the service was holding is gone and a request written to it would be answered by nobody.
    expect(alive(next.pid!), 'the next session named a shell that is not running').toBe(true);
    expect(next.pid, 'the next session is the dead broker and not a fresh one').not.toBe(first.pid);
    expect(exits, 'the session the dead broker held was reported exited').toEqual([null]);
  });
});
