// The local tool socket wire protocol, against a real `startToolSocketServer` + `muxTransport` +
// `createControlServer` + `@apackdev/link` `accept`/`join` server.
//
// Exercises the real Unix socket / named pipe JSONL authentication handshake, binary framing,
// Control RPC lane (`settings.openHost`, `settings.openPack`, `settings.mutate`, `packs.loaded`,
// `dev.reload`), `@apackdev/link` lane (`CLAIM`, `SEND`, server-to-client `tell`), conflict error
// codes, and channel-close propagation without touching Electron or tRPC/WS.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accept, join, type Accepting, type Port } from '@apackdev/link';
import {
  BUS_CLAIM_ASK,
  BUS_LINK_TARGET,
  BUS_SEND_ASK,
  decodeBusSendPayload,
  encodeBusEnvelope,
  LINK_CLAIM_CONFLICT,
} from '@apackdev/host/transport/link-protocol';
import type { HostControlContract } from '@apackdev/host/transport/control-contract';
import { ControlRpcError, createControlServer, muxTransport } from '@apackdev/host/transport/mux';
import { toolSocketTransport } from '@apackdev/host/transport/tool-client';
import {
  startToolSocketServer,
  writeApiRuntimeFile,
  type ToolSocketServer,
} from '@apackdev/host/transport/tool-socket';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { CLAIM_CONFLICT, connectApiClient, type ApiClient, type BusMessage } from '../../src/engine/api-client.ts';

const TOKEN = 'a-test-token';

/** A loaded pack as `packs.loaded` lists one: its runtime's four fields, and more the client must not forward */
const LOADED = {
  id: 'fixture',
  registrationId: 'r1',
  declarationRevision: 'd1',
  buildRevision: 'b1',
  feEntry: 'fe/index.js',
};

let behaviour: {
  claimRefuses?: boolean;
  settingsRefuses?: boolean;
  settingsOpens?: number;
  sent?: unknown[];
  settingsMutated?: unknown[];
  emit?: BusMessage[];
  packSettingsOpened?: unknown[];
  reloaded?: string[];
  closeAfterAttach?: boolean;
} = {};

let tmpDir: string;
let toolServer: ToolSocketServer | undefined;
let accepting: Accepting<string> | undefined;
let client: ApiClient | undefined;
let activeClosers: Array<() => void> = [];

async function serve(): Promise<{ socket: string; appDir: string }> {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-api-client-'));
  const appDir = path.join(tmpDir, 'apack');
  fs.mkdirSync(appDir, { recursive: true });

  accepting = accept<string>((link) => {
    const serverPort: Port = {
      tell: () => {},
      ask: (to, name, args, _heard, ended) => {
        if (to === BUS_LINK_TARGET && name === BUS_CLAIM_ASK) {
          if (behaviour.claimRefuses) {
            ended({
              ok: false,
              failure: {
                kind: LINK_CLAIM_CONFLICT,
                message: '"host/drive" is already claimed by another connection.',
              },
            });
          } else {
            ended({ ok: true, value: undefined });
          }
          return () => {};
        }
        if (to === BUS_LINK_TARGET && name === BUS_SEND_ASK) {
          const decoded = decodeBusSendPayload(args);
          if (!decoded) {
            ended({ ok: false, failure: { kind: 'BAD_REQUEST', message: 'Invalid bus send payload' } });
          } else {
            behaviour.sent?.push(decoded);
            ended({ ok: true, value: undefined });
          }
          return () => {};
        }
        ended({ ok: false, failure: { kind: 'BAD_REQUEST', message: `Unexpected ask ${to}/${name}` } });
        return () => {};
      },
      follow: (_to, _view, _args, _shown, over) => {
        over({ kind: 'UNSUPPORTED', message: 'unsupported' });
        return { stop: () => {}, change: () => {} };
      },
    };

    const remote = join(link, serverPort);
    for (const msg of behaviour.emit ?? []) {
      remote.tell(msg.to, encodeBusEnvelope(msg));
    }
    if (behaviour.closeAfterAttach) {
      queueMicrotask(() => link.close());
    }
  });

  let nextConn = 0;
  toolServer = await startToolSocketServer({
    appDir,
    token: TOKEN,
    onConnection: (socket, initialBytes) => {
      const id = `conn-${++nextConn}`;
      const raw = toolSocketTransport(socket, initialBytes);
      const mux = muxTransport(raw);
      const control = createControlServer<HostControlContract>(mux.control, {
        requests: {
          'secrets.list': () => { throw new ControlRpcError('UNIMPLEMENTED', 'unused'); },
          'secrets.add': () => { throw new ControlRpcError('UNIMPLEMENTED', 'unused'); },
          'secrets.replaceValue': () => { throw new ControlRpcError('UNIMPLEMENTED', 'unused'); },
          'secrets.select': () => { throw new ControlRpcError('UNIMPLEMENTED', 'unused'); },
          'secrets.rename': () => { throw new ControlRpcError('UNIMPLEMENTED', 'unused'); },
          'secrets.delete': () => { throw new ControlRpcError('UNIMPLEMENTED', 'unused'); },
          'secrets.allowUnprotected': () => { throw new ControlRpcError('UNIMPLEMENTED', 'unused'); },
          'settings.openHost': () => {
            behaviour.settingsOpens = (behaviour.settingsOpens ?? 0) + 1;
            if (behaviour.settingsRefuses) {
              throw new ControlRpcError('FORBIDDEN', 'settings access refused');
            }
            return { credential: 'tool-settings-access' };
          },
          'settings.openPack': (input) => {
            const keys = Object.keys(input as object).sort();
            if (keys.join() !== 'buildRevision,declarationRevision,id,registrationId') {
              throw new ControlRpcError('BAD_REQUEST', `unrecognized keys: ${keys.join()}`);
            }
            behaviour.packSettingsOpened?.push(input);
            if (input.registrationId === 'gone') {
              throw new ControlRpcError('FORBIDDEN', 'Settings access is unavailable');
            }
            return { credential: `access-for-${input.id}` };
          },
          'settings.close': () => undefined,
          'settings.mutate': (input) => {
            behaviour.settingsMutated?.push(input);
            return undefined;
          },
          'packs.loaded': () => [LOADED as never],
          'packs.clientReady': () => undefined,
          'performance.start': () => undefined,
          'performance.stop': () => { throw new ControlRpcError('UNIMPLEMENTED', 'unused'); },
          'dev.reload': ({ packId }) => {
            behaviour.reloaded?.push(packId);
            return { ok: true };
          },
          'dev.install': () => ({ ok: true }),
        },
      });
      accepting!.take(mux.link, id);
      const close = () => {
        control.dispose();
        accepting?.gone(id);
        mux.close();
      };
      activeClosers.push(close);
      socket.once('close', close);
    },
  });

  writeApiRuntimeFile(appDir, {
    pid: process.pid,
    socket: toolServer.address,
    token: TOKEN,
  });

  return { socket: toolServer.address, appDir };
}

beforeEach(() => {
  behaviour = {};
  client = undefined;
  toolServer = undefined;
  accepting = undefined;
  activeClosers = [];
});

afterEach(async () => {
  await client?.close();
  for (const close of activeClosers) close();
  activeClosers = [];
  accepting?.close();
  await toolServer?.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('the handshake & discovery', () => {
  it('connects via api-runtime.json discovery and direct socket+token', async () => {
    const { appDir } = await serve();
    client = await connectApiClient({ appDir });

    await expect(client.claim('host/drive')).resolves.toBeUndefined();
    await expect(client.send({ to: 'default-setup/database', event: { type: 'PING' } })).resolves.toBeUndefined();
  });

  it('refuses a connection with the wrong token', async () => {
    const { socket } = await serve();

    await expect(connectApiClient({ socket, token: 'the-wrong-token' }))
      .rejects.toThrow(/Couldn't reach the app's API/);
  });
});

describe('a refusal', () => {
  it('rejects with the reason and the code, not a generic failure', async () => {
    behaviour.claimRefuses = true;
    const { socket } = await serve();
    client = await connectApiClient({ socket, token: TOKEN });

    await expect(client.claim('host/drive')).rejects.toThrow(/already claimed by another connection/);
    await expect(client.claim('host/drive'), 'and the machine-readable code, for a caller that branches')
      .rejects.toThrow(/CONFLICT/);
  });

  it('carries the code as a property, which is what a caller branches on', async () => {
    behaviour.claimRefuses = true;
    const { socket } = await serve();
    client = await connectApiClient({ socket, token: TOKEN });

    await expect(client.claim('host/drive')).rejects.toMatchObject({ code: CLAIM_CONFLICT });
  });

  it('leaves the channel usable after one refused call', async () => {
    behaviour.claimRefuses = true;
    const { socket } = await serve();
    client = await connectApiClient({ socket, token: TOKEN });

    await expect(client.claim('host/drive')).rejects.toThrow();
    expect(client.failure, 'the connection is fine; one call was refused').toBeNull();
    await expect(client.send({ to: 'x/y', event: { type: 'PING' } })).resolves.toBeUndefined();
  });
});

describe('incoming messages & close propagation', () => {
  it('delivers incoming bus messages to its listeners', async () => {
    const sent: BusMessage = {
      to: 'host/drive',
      event: { type: 'ASK_ANSWERED', asked: 'EXECUTE_QUERY', answer: { result: 7 } },
      sender: 'default-setup/database',
    };
    behaviour.emit = [sent];
    const { socket } = await serve();

    const seen: BusMessage[] = [];
    const live = await connectApiClient({ socket, token: TOKEN });
    client = live;
    live.onMessage((message) => { seen.push(message); });

    await _whenSatisfied(
      (notify) => live.onMessage(notify),
      () => (seen.length > 0 ? seen : undefined),
      'the link to deliver a message',
    );

    expect(seen).toEqual([sent]);
  });

  it('finishes the channel when the server closes it, and reports it once', async () => {
    behaviour.closeAfterAttach = true;
    const { socket } = await serve();
    const live = await connectApiClient({ socket, token: TOKEN });
    client = live;

    const reason = await _whenSatisfied(
      (notify) => live.onFinished(() => notify()),
      () => live.failure ?? undefined,
      'the channel to report that it finished',
    );

    expect(reason).toMatch(/connection to the app closed/);
    await expect(live.send({ to: 'x/y', event: { type: 'PING' } })).rejects.toThrow(/connection to the app closed/);
  });
});

describe('settings authority & pack control RPCs', () => {
  it('opens settings authority once for explicit writes and leaves ordinary sends unprivileged', async () => {
    behaviour.sent = [];
    behaviour.settingsMutated = [];
    const { socket } = await serve();
    client = await connectApiClient({ socket, token: TOKEN });

    const read = { to: 'host/settings', event: { type: 'GET_SETTINGS' } };
    await client.send(read);
    expect(behaviour.settingsOpens).toBeUndefined();

    const write = { to: 'host/settings', event: { type: 'UPDATE_SETTINGS' }, call: 'write-one' };
    await Promise.all([client.sendSettings(write), client.sendSettings({ ...write, call: 'write-two' })]);
    expect(behaviour.settingsOpens).toBe(1);
    expect(behaviour.sent).toEqual([read]);
    expect(behaviour.settingsMutated).toEqual([
      { credential: 'tool-settings-access', event: { type: 'UPDATE_SETTINGS' }, call: 'write-one' },
      { credential: 'tool-settings-access', event: { type: 'UPDATE_SETTINGS' }, call: 'write-two' },
    ]);

    await client.send(read);
    expect(behaviour.sent.at(-1)).toEqual(read);
  });

  it('refuses settings writes without issuing a mutation when bootstrap is refused', async () => {
    behaviour.sent = [];
    behaviour.settingsMutated = [];
    behaviour.settingsRefuses = true;
    const { socket } = await serve();
    client = await connectApiClient({ socket, token: TOKEN });

    await expect(client.sendSettings({ to: 'host/settings', event: { type: 'UPDATE_SETTINGS' } }))
      .rejects.toThrow('settings access refused');
    expect(behaviour.settingsMutated).toEqual([]);
    await expect(client.sendSettings({ to: 'another/feature', event: { type: 'PING' } }))
      .rejects.toThrow('only sends to host/settings');
    await client.send({ to: 'another/feature', event: { type: 'PING' } });
    expect(behaviour.sent).toHaveLength(1);
    expect(behaviour.settingsOpens).toBe(1);
  });

  it('lists loaded packs, opens pack settings with only the four runtime fields, and triggers dev.reload', async () => {
    behaviour.packSettingsOpened = [];
    behaviour.settingsMutated = [];
    behaviour.sent = [];
    behaviour.reloaded = [];
    const { socket } = await serve();
    client = await connectApiClient({ socket, token: TOKEN });

    const loaded = await client.loadedPacks();
    expect(loaded).toEqual([LOADED]);

    const [runtime] = loaded;
    await expect(client.openPackSettings(runtime)).resolves.toBe('access-for-fixture');
    expect(behaviour.packSettingsOpened).toEqual([
      { id: 'fixture', registrationId: 'r1', declarationRevision: 'd1', buildRevision: 'b1' },
    ]);
    await expect(client.openPackSettings({ ...runtime, registrationId: 'gone' }))
      .rejects.toThrow('Settings access is unavailable');

    // Settings mutations with a pack credential go over Control RPC settings.mutate
    await client.send({
      to: 'host/settings',
      event: { type: 'UPDATE_SETTINGS' },
      sender: 'host/e2eConnection',
      call: 'c1',
      settingsCredential: 'access-for-fixture',
    });
    expect(behaviour.settingsMutated).toEqual([
      { credential: 'access-for-fixture', event: { type: 'UPDATE_SETTINGS' }, sender: 'host/e2eConnection', call: 'c1' },
    ]);

    // Settings reads (GET_SETTINGS) go over the unprivileged Link bus even when a credential was passed
    await client.send({
      to: 'host/settings',
      event: { type: 'GET_SETTINGS' },
      sender: 'host/e2eConnection',
      call: 'c2',
      settingsCredential: 'access-for-fixture',
    });
    expect(behaviour.sent).toEqual([
      { to: 'host/settings', event: { type: 'GET_SETTINGS' }, sender: 'host/e2eConnection', call: 'c2' },
    ]);

    await client.reloadPack('fixture');
    expect(behaviour.reloaded).toEqual(['fixture']);
  });
});
