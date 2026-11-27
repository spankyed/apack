import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _appDirOf } from '@apackdev/sdk/env';
import type { PackCatalogFrame } from '@apackdev/host/packs';
import { createControlServer, muxTransport } from '@apackdev/host/transport/mux';
import type { HostControlContract } from '@apackdev/host/transport/control-contract';
import { toolSocketTransport } from '@apackdev/host/transport/tool-client';
import {
  startToolSocketServer,
  writeApiRuntimeFile,
  type ToolSocketServer,
} from '@apackdev/host/transport/tool-socket';
import { connectToolClientIn, readApiRuntimeIn } from '../../src/engine/tool-client.ts';

const cleanupDirs: string[] = [];
const activeServers: ToolSocketServer[] = [];

function makeUserDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-testing-tool-client-'));
  cleanupDirs.push(dir);
  fs.mkdirSync(_appDirOf(dir), { recursive: true });
  return dir;
}

afterEach(async () => {
  for (const server of activeServers.splice(0)) {
    await server.close();
  }
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('connectToolClientIn / readApiRuntimeIn', () => {
  it('connects via api-runtime.json, executes Control RPC + Link lane frames, and releases resources on disconnect', async () => {
    const userDataDir = makeUserDataDir();
    const appDir = _appDirOf(userDataDir);
    let catalogRevision = 1;
    const catalogListeners = new Set<() => void>();
    const activeLeases = new Set<string>();
    const receivedLinkMessages: Array<string | Uint8Array> = [];

    const server = await startToolSocketServer({
      appDir,
      token: 'testing-tool-token',
      onConnection: (socket, initialBytes) => {
        const mux = muxTransport(toolSocketTransport(socket, initialBytes));
        mux.link.onData((data) => {
          receivedLinkMessages.push(data);
          if (typeof data === 'string') mux.link.send(`echo:${data}`);
        });

        let connectionLeases: string[] = [];
        mux.control.onClose(() => {
          for (const cred of connectionLeases) activeLeases.delete(cred);
          connectionLeases = [];
        });

        createControlServer<{
          readonly requests: Pick<HostControlContract['requests'], 'packs.loaded' | 'settings.openHost' | 'dev.reload'>;
          readonly subscriptions: Pick<HostControlContract['subscriptions'], 'packs.catalog'>;
        }>(mux.control, {
          requests: {
            'packs.loaded': () => [
              {
                id: 'demo-pack',
                name: 'Demo Pack',
                version: '1.0.0',
                registrationId: 'reg-42',
                declarationRevision: 'decl-1',
                buildRevision: 'build-1',
                feEntry: 'runtime/fe.js',
              },
            ],
            'settings.openHost': () => {
              const credential = `lease-${activeLeases.size + 1}`;
              activeLeases.add(credential);
              connectionLeases.push(credential);
              return { credential };
            },
            'dev.reload': () => ({ ok: true }),
          },
          subscriptions: {
            'packs.catalog': {
              coalesce: true,
              subscribe: (_input, sink) => {
                const push = () => sink.push({
                  runId: 'testing-run',
                  snapshot: { revision: catalogRevision, packs: [] },
                } as unknown as PackCatalogFrame);
                catalogListeners.add(push);
                push();
                return () => { catalogListeners.delete(push); };
              },
            },
          },
        });
      },
    });
    activeServers.push(server);

    const runtime = readApiRuntimeIn(userDataDir);
    expect(runtime).toEqual({ pid: process.pid, socket: server.address, token: 'testing-tool-token' });

    await using client = await connectToolClientIn(userDataDir);

    // Control lane requests
    const packs = await client.control.call('packs.loaded');
    expect(packs).toHaveLength(1);
    expect(packs[0]!.id).toBe('demo-pack');
    expect(await client.control.call('dev.reload', { packId: 'demo-pack' })).toEqual({ ok: true });

    const { credential } = await client.control.call('settings.openHost');
    expect(activeLeases.has(credential)).toBe(true);

    // Control lane subscription
    const catalogFrames: PackCatalogFrame[] = [];
    const sub = client.control.subscribe('packs.catalog', undefined, {
      onData: (frame) => catalogFrames.push(frame),
    });
    await vi.waitFor(() => expect(catalogFrames).toHaveLength(1));
    catalogRevision = 2;
    for (const listener of catalogListeners) listener();
    await vi.waitFor(() => expect(catalogFrames).toHaveLength(2));
    expect(catalogFrames[1]!.snapshot.revision).toBe(2);
    sub.unsubscribe();

    // Link lane traffic shares the same authenticated socket cleanly
    const echoed = new Promise<string | Uint8Array>((resolve) => {
      client.link.onData((msg) => resolve(msg));
    });
    client.link.send('ping-link');
    expect(await echoed).toBe('echo:ping-link');
    expect(receivedLinkMessages).toEqual(['ping-link']);

    await client.close();
    await vi.waitFor(() => expect(activeLeases.size).toBe(0));
  });

  it('rejects missing or pid-only api-runtime.json records', async () => {
    const userDataDir = makeUserDataDir();
    expect(readApiRuntimeIn(userDataDir)).toBeUndefined();
    await expect(connectToolClientIn(userDataDir)).rejects.toThrow(/No live API runtime/i);

    writeApiRuntimeFile(_appDirOf(userDataDir), { pid: process.pid });
    expect(readApiRuntimeIn(userDataDir)).toEqual({ pid: process.pid });
    await expect(connectToolClientIn(userDataDir)).rejects.toThrow(/exposes no local tool socket/i);
  });
});
