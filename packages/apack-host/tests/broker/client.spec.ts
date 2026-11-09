// The app's side of the broker protocol, against a broker that is a script.
//
// **Each side is tested where it lives.** `apack-terminal/tests/broker.rs` drives the real binary over a
// real socket and proves a keystroke reaches a pty; this proves the half that is the app's — the handshake,
// the framing, which events are answers and which are a feed — without needing a Rust build to run the
// host's suite. The seam they meet at is the generated protocol both implement against.
//
// The fake is a Node process on purpose: `startBroker` spawns a binary and waits for its ready line, so a
// stand-in has to be something spawnable that prints one.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { _whenSatisfied, settles } from '@apackdev/sdk/testing/waiting';
import { BrokerError, holdBrokerSessions, startBroker, type Broker } from '../../src/broker/client.ts';

/**
 * A broker in a script: it answers the protocol from a table, so a test can say what it answers.
 *
 * Executable with a shebang rather than run as `node <script>`, because `startBroker` spawns a binary with
 * the socket as its only argument — which is the real broker's shape, and a test must not widen it.
 */
const FAKE = `#!/usr/bin/env node
const net = require('node:net');
const readline = require('node:readline');
const socket = process.argv[2];
const script = JSON.parse(process.env.FAKE_SCRIPT);
const server = net.createServer(connection => {
  readline.createInterface({ input: connection }).on('line', line => {
    const request = JSON.parse(line);
    const answers = (script[request.kind] ?? []).map(event =>
      typeof event === 'string' ? JSON.parse(event.replaceAll('$session', request.session ?? 's-1')) : event);
    if (answers.length === 0) return;
    // **One write, so a request's answers are one read.** Two writes are two syscalls that the socket
    // coalesces or not as it pleases, which makes 'these frames arrive together' a property of the day
    // rather than of the test: the case below whose whole subject is an exit in the same read as its
    // spawned failed about one run in three. Frames within one chunk reach readline in order, so the
    // bursts the other cases rely on are unaffected.
    connection.write(answers.map(event => JSON.stringify(event) + '\\n').join(''));
  });
});
server.listen(socket, () => { process.stdout.write('listening ' + socket + '\\n'); });
`;

let running: Broker | undefined;
let directory: string | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

/** Starts the fake with a table of what it answers each request kind with */
async function broker(script: Record<string, unknown[]>): Promise<Broker> {
  directory = mkdtempSync(path.join(tmpdir(), 'broker-client-'));
  const binary = path.join(directory, 'fake-broker.cjs');
  writeFileSync(binary, FAKE);
  chmodSync(binary, 0o755);
  running = await startBroker({
    binary,
    socket: path.join(directory, 'b.sock'),
    env: { ...process.env, FAKE_SCRIPT: JSON.stringify(script) },
  });
  return running;
}

/** A directory with a broker script in it, for a case that starts one itself rather than through `broker` */
function brokerScript(body: string): { binary: string; socket: string } {
  directory = mkdtempSync(path.join(tmpdir(), 'broker-client-'));
  const binary = path.join(directory, 'fake-broker.cjs');
  writeFileSync(binary, body);
  chmodSync(binary, 0o755);
  return { binary, socket: path.join(directory, 'b.sock') };
}


/**
 * A broker that records every process that got as far as starting, so a case can count how many there were.
 *
 * Appended to rather than written, because the question is how many processes reached that line: a file one
 * of them overwrote would answer "one" however many there had been.
 */
const COUNTING = FAKE.replace(
  'const server = net.createServer',
  "require('node:fs').appendFileSync(process.env.FAKE_PIDS, process.pid + '\\n');\nconst server = net.createServer",
);

/**
 * A broker that exits when its last connection goes, **counted from the accept** as the real one does.
 *
 * That is what makes an un-greeted connection a leak rather than an untidiness: the broker cannot tell a
 * socket nobody will ever greet on from one about to, so it waits for ever.
 */
const COUNTS_CONNECTIONS = `#!/usr/bin/env node
const fs = require('node:fs');
const net = require('node:net');
const readline = require('node:readline');
let open = 0;
const server = net.createServer(connection => {
  open += 1;
  connection.on('close', () => { open -= 1; if (open === 0) process.exit(0); });
  readline.createInterface({ input: connection }).on('line', () => {
    connection.write(JSON.stringify({ kind: 'hello', protocol: 99 }) + '\\n');
  });
});
server.listen(process.argv[2], () => {
  fs.appendFileSync(process.env.FAKE_PIDS, process.pid + '\\n');
  process.stdout.write('listening ' + process.argv[2] + '\\n');
});
`;

/** Signal 0 asks after a pid without touching it; the pid came from the process that wrote it */
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/**
 * Waits until a process is gone.
 *
 * Polled rather than subscribed to: nothing emits an event when *another* process exits, which is what
 * `settles` is for. Its bound is the progress guard around the test rather than a clock, so a machine that
 * slows the wait slows the exit it is waiting for by the same load — which a 5s deadline here did not.
 */
const untilGone = (pid: number): Promise<void> =>
  settles(() => {
    if (alive(pid)) throw new Error(`the broker (${pid}) is still running`);
  });

/** The pid of the one broker a case started, read from where the script recorded it */
const recordedPids = (file: string) =>
  readFileSync(file, 'utf8').split('\n').filter(Boolean).map(Number);

/** The two every test needs: a greeting, and a session to open */
const GREETS = { hello: [{ kind: 'hello', protocol: 1 }] };
const OPENS = { ...GREETS, spawn: [{ kind: 'spawned', session: 's-1', pid: 4242 }] };

describe('the broker client', () => {
  it('greets the broker before anything else, and opens a session it is told about', async () => {
    const session = await (await broker(OPENS)).open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    expect(session).toMatchObject({ id: 's-1', pid: 4242 });
  });

  it('refuses a broker that speaks another protocol, naming both', async () => {
    await expect(broker({ hello: [{ kind: 'hello', protocol: 99 }] }))
      .rejects.toThrow(/broker speaks protocol 99.*app speaks 1/);
  });

  it('delivers output to the session that produced it, and never to a caller waiting for an answer', async () => {
    // The burst arrives before the answer, which is the ordering that loses an answer if output is consumed
    // by whoever is waiting for one
    const fake = await broker({
      ...GREETS,
      spawn: [
        { kind: 'output', session: 's-1', data: 'before ' },
        { kind: 'output', session: 's-1', data: 'the answer' },
        { kind: 'spawned', session: 's-1', pid: 7 },
      ],
    });

    const output: string[] = [];
    const session = await fake.open({ cols: 80, rows: 24 }, { onOutput: data => output.push(data), onExit() {} });

    expect(session.id, 'the answer survived the burst in front of it').toBe('s-1');
    // The listener is registered when the answer arrives, so output ahead of it belongs to no session yet:
    // what matters is that it was not mistaken for the answer
    expect(output.join('')).not.toContain('spawned');
  });

  it('delivers an exit once, to the session that ended', async () => {
    const fake = await broker({ ...OPENS, kill: ['{"kind":"exited","session":"$session","code":0}'] });
    const exits: Array<number | null> = [];
    let exited = () => {};
    const session = await fake.open({ cols: 80, rows: 24 }, {
      onOutput() {},
      onExit: code => { exits.push(code); exited(); },
    });

    await session.kill();
    // Awaiting the exit itself, not a sleep long enough for one: the listener is the notification
    await _whenSatisfied(notify => { exited = notify; return () => { exited = () => {}; }; },
      () => (exits.length > 0 ? exits : undefined), 'the exit the broker reported');

    expect(exits, 'one exit, delivered once').toEqual([0]);
  });

  it('raises a refusal as its code, not as a message to match on', async () => {
    const fake = await broker({
      ...GREETS,
      spawn: [{ kind: 'failed', session: null, code: 'PTY', message: 'opening a pty: nope' }],
    });

    const refused = fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });
    await expect(refused).rejects.toBeInstanceOf(BrokerError);
    await expect(refused).rejects.toMatchObject({ code: 'PTY' });
  });

  it('reads a session\'s screen, and gives each answer to the session that asked', async () => {
    // Two sessions, each answered with its own id: the frames carry no call, so the session is the whole of
    // the correlation and an answer taken for the other one's ask is the bug this pins
    const fake = await broker({
      ...GREETS,
      spawn: [{ kind: 'spawned', session: 's-1', pid: 1 }, { kind: 'spawned', session: 's-2', pid: 2 }],
      screen: [
        { kind: 'screen', session: 's-2', lines: ['theirs'], cursor_row: 0, cursor_column: 6, alt_screen: true },
        { kind: 'screen', session: 's-1', lines: ['scrolled off', 'mine'], cursor_row: 1, cursor_column: 4, alt_screen: false },
      ],
    });
    const listeners = { onOutput() {}, onExit() {} };
    const first = await fake.open({ cols: 80, rows: 24 }, listeners);

    const screen = await first.screen(20);

    expect(screen).toEqual({
      lines: ['scrolled off', 'mine'],
      cursorRow: 1,
      cursorColumn: 4,
      altScreen: false,
    });
  });

  /**
   * **A refusal is matched, as an answer is.** A call about a session filters the answer it waits for by that
   * session; the refusal path used to reject `waiting.shift()` instead — whoever was at the head of the
   * queue. So a refusal about another terminal failed this caller, and this caller's real answer then
   * matched no waiter and hung until the socket closed.
   */
  it('lets a refusal about another session pass, and still answers the call that asked', async () => {
    const fake = await broker({
      ...OPENS,
      // The refusal names a session nobody here waits on — a `write` to a dead terminal is where one comes
      // from, and writes wait for nothing — and it arrives *first*, so a client that shifted the queue would
      // have rejected the caller below before its answer landed
      screen: [
        { kind: 'failed', session: 's-2', code: 'NO_SUCH_SESSION', message: 's-2 is gone' },
        { kind: 'screen', session: 's-1', lines: ['mine'], cursor_row: 0, cursor_column: 4, alt_screen: false },
      ],
    });
    const session = await fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    const screen = await session.screen(20);

    expect(screen.lines, 'another session s refusal rejected this call').toEqual(['mine']);
  });

  it('refuses the call a refusal names, so a caller hears its own failure', async () => {
    const fake = await broker({
      ...OPENS,
      screen: [{ kind: 'failed', session: 's-1', code: 'NO_SUCH_SESSION', message: 's-1 is gone' }],
    });
    const session = await fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    await expect(session.screen(20)).rejects.toThrow(/s-1 is gone/);
  });

  /**
   * **A session's listener is registered in the turn its `spawned` frame is read.**
   *
   * A promise settles in a microtask and readline emits every buffered line synchronously, so a shell that
   * dies instantly — a bad `--init-file`, `cmd /K` on a missing script — sends `spawned` and `exited`
   * microseconds apart and both arrive in one read. Registering after the `await` was too late: the exit
   * found no listener, `onExit` never fired, and the terminal showed as live behind a dead shell for ever.
   * That is X2 again, on this side of the socket.
   */
  it('hears an exit that arrives in the same read as the session it is about', async () => {
    const fake = await broker({
      ...GREETS,
      spawn: [{ kind: 'spawned', session: 's-1', pid: 7 }, { kind: 'exited', session: 's-1', code: 1 }],
    });
    let ended: number | null | undefined;

    await fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit(code) { ended = code; } });

    expect(ended, 'the exit arrived before the listener existed').toBe(1);
  });

  /**
   * **A broker that starts and says nothing is reported, not awaited.** Its listening line is what says it is
   * up; a broker that writes that to stderr, or stalls before writing it, settles neither `exit` nor `line`.
   * The caller's own `catch` then never runs — `holdTerminalSessionsForTheApp` logs a failure and carries on,
   * so a hang is the one shape that silences it.
   */
  it('gives up on a broker that starts and never says where it is listening', async () => {
    const { binary, socket } = brokerScript(
      // Alive, holding its stdout open, and saying nothing on it: what a listening line on stderr looks like
      "#!/usr/bin/env node\nprocess.stderr.write('listening on the wrong stream\\n');\nsetInterval(() => {}, 1000);\n",
    );

    await expect(startBroker({ binary, socket, startMs: 300 }))
      .rejects.toThrow(/did not say where it was listening within 300ms/);
  });

  /**
   * **The hold reads the answer to its own greeting.** It can be refused — a broker speaking another protocol
   * answers `failed` with `HANDSHAKE` — and a hold that only wrote reported success while the sessions it
   * believed it owned had no owner, which is the one state this function exists to prevent.
   */
  it('refuses a lifetime hold the broker did not accept', async () => {
    const { binary, socket } = brokerScript(FAKE);
    const env = { ...process.env, FAKE_SCRIPT: JSON.stringify({ hello: [{ kind: 'hello', protocol: 99 }] }) };

    await expect(holdBrokerSessions({ binary, socket, env })).rejects.toThrow(/speaks protocol 99/);
  });


  /**
   * **Two callers finding nothing listening must not both start one.**
   *
   * The broker binds with `try_overwrite`, so a second takes the address and leaves the first one's sessions
   * unreachable with no error anywhere. The window is a whole startup — long enough that this is reached by
   * ordinary means rather than by bad luck: Electron main takes its lifetime hold while the API server
   * starts in the same tick, and every dev API reload is another.
   */
  it('starts one broker when two callers find none', async () => {
    const { binary, socket } = brokerScript(COUNTING);
    const pids = path.join(directory!, 'pids');
    writeFileSync(pids, '');
    const env = { ...process.env, FAKE_SCRIPT: JSON.stringify(GREETS), FAKE_PIDS: pids };

    const [first, second] = await Promise.all([
      startBroker({ binary, socket, env }),
      startBroker({ binary, socket, env }),
    ]);
    try {
      expect(recordedPids(pids), 'both callers spawned a broker, and the second took the first one\'s address')
        .toHaveLength(1);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('kills a broker that never reported listening, rather than leaving it holding the socket', async () => {
    const { binary, socket } = brokerScript(`#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.FAKE_PIDS, process.pid + '\\n');
setInterval(() => {}, 1_000);
`);
    const pids = path.join(directory!, 'pids');
    writeFileSync(pids, '');

    await expect(startBroker({ binary, socket, startMs: 400, env: { ...process.env, FAKE_PIDS: pids } }))
      .rejects.toThrow(/did not say where it was listening/);

    // Spawned detached and its handle dropped on the way out, so nothing can reach it again: left running it
    // holds the socket path the next attempt will try to bind, and its pipes keep this process alive
    await untilGone(recordedPids(pids)[0]!);
  });

  it('leaves no connection behind when a handshake is refused, so the broker can still exit', async () => {
    const { binary, socket } = brokerScript(COUNTS_CONNECTIONS);
    const pids = path.join(directory!, 'pids');
    writeFileSync(pids, '');

    await expect(holdBrokerSessions({ binary, socket, env: { ...process.env, FAKE_PIDS: pids } }))
      .rejects.toThrow(/speaks protocol 99/);

    // The refusal arrives as a `failed` frame, which rejects the await rather than reaching the version
    // check — so a teardown on that branch alone leaves the commonest refusal holding a connection for ever
    await untilGone(recordedPids(pids)[0]!);
  });

  it('says why a broker that never listened did not start, rather than timing out', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'broker-client-'));
    const binary = path.join(directory, 'silent.cjs');
    writeFileSync(binary, "#!/usr/bin/env node\nprocess.stderr.write('no socket for me\\n'); process.exit(3);");
    chmodSync(binary, 0o755);

    await expect(startBroker({ binary, socket: path.join(directory, 'b.sock') }))
      .rejects.toThrow(/exited with 3 before it was listening.*no socket for me/s);
  });
  /**
   * **A reported status of nothing is not a status of zero**, which is the one thing a typecheck cannot catch
   * here: the wire is `exit_status` and the contract is `exitStatus`, and a mapping that filled an absent
   * value with a default would report every command as having succeeded.
   */
  it("reports a session's facts as the shell stated them, a missing status included", async () => {
    const fake = await broker({
      ...OPENS,
      facts: [
        { kind: 'facts', session: 's-1', cwd: '/home/me/w d', command: 'cargo test', running: true, exit_status: null },
      ],
    });
    const session = await fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    expect(await session.facts()).toEqual({
      cwd: '/home/me/w d',
      command: 'cargo test',
      running: true,
      exitStatus: null,
      // A broker that answers no foreground says so as `null`, never as a missing field: a caller reading
      // `facts.foreground?.name` cannot tell those apart, and one reading `'foreground' in facts` would
      // get a different answer on Windows than on a shell this broker could not measure
      foreground: null,
    });
  });

  it('reports what the kernel says is running, beside what the shell claimed', async () => {
    // The case the measurement exists for: a shell with no integration installed claims nothing at all,
    // so every other field here is empty and `foreground` is the only answer to "what is this doing"
    const fake = await broker({
      ...OPENS,
      facts: [
        {
          kind: 'facts',
          session: 's-1',
          cwd: null,
          command: null,
          running: false,
          exit_status: null,
          foreground: { pid: 4321, name: 'vim' },
        },
      ],
    });
    const session = await fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    expect(await session.facts()).toEqual({
      cwd: null,
      command: null,
      running: false,
      exitStatus: null,
      foreground: { pid: 4321, name: 'vim' },
    });
  });

  it('reports a reported status as the number it was', async () => {
    const fake = await broker({
      ...OPENS,
      facts: [{ kind: 'facts', session: 's-1', cwd: null, command: null, running: false, exit_status: 130 }],
    });
    const session = await fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    expect((await session.facts()).exitStatus).toBe(130);
  });

  it("searches a session's screen and gives each answer to the session that asked", async () => {
    const fake = await broker({
      ...GREETS,
      spawn: [{ kind: 'spawned', session: 's-1', pid: 1 }, { kind: 'spawned', session: 's-2', pid: 2 }],
      search: [
        { kind: 'search', session: 's-2', matches: [{ line: 0, column: 0, text: 'theirs' }] },
        { kind: 'search', session: 's-1', matches: [{ line: 3, column: 7, text: 'error: mine' }] },
      ],
    });
    const session = await fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    expect(await session.search('error', 100)).toEqual([{ line: 3, column: 7, text: 'error: mine' }]);
  });

  /**
   * **The broker owns the deadline, so the client waits for its answer and keeps no timer of its own.** Two
   * deadlines would disagree, and the one that matters is the one holding the waiter — so a `TIMEOUT` is
   * something the broker said rather than something the client concluded.
   */
  it('waits for the broker to say how a wait ended, for the session that asked', async () => {
    const fake = await broker({
      ...GREETS,
      spawn: [{ kind: 'spawned', session: 's-1', pid: 1 }, { kind: 'spawned', session: 's-2', pid: 2 }],
      wait: [
        { kind: 'waited', session: 's-2', outcome: 'MET' },
        { kind: 'waited', session: 's-1', outcome: 'TIMEOUT' },
      ],
    });
    const session = await fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });

    expect(await session.wait({ kind: 'text', text: 'never written' }, 50)).toBe('TIMEOUT');
  });
});
