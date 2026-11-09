// What the user is told after the broker has failed to start, and what stops the app trying for ever.
//
// **Every start here is a session somebody asked for.** A failed start is deliberately not remembered as a
// broker, so the next `open()` tries again — which is what lets a contributor build the binary and retry
// without restarting the app. The cost of that, unbounded, is that a binary which cannot start pays a
// process launch and a readiness wait on every click of "new terminal", for the life of the run, to arrive
// at the same failure.
//
// So the attempts are counted against what they were tried with, and what the user is then told is what the
// broker itself said rather than a message about having given up. The forgiveness is the half worth a case:
// it is keyed on the binary rather than on a clock, because a cooldown forgives a binary that is still
// broken and goes back to spawning a process that cannot start, only slower.
//
// Driven against a script that fails on purpose, since what is in question is the service's counting and not
// any real broker's behaviour.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createTerminalService } from '../../src/services/terminal.ts';

// Set before `socketPath()` is ever asked, as this file's neighbour does: one broker per data dir is the
// rule, so a data dir of its own is what keeps these cases off the developer's own broker
const dataDir = mkdtempSync(path.join(tmpdir(), 'terminal-start-budget-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;

/** What the broker said on its way out, which the failure the user sees has to carry */
const SAID = 'the pty could not be opened';

/**
 * A broker that records being started and then fails.
 *
 * It counts into a file beside itself rather than one named in its environment, because the environment a
 * service-started broker gets is the service's to decide (`brokerEnvironment`) and not a test's to inject.
 * A script knows its own path, which is enough.
 */
const failing = (padding = '') => `#!/usr/bin/env node
require('node:fs').appendFileSync(process.argv[1] + '.count', 'x');
process.stderr.write(${JSON.stringify(`${SAID}\n`)});
process.exit(1);
${padding}`;

let service: { shutdown(): Promise<void> } | undefined;

afterEach(async () => {
  await service?.shutdown();
  service = undefined;
  delete process.env.APACK_TERMINAL_BINARY;
});

/** The binary the service will find, written fresh so each case owns its count */
function brokerThatFails(body = failing()): { binary: string; counted: () => number } {
  const binary = path.join(mkdtempSync(path.join(tmpdir(), 'failing-broker-')), 'apack-terminal');
  writeFileSync(binary, body);
  chmodSync(binary, 0o755);
  process.env.APACK_TERMINAL_BINARY = binary;
  return {
    binary,
    counted: () => {
      try { return readFileSync(`${binary}.count`, 'utf8').length; } catch { return 0; }
    },
  };
}

const openOne = (held: ReturnType<typeof createTerminalService>) =>
  held.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} }).then(() => undefined, (error: unknown) => error);

describe('a broker that will not start', () => {
  it('is tried three times and then refused with what it said, without spawning again', async () => {
    const { counted } = brokerThatFails();
    const held = createTerminalService();
    service = held;

    const failures = [await openOne(held), await openOne(held), await openOne(held), await openOne(held)];

    // Every one of the four sessions failed, and the fourth did so without a fourth process
    expect(failures.every((one) => one instanceof Error)).toBe(true);
    expect(counted()).toBe(3);
    // What the user is shown is the broker's own stderr, which `startBroker` collects, and the refusal
    // carries it rather than replacing it with a message about the budget
    expect((failures[3] as Error).message).toContain(SAID);
  });

  it('is tried again once the binary changes, which is the only thing that might fix it', async () => {
    const { binary, counted } = brokerThatFails();
    const held = createTerminalService();
    service = held;

    for (let attempt = 0; attempt < 4; attempt++) await openOne(held);
    expect(counted()).toBe(3);

    // A rebuild, as a contributor's would be: the same path, different bytes
    writeFileSync(binary, failing('// built again\n'));
    chmodSync(binary, 0o755);

    expect(await openOne(held)).toBeInstanceOf(Error);
    expect(counted()).toBe(4);
  });
});
