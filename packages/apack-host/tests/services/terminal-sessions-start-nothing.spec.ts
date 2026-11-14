// What asking for the sessions costs when no broker is running.
//
// **A broker that is not running has no sessions, and asking must not be what starts one.** The code
// feature asks at every launch and after every reset, to end shells a previous run left that no
// terminal took up. An app in which nobody opens a terminal would otherwise start a broker each time,
// to be told it holds nothing.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTerminalService, findBrokerBinary, socketPath } from '../../src/services/terminal.ts';
import { startBrokerProcess, type StartedBroker } from '../_support/broker-process.ts';

const BINARY = findBrokerBinary() ?? '';

// A data dir of this file's own, which is what `socketPath` derives the broker's socket from
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-sessions-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;

/** Whether anything accepts a connection where this data dir's broker listens */
const listening = () => new Promise<boolean>((resolve) => {
  const socket = net.createConnection(socketPath());
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

let service: ReturnType<typeof createTerminalService> | undefined;
let started: StartedBroker | undefined;

afterEach(async () => {
  await service?.shutdown();
  service = undefined;
  await started?.kill();
  started = undefined;
});

describe.skipIf(!BINARY)('asking what sessions are running', () => {
  it('answers none, and starts no broker, where none is running', async () => {
    service = createTerminalService();

    expect(await service.sessions()).toEqual([]);
    expect(await listening(), 'a broker was started to be asked what it holds').toBe(false);
    // And asking again is the same answer, not a start that was put off
    expect(await service.sessions()).toEqual([]);
    expect(await listening()).toBe(false);
  });

  it('asks the broker that is running, and goes on using it', async () => {
    started = await startBrokerProcess(BINARY, socketPath());
    service = createTerminalService();
    expect(await service.sessions()).toEqual([]);

    const session = await service.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });
    expect((await service.sessions()).map(one => one.id)).toEqual([session.id]);
    await session.terminate();
  });

  it('starts one for a session, having found none to ask', async () => {
    service = createTerminalService();
    expect(await service.sessions()).toEqual([]);

    const session = await service.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} });
    expect((await service.sessions()).map(one => one.id)).toEqual([session.id]);
    await session.terminate();
  });
});
