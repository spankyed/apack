import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import {
  connectToolSocket,
  inspectApiRuntimeFile,
  MAX_POSIX_SOCKET_PATH_BYTES,
  readApiRuntimeFile,
  removeApiRuntimeFile,
  runtimeFilePath,
  shouldExposeToolSocket,
  startToolSocketServer,
  toolSocketAddress,
  writeApiRuntimeFile,
  type ToolSocketServer,
} from '../../src/transport/tool-socket.ts';

const isPosix = process.platform !== 'win32';
const cleanupDirs: string[] = [];
const activeServers: ToolSocketServer[] = [];
const activeRawServers: net.Server[] = [];
const activeSockets: net.Socket[] = [];

function makeTempDir(prefix = 'tool-socket-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

/** Short isolated tmp root under `/tmp` on POSIX so custom `tmpDir` tests stay well under macOS's 104-byte `sun_path` cap. */
function makeShortTmpDir(): string {
  const base = isPosix ? '/tmp' : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'apack-ts-'));
  cleanupDirs.push(dir);
  return dir;
}

function trackServer(server: ToolSocketServer): ToolSocketServer {
  activeServers.push(server);
  return server;
}

function trackSocket(socket: net.Socket): net.Socket {
  activeSockets.push(socket);
  return socket;
}

/** Collects all bytes from `socket` (prefixed with `initialBytes`) until `'end'` or `'close'`. */
function readAll(socket: net.Socket, initialBytes: Buffer = Buffer.alloc(0)): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = initialBytes.length > 0 ? [initialBytes] : [];
    const onData = (chunk: Buffer) => { parts.push(chunk); };
    const onDone = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      resolve(Buffer.concat(parts));
    };
    const onError = (err: Error) => {
      socket.off('data', onData);
      socket.off('end', onDone);
      socket.off('close', onDone);
      reject(err);
    };
    socket.on('data', onData);
    socket.once('end', onDone);
    socket.once('close', onDone);
    socket.once('error', onError);
  });
}

function waitForClose(socket: net.Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise<void>((resolve) => {
    socket.on('error', () => {});
    socket.once('close', () => resolve());
  });
}

/** Spawns a short-lived Node process and returns its PID once it has exited. */
async function exitedPid(): Promise<number> {
  const proc = execFileWhileWorking(process.execPath, ['-e', '']);
  await proc;
  return proc.child.pid!;
}

afterEach(async () => {
  for (const socket of activeSockets.splice(0)) {
    socket.on('error', () => {});
    socket.destroy();
  }
  for (const server of activeServers.splice(0)) {
    await server.close();
  }
  for (const raw of activeRawServers.splice(0)) {
    await new Promise<void>((resolve) => {
      if (!raw.listening) { resolve(); return; }
      raw.close(() => resolve());
    });
  }
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('api-runtime.json discovery record', () => {
  it('enables the tool socket only for development, test, or APACK_TOOL_SOCKET=1', () => {
    expect(shouldExposeToolSocket('development', {})).toBe(true);
    expect(shouldExposeToolSocket('test', {})).toBe(true);
    expect(shouldExposeToolSocket('production', {})).toBe(false);
    expect(shouldExposeToolSocket('beta', {})).toBe(false);
    expect(shouldExposeToolSocket('preview', {})).toBe(false);
    expect(shouldExposeToolSocket('production', { APACK_TOOL_SOCKET: '1' })).toBe(true);
    expect(shouldExposeToolSocket('production', { APACK_TOOL_SOCKET: '0' })).toBe(false);
  });

  it('writes 0600 records for production ({ pid }) and dev ({ pid, socket, token }) and reads them back', () => {
    const appDir = makeTempDir();
    const file = runtimeFilePath(appDir);
    expect(file).toBe(path.join(appDir, 'api-runtime.json'));

    writeApiRuntimeFile(appDir, { pid: process.pid });
    if (isPosix) {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ pid: process.pid });
    expect(readApiRuntimeFile(appDir)).toEqual({ pid: process.pid });
    expect(inspectApiRuntimeFile(appDir)).toEqual({ status: 'live', record: { pid: process.pid } });

    const devRecord = { pid: process.pid, socket: '/tmp/apack-501/api-0123456789abcdef.sock', token: 'secret-token' };
    writeApiRuntimeFile(appDir, devRecord);
    if (isPosix) {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(readApiRuntimeFile(appDir)).toEqual(devRecord);
    expect(inspectApiRuntimeFile(appDir)).toEqual({ status: 'live', record: devRecord });
  });

  it('rejects malformed records on write', () => {
    const appDir = makeTempDir();
    expect(() => writeApiRuntimeFile(appDir, { pid: 0 })).toThrow();
    expect(() => writeApiRuntimeFile(appDir, { pid: -5 })).toThrow();
    expect(() => writeApiRuntimeFile(appDir, { pid: process.pid, socket: '/tmp/a.sock' })).toThrow();
    expect(() => writeApiRuntimeFile(appDir, { pid: process.pid, token: 'tok' })).toThrow();
    expect(() => writeApiRuntimeFile(appDir, { pid: process.pid, socket: '', token: 'tok' })).toThrow();
  });

  it('classifies missing, corrupt, and stale-PID records accurately', async () => {
    const appDir = makeTempDir();
    const file = runtimeFilePath(appDir);

    // Missing
    expect(readApiRuntimeFile(appDir)).toBeUndefined();
    expect(inspectApiRuntimeFile(appDir)).toEqual({ status: 'missing' });

    // Corrupt variants
    const corruptPayloads = [
      '',
      'not json',
      'null',
      '[]',
      JSON.stringify({ pid: -1 }),
      JSON.stringify({ pid: 1.5 }),
      JSON.stringify({ pid: process.pid, socket: '/tmp/a.sock' }),
      JSON.stringify({ pid: process.pid, token: 'abc' }),
      JSON.stringify({ pid: process.pid, socket: '/tmp/a.sock', token: 'abc', extra: true }),
    ];
    for (const payload of corruptPayloads) {
      fs.writeFileSync(file, payload, 'utf-8');
      expect(readApiRuntimeFile(appDir), payload).toBeUndefined();
      expect(inspectApiRuntimeFile(appDir), payload).toEqual({ status: 'corrupt' });
    }

    // Stale dead PID
    const deadPid = await exitedPid();
    writeApiRuntimeFile(appDir, { pid: deadPid, socket: '/tmp/dead.sock', token: 'dead-token' });
    expect(readApiRuntimeFile(appDir)).toBeUndefined();
    expect(inspectApiRuntimeFile(appDir)).toEqual({
      status: 'stale',
      record: { pid: deadPid, socket: '/tmp/dead.sock', token: 'dead-token' },
    });

    // Stale pre-boot mtime with live PID
    writeApiRuntimeFile(appDir, { pid: process.pid });
    const preBoot = new Date(Date.now() - os.uptime() * 1000 - 60_000);
    fs.utimesSync(file, preBoot, preBoot);
    expect(readApiRuntimeFile(appDir)).toBeUndefined();
    expect(inspectApiRuntimeFile(appDir)).toEqual({ status: 'stale', record: { pid: process.pid } });
  });

  it('respects onlyIfPid when removing api-runtime.json', () => {
    const appDir = makeTempDir();
    writeApiRuntimeFile(appDir, { pid: process.pid });

    removeApiRuntimeFile(appDir, { onlyIfPid: process.pid + 1 });
    expect(readApiRuntimeFile(appDir)).toEqual({ pid: process.pid });

    removeApiRuntimeFile(appDir, { onlyIfPid: process.pid });
    expect(inspectApiRuntimeFile(appDir)).toEqual({ status: 'missing' });

    // Idempotent when already missing
    expect(() => removeApiRuntimeFile(appDir)).not.toThrow();
  });
});

describe('toolSocketAddress', () => {
  it('keeps POSIX socket paths strictly under 100 bytes even for a 150+ char appDir', () => {
    const longAppDir = path.join(
      os.tmpdir(),
      'apack-e2e-playwright-worker-0',
      'a'.repeat(60),
      'b'.repeat(60),
      'user-data',
      'apack',
    );
    expect(longAppDir.length).toBeGreaterThan(150);

    const addr = toolSocketAddress(longAppDir, { platform: 'darwin', uid: 501 });
    expect(Buffer.byteLength(addr, 'utf8')).toBeLessThan(MAX_POSIX_SOCKET_PATH_BYTES);
    expect(addr).toMatch(/\/apack-501\/api-[0-9a-f]{16}\.sock$/);
  });

  it('throws when an explicitly supplied POSIX tmpDir would exceed the sun_path limit', () => {
    const hugeTmp = '/' + 'x'.repeat(80);
    expect(() => toolSocketAddress('/app/dir', { platform: 'darwin', tmpDir: hugeTmp, uid: 501 })).toThrow(RangeError);
  });

  it('generates unique per-run Windows named pipe addresses with stable appDir hash prefix', () => {
    const appDir = '/Users/dev/apack-data/apack';
    const expectedHash = crypto.createHash('sha256').update(path.resolve(appDir), 'utf8').digest('hex').slice(0, 16);

    const pipeA = toolSocketAddress(appDir, { platform: 'win32' });
    const pipeB = toolSocketAddress(appDir, { platform: 'win32' });

    expect(pipeA).toMatch(new RegExp(`^\\\\\\\\\\.\\\\pipe\\\\apack-api-${expectedHash}-[0-9a-f]{32}$`));
    expect(pipeB).toMatch(new RegExp(`^\\\\\\\\\\.\\\\pipe\\\\apack-api-${expectedHash}-[0-9a-f]{32}$`));
    expect(pipeA).not.toBe(pipeB);
  });
});

describe('startToolSocketServer and connectToolSocket', () => {
  it('completes auth handshake and streams raw data bidirectionally', async () => {
    const appDir = makeTempDir();
    const token = crypto.randomBytes(24).toString('base64url');
    let serverReceivedPromise: Promise<Buffer> | undefined;

    const server = trackServer(await startToolSocketServer({
      appDir,
      token,
      onConnection: (socket, initialBytes) => {
        trackSocket(socket);
        expect(initialBytes.length).toBe(0);
        serverReceivedPromise = readAll(socket, initialBytes);
        socket.write(Buffer.from('hello-from-server'));
        socket.end();
      },
    }));

    const { socket: client, initialBytes } = await connectToolSocket({ socket: server.address, token });
    trackSocket(client);

    const clientDataPromise = readAll(client, initialBytes);
    client.end(Buffer.from('hello-from-client'));

    const clientReceived = await clientDataPromise;
    await waitForClose(client);
    const serverReceived = await serverReceivedPromise!;

    expect(clientReceived.toString('utf-8')).toBe('hello-from-server');
    expect(serverReceived.toString('utf-8')).toBe('hello-from-client');
  });

  it('preserves client-pipelined bytes sent in the same write behind the auth line and supports unshift into data listeners', async () => {
    const appDir = makeTempDir();
    const token = 'pipeline-secret-token';
    let capturedInitial: Buffer = Buffer.alloc(0);
    let capturedFullPromise: Promise<Buffer> | undefined;

    const server = trackServer(await startToolSocketServer({
      appDir,
      token,
      onConnection: (socket, initialBytes) => {
        trackSocket(socket);
        capturedInitial = Buffer.from(initialBytes);
        // Plug into a consumer that expects all post-handshake bytes via `socket.on('data')` (like `@apackdev/link`'s `stream(socket)`)
        if (initialBytes.length > 0) socket.unshift(initialBytes);
        capturedFullPromise = readAll(socket);
        socket.write(Buffer.from('server-ready\n'));
      },
    }));

    const rawClient = trackSocket(net.connect(server.address));

    await new Promise<void>((resolve, reject) => {
      rawClient.once('connect', resolve);
      rawClient.once('error', reject);
    });

    const ackReceived = new Promise<string>((resolve, reject) => {
      let text = '';
      const onData = (chunk: Buffer) => {
        text += chunk.toString('utf-8');
        if (text.includes('server-ready\n')) {
          rawClient.off('data', onData);
          rawClient.off('error', reject);
          resolve(text);
        }
      };
      rawClient.on('data', onData);
      rawClient.once('error', reject);
    });

    // Send auth JSON + first payload chunk in a single write, wait for server ack so the second chunk cannot coalesce with the handshake.
    const pipelined = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x04, 0xde, 0xad, 0xbe, 0xef]);
    const authAndPayload = Buffer.concat([
      Buffer.from(`${JSON.stringify({ toolToken: token })}\n`, 'utf-8'),
      pipelined,
    ]);
    rawClient.write(authAndPayload);

    const ackText = await ackReceived;
    expect(ackText).toBe('{"ok":true}\nserver-ready\n');
    expect(capturedInitial).toEqual(pipelined);

    rawClient.end(Buffer.from('tail-bytes'));
    expect(await capturedFullPromise!).toEqual(Buffer.concat([pipelined, Buffer.from('tail-bytes')]));
  });

  it('preserves server-pipelined bytes written immediately after auth on connectToolSocket', async () => {
    const appDir = makeTempDir();
    const token = 'server-pipeline-token';
    const immediatePayload = Buffer.from('immediate-frame-1|immediate-frame-2');

    const server = trackServer(await startToolSocketServer({
      appDir,
      token,
      onConnection: (socket) => {
        trackSocket(socket);
        socket.end(immediatePayload);
      },
    }));

    const { socket: client, initialBytes } = await connectToolSocket({ socket: server.address, token });
    trackSocket(client);
    if (initialBytes.length > 0) client.unshift(initialBytes);
    const received = await readAll(client);
    expect(received).toEqual(immediatePayload);
  });

  it('accepts an auth handshake line split across multiple small chunks', async () => {
    const appDir = makeTempDir();
    const token = 'split-chunk-token-123456';
    const onConnection = vi.fn((socket: net.Socket, initialBytes: Buffer) => {
      trackSocket(socket);
      socket.end(Buffer.concat([Buffer.from('ok:'), initialBytes]));
    });

    const server = trackServer(await startToolSocketServer({
      appDir,
      token,
      onConnection,
    }));

    const raw = trackSocket(net.connect(server.address));
    const replyPromise = readAll(raw);
    await new Promise<void>((resolve, reject) => {
      raw.once('connect', resolve);
      raw.once('error', reject);
    });

    const fullLine = `${JSON.stringify({ toolToken: token })}\ntrailer`;
    for (let i = 0; i < fullLine.length; i += 4) {
      raw.write(fullLine.slice(i, i + 4));
    }
    raw.end();

    const reply = await replyPromise;
    expect(reply.toString('utf-8')).toBe('{"ok":true}\nok:trailer');
    expect(onConnection).toHaveBeenCalledTimes(1);
  });

  it('rejects wrong tokens (same length and mismatched length), malformed JSON, and oversized lines without invoking onConnection', async () => {
    const appDir = makeTempDir();
    const token = 'correct-token-value';
    const onConnection = vi.fn();

    const server = trackServer(await startToolSocketServer({
      appDir,
      token,
      maxHandshakeBytes: 128,
      onConnection,
    }));

    // Wrong token via connectToolSocket (different length + same length)
    await expect(connectToolSocket({ socket: server.address, token: 'short' })).rejects.toThrow();
    await expect(connectToolSocket({ socket: server.address, token: 'wrong-token-value!!' })).rejects.toThrow();

    // Malformed payloads & oversized lines via raw sockets
    const badPayloads: Buffer[] = [
      Buffer.from('not-json\n'),
      Buffer.from('[]\n'),
      Buffer.from('{"toolToken":123}\n'),
      Buffer.from('{"toolToken":""}\n'),
      Buffer.from(`{"toolToken":"${token}","extra":1}\n`),
      Buffer.from([0xff, 0xfe, 0x0a]), // invalid UTF-8
      Buffer.from(`{"toolToken":"${'a'.repeat(200)}"}\n`), // oversized with newline
      Buffer.from('x'.repeat(200)), // oversized without newline
    ];

    for (const payload of badPayloads) {
      const raw = trackSocket(net.connect(server.address));
      const closed = waitForClose(raw);
      await new Promise<void>((resolve, reject) => {
        raw.once('connect', resolve);
        raw.once('error', reject);
      });
      raw.write(payload);
      await closed;
    }

    expect(onConnection).not.toHaveBeenCalled();
  });

  it('destroys silent clients when the server handshake timeout elapses without invoking onConnection', async () => {
    const appDir = makeTempDir();
    const onConnection = vi.fn();

    const server = trackServer(await startToolSocketServer({
      appDir,
      token: 'timeout-token',
      handshakeTimeoutMs: 50,
      onConnection,
    }));

    const silent = trackSocket(net.connect(server.address));
    const closed = waitForClose(silent);
    await new Promise<void>((resolve, reject) => {
      silent.once('connect', resolve);
      silent.once('error', reject);
    });

    await closed;
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('rejects connectToolSocket on client handshake timeout or missing socket', async () => {
    const dir = makeShortTmpDir();
    await expect(connectToolSocket({ socket: path.join(dir, 'does-not-exist.sock'), token: 'tok' })).rejects.toThrow();

    // Raw server that accepts connections and never sends an ack line
    const silentAddr = toolSocketAddress(dir, { tmpDir: dir });
    fs.mkdirSync(path.dirname(silentAddr), { recursive: true, mode: 0o700 });
    const rawServer = net.createServer((socket) => {
      trackSocket(socket);
      socket.resume();
    });
    activeRawServers.push(rawServer);
    await new Promise<void>((resolve, reject) => {
      rawServer.once('error', reject);
      rawServer.listen(silentAddr, resolve);
    });

    await expect(
      connectToolSocket({ socket: silentAddr, token: 'tok', timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/i);
  });

  it('enforces POSIX 0700 directory & 0600 socket permissions, binds long appDirs, cleans stale sockets, and cleans up on close()', async () => {
    const shortTmp = makeShortTmpDir();
    const longBase = makeTempDir('playwright-e2e-');
    const longAppDir = path.join(longBase, 'z'.repeat(130), 'apack');
    expect(longAppDir.length).toBeGreaterThan(150);
    fs.mkdirSync(longAppDir, { recursive: true });

    const token = 'perm-secret-token';
    const expectedAddr = toolSocketAddress(longAppDir, { tmpDir: shortTmp });
    expect(Buffer.byteLength(expectedAddr, 'utf8')).toBeLessThan(MAX_POSIX_SOCKET_PATH_BYTES);

    if (isPosix) {
      // Pre-create directory with looser permissions and a genuine orphaned socket file from an exited process
      // to verify both directory permission hardening (0700) and stale socket cleanup before listen().
      const sockDir = path.dirname(expectedAddr);
      fs.mkdirSync(sockDir, { recursive: true, mode: 0o755 });
      fs.chmodSync(sockDir, 0o755);

      await execFileWhileWorking(process.execPath, [
        '-e',
        'const net = require("node:net"); const s = net.createServer(); s.listen(process.argv[1], () => process.exit(0));',
        expectedAddr,
      ]);
      expect(fs.lstatSync(expectedAddr).isSocket()).toBe(true);
    }

    const server = trackServer(await startToolSocketServer({
      appDir: longAppDir,
      tmpDir: shortTmp,
      token,
      onConnection: (socket) => {
        trackSocket(socket);
        // Keep connection open until server.close() destroys active sockets
        socket.resume();
      },
    }));

    expect(server.address).toBe(expectedAddr);
    expect(server.runtimeFile).toBe(runtimeFilePath(longAppDir));

    if (isPosix) {
      expect(fs.lstatSync(path.dirname(server.address)).mode & 0o777).toBe(0o700);
      expect(fs.lstatSync(server.address).mode & 0o777).toBe(0o600);
      expect(fs.lstatSync(server.runtimeFile!).mode & 0o777).toBe(0o600);
    }

    // api-runtime.json is live and contains pid, socket, token
    expect(readApiRuntimeFile(longAppDir)).toEqual({
      pid: process.pid,
      socket: server.address,
      token,
    });

    // Starting a second server on the same live socket refuses with EADDRINUSE without removing the first socket
    if (isPosix) {
      await expect(startToolSocketServer({
        appDir: longAppDir,
        tmpDir: shortTmp,
        token: 'other',
        onConnection: () => {},
      })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(fs.existsSync(server.address)).toBe(true);
    }

    // Connect a client and keep it open so close() proves active sockets are destroyed cleanly
    const { socket: client } = await connectToolSocket({ socket: server.address, token });
    trackSocket(client);
    const clientClosed = waitForClose(client);

    // close() is idempotent, destroys active sockets, and removes both the POSIX socket file and api-runtime.json
    await server.close();
    await server.close();
    await clientClosed;

    if (isPosix) {
      expect(fs.existsSync(server.address)).toBe(false);
    }
    expect(fs.existsSync(runtimeFilePath(longAppDir))).toBe(false);
    expect(readApiRuntimeFile(longAppDir)).toBeUndefined();
  });

  it('refuses to overwrite a non-socket file at the POSIX socket path', async () => {
    if (!isPosix) return;
    const shortTmp = makeShortTmpDir();
    const appDir = makeTempDir('app-nonsock-');
    const addr = toolSocketAddress(appDir, { tmpDir: shortTmp });
    fs.mkdirSync(path.dirname(addr), { recursive: true, mode: 0o700 });
    fs.writeFileSync(addr, 'not a socket', 'utf-8');

    await expect(startToolSocketServer({
      appDir,
      tmpDir: shortTmp,
      token: 'tok',
      onConnection: () => {},
    })).rejects.toThrow(/non-socket/i);
    expect(fs.readFileSync(addr, 'utf-8')).toBe('not a socket');
  });

  it('supports Symbol.dispose cleanup', async () => {
    const shortTmp = makeShortTmpDir();
    const appDir = makeTempDir('app-dispose-');
    let socketAddr = '';
    {
      using server = await startToolSocketServer({
        appDir,
        tmpDir: shortTmp,
        token: 'dispose-token',
        onConnection: () => {},
      });
      socketAddr = server.address;
      expect(readApiRuntimeFile(appDir)).toEqual({ pid: process.pid, socket: socketAddr, token: 'dispose-token' });
    }

    if (isPosix) {
      expect(fs.existsSync(socketAddr)).toBe(false);
    }
    expect(fs.existsSync(runtimeFilePath(appDir))).toBe(false);
  });
});
