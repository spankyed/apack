// A terminal somewhere else: a broker reached through a command, behind a socket of this app's.
//
// The far side here is a second broker on this machine, reached through the broker's own `proxy` — which
// is everything `ssh host apack-terminal proxy …` is except the transport. What is the app's, and proven
// here, is the socket it puts in front of that command: that a session is opened and typed at through it,
// that a window is pointed at the same socket to draw the session, and that a command which reaches
// nothing says why.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { createTerminalService, findBrokerBinary, terminalViewEndpoint } from '../../src/services/terminal.ts';

const BINARY = findBrokerBinary() ?? '';

// A data dir of this file's own, which the app's sockets are derived from
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-target-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;

let service: ReturnType<typeof createTerminalService> | undefined;
const elsewhere: string[] = [];

/** A place with a broker of its own, as the command that reaches it */
function target(): { command: string[] } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'far-'));
  elsewhere.push(directory);
  return { command: [BINARY, 'proxy', path.join(directory, 'far.sock')] };
}

afterEach(async () => {
  await service?.shutdown();
  service = undefined;
  for (const directory of elsewhere.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

/** A session's output, and a wait for it to hold something */
function reading() {
  let output = '';
  let notify = () => {};
  return {
    listeners: { onOutput(data: string) { output += data; notify(); }, onExit() {} },
    shows: (text: string) => _whenSatisfied(
      (tell) => { notify = tell; return () => { notify = () => {}; }; },
      () => (output.includes(text) ? { output } : undefined),
      `the session to print ${text}`,
      15_000,
    ),
  };
}

describe.skipIf(!BINARY || process.platform === 'win32')('a terminal on a target', () => {
  it('is a shell on the broker the command reaches, typed at like any other', async () => {
    service = createTerminalService();
    const far = reading();
    const session = await service.at(target()).open({ cols: 80, rows: 24, shell: '/bin/sh' }, far.listeners);

    expect(session.target, 'a window has nothing to draw it from').toMatch(/^[0-9a-f]{12}$/);
    await session.write('echo fa$((1+1))r\n');
    await far.shows('fa2r');

    // And it is not the app's own broker: a session there is another shell, on a broker of its own
    const near = reading();
    const local = await service.open({ cols: 80, rows: 24, shell: '/bin/sh' }, near.listeners);
    expect(local.target).toBeNull();
    expect(local.pid).not.toBe(session.pid);
    expect((await service.sessions()).map(({ pid }) => pid), 'the far session is listed on this machine').toEqual([local.pid]);
    const again = { command: [BINARY, 'proxy', path.join(elsewhere[0]!, 'far.sock')] };
    expect((await service.at(again).sessions()).map(({ pid }) => pid), 'the same command is the same target').toEqual([session.pid]);
  });

  it('is drawn by a window from the socket in front of the same command', async () => {
    service = createTerminalService();
    const session = await service.at(target()).open({ cols: 80, rows: 24, shell: '/bin/sh' }, reading().listeners);
    const endpoint = terminalViewEndpoint(session.target!);

    // What a window's preload does: connect, greet, and read the broker's answer
    const answered = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(endpoint.socket);
      let read = '';
      socket.once('connect', () => socket.write(endpoint.greeting));
      socket.on('data', (chunk) => {
        read += chunk.toString('utf8');
        if (read.includes('\n')) { socket.destroy(); resolve(read.slice(0, read.indexOf('\n'))); }
      });
      socket.once('error', reject);
    });
    expect(JSON.parse(answered)).toMatchObject({ kind: 'hello' });
  });

  it('says why when the command reaches nothing', async () => {
    service = createTerminalService();
    const unreachable = { command: ['/bin/sh', '-c', 'echo "ssh: connect to host devbox port 22: No route to host" >&2; exit 255'] };
    await expect(service.at(unreachable).open({ cols: 80, rows: 24 }, reading().listeners))
      .rejects.toThrow(/No route to host/);
  });

  it('is reached once it is there, however often its command reached nothing before', async () => {
    service = createTerminalService();
    // A command that reaches nothing until a file says the far side is up: a network that came back
    const far = target();
    const up = path.join(path.dirname(far.command[2]!), 'up');
    const reaches = { command: ['/bin/sh', '-c', `[ -f "${up}" ] || { echo "not there yet" >&2; exit 255; }; exec "${BINARY}" proxy "${far.command[2]}"`] };

    // More often than a broker of this machine's is given to start, which is a binary that stays broken
    for (let tried = 0; tried < 5; tried += 1) {
      await expect(service.at(reaches).open({ cols: 80, rows: 24 }, reading().listeners)).rejects.toThrow(/not there yet/);
    }
    fs.writeFileSync(up, '');

    const session = await service.at(reaches).open({ cols: 80, rows: 24 }, reading().listeners);
    expect(session.target).toMatch(/^[0-9a-f]{12}$/);
    await session.terminate();
  });
});

describe('where a window is pointed to draw a terminal', () => {
  it('is only ever a socket this app made for a target', () => {
    expect(() => terminalViewEndpoint('../../../etc/passwd')).toThrow(/names no terminal target/);
    expect(() => terminalViewEndpoint('/tmp/some.sock')).toThrow(/names no terminal target/);
    expect(path.basename(terminalViewEndpoint('0123456789ab').socket)).toBe('r-0123456789ab.sock');
    expect(path.dirname(terminalViewEndpoint('0123456789ab').socket)).toBe(path.dirname(terminalViewEndpoint().socket));
  });
});
