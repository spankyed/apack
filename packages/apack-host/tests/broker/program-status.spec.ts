// What a session's programs say they are doing (OSC 7501), through the client and against the broker itself:
// the event, what the session answers when asked, and what a client that did not start the session is told —
// which is what an app that restarted picks its terminals up from.
//
// Against the real broker because the subject is the two halves agreeing: the broker keeps the records by the
// protocol's rules and sends them whole, and this client only reshapes them.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { holdBrokerSessions, startBroker, type Broker, type BrokerSessionEvent, type BrokerStatusRecord } from '../../src/broker/client.ts';
import { findBrokerBinary } from '../../src/services/terminal.ts';

// Asked for the same way the app asks. Empty rather than absent, so the describe below does not run without one
const BINARY = findBrokerBinary() ?? '';

let open: Array<{ close(): void | Promise<void> }> = [];
let directory: string | undefined;

afterEach(async () => {
  for (const one of open.reverse()) await one.close();
  open = [];
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

function socket(): string {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-status-'));
  return path.join(directory, 'b.sock');
}

const held = <T extends { close(): void | Promise<void> }>(one: T): T => { open.push(one); return one; };

/** A report, as the line a shell is typed that prints it */
const says = (body: string) => `printf '\\033]7501;${body}\\033\\\\'\n`;

/** What a session's holder was told of its programs' statuses, and a wait for the next set that satisfies `is` */
function hearing() {
  const told: Array<readonly BrokerStatusRecord[]> = [];
  let notify = () => {};
  return {
    onEvent(event: BrokerSessionEvent) {
      if (event.kind !== 'programStatus') return;
      told.push(event.statuses);
      notify();
    },
    until: (is: (statuses: readonly BrokerStatusRecord[]) => boolean, what: string) => _whenSatisfied(
      (tell) => { notify = tell; return () => { notify = () => {}; }; },
      () => told.find(is),
      what,
      20_000,
    ),
  };
}

// A shell's own `printf` writes the reports, which no shell on Windows has
describe.skipIf(!BINARY || process.platform === 'win32')("what a session's programs say they are doing", () => {
  it('is told whole as it changes, and answered the same when the session is asked', async () => {
    const client = held(await startBroker({ binary: BINARY, socket: socket() })) as Broker;
    const heard = hearing();
    const session = await client.open({ cols: 80, rows: 24, shell: '/bin/sh' }, { onOutput() {}, onEvent: heard.onEvent, onExit() {} });

    await session.write(says('state=working:app=sh:progress=30'));
    const [working] = await heard.until(statuses => statuses.length === 1, 'the first record');
    expect(working).toMatchObject({
      id: '', state: 'working', kind: null, progress: 30, app: 'sh', title: null, message: null,
      // The shell wrote it and the shell is what is in front
      confirmed: 'matched',
    });
    expect(Math.abs(Date.now() - working!.sinceMs), 'when it entered the state, in milliseconds since the epoch').toBeLessThan(60_000);

    // "Apply?", and a program that is not the one in front
    await session.write(says('state=blocked:kind=permission:id=other:app=codex:msg=QXBwbHk/'));
    const both = await heard.until(statuses => statuses.length === 2, 'both records, as they stand');
    expect(both[0]).toEqual(working);
    expect(both[1]).toMatchObject({ id: 'other', state: 'blocked', kind: 'permission', app: 'codex', message: 'Apply?', confirmed: 'mismatched' });
    expect(both[1]!.changed).toBeGreaterThan(both[0]!.changed);

    expect((await session.facts()).statuses).toEqual(both);
    expect((await client.sessions()).find(one => one.id === session.id)?.statuses).toEqual(both);
  });

  it('is what a client that did not start the session picks it up with', async () => {
    const at = socket();
    // Held, as the app holds it, so the session outlives the client that opened it
    held(await holdBrokerSessions({ binary: BINARY, socket: at }));
    const first = (await startBroker({ binary: BINARY, socket: at })) as Broker;
    const heard = hearing();
    const session = await first.open({ cols: 80, rows: 24, shell: '/bin/sh' }, { onOutput() {}, onEvent: heard.onEvent, onExit() {} });
    await session.write(says('state=done:id=build:app=sh'));
    const told = await heard.until(statuses => statuses.length === 1, 'the record');
    await first.close();

    const second = held(await startBroker({ binary: BINARY, socket: at })) as Broker;
    expect((await second.sessions()).find(one => one.id === session.id)?.statuses).toEqual(told);
    const later = hearing();
    const taken = await second.adopt(session.id, { onOutput() {}, onEvent: later.onEvent, onExit() {} });
    expect((await taken.facts()).statuses).toEqual(told);

    // And it hears what the programs say next
    await taken.write(says('state=clear'));
    expect(await later.until(statuses => statuses.length === 0, 'the records going')).toEqual([]);
    await taken.kill();
  });

  it('answers a wait for what the program says of itself', async () => {
    const client = held(await startBroker({ binary: BINARY, socket: socket() })) as Broker;
    const heard = hearing();
    const session = await client.open({ cols: 80, rows: 24, shell: '/bin/sh' }, { onOutput() {}, onEvent: heard.onEvent, onExit() {} });

    const waiting = session.wait({ kind: 'status', states: ['blocked', 'done'] }, 20_000);
    await session.write(says('state=working'));
    await heard.until(statuses => statuses.some(one => one.state === 'working'), 'working');
    await session.write(says('state=blocked:kind=question'));
    expect(await waiting).toBe('MET');
    expect(await session.wait({ kind: 'status', states: ['idle'] }, 200), 'it is not idle, and says nothing more').toBe('TIMEOUT');
  });
});
