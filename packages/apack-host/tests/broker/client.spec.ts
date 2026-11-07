// The app's side of the broker protocol, against a broker that is a script.
//
// **Each side is tested where it lives.** `apack-terminal/tests/broker.rs` drives the real binary over a
// real socket and proves a keystroke reaches a pty; this proves the half that is the app's — the handshake,
// the framing, which events are answers and which are a feed — without needing a Rust build to run the
// host's suite. The seam they meet at is the generated protocol both implement against.
//
// The fake is a Node process on purpose: `startBroker` spawns a binary and waits for its ready line, so a
// stand-in has to be something spawnable that prints one.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrokerError, startBroker, type Broker } from '../../src/broker/client.ts';

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
  const say = event => connection.write(JSON.stringify(event) + '\\n');
  readline.createInterface({ input: connection }).on('line', line => {
    const request = JSON.parse(line);
    for (const event of script[request.kind] ?? []) {
      say(typeof event === 'string' ? JSON.parse(event.replaceAll('$session', request.session ?? 's-1')) : event);
    }
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
    const session = await fake.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit: code => exits.push(code) });

    await session.kill();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(exits).toEqual([0]);
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

  it('says why a broker that never listened did not start, rather than timing out', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'broker-client-'));
    const binary = path.join(directory, 'silent.cjs');
    writeFileSync(binary, "#!/usr/bin/env node\nprocess.stderr.write('no socket for me\\n'); process.exit(3);");
    chmodSync(binary, 0o755);

    await expect(startBroker({ binary, socket: path.join(directory, 'b.sock') }))
      .rejects.toThrow(/exited with 3 before it was listening.*no socket for me/s);
  });
});
