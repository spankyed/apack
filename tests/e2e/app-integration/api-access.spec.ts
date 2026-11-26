// The API opens no TCP port and exposes neither port nor token to renderer windows: windows talk
// to the backend exclusively over brokered Electron MessagePorts, and local tools authenticate to
// the user-private local tool socket discovered through `apack/api-runtime.json`. A client with a
// missing, wrong, or malformed handshake is refused without taking the API down.
import * as net from 'node:net';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { connectToolClient } from '@apackdev/host/transport/tool-client';
import { connectToolSocket, readApiRuntimeFile } from '@apackdev/host/transport/tool-socket';
import { test, expect } from '@apackdev/testing';

/** Sends a malformed non-JSON handshake line to the local tool socket and waits for it to close. */
function sendMalformedHandshake(socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath, () => {
      socket.write('not-valid-json\n');
    });
    socket.on('data', () => socket.destroy());
    socket.on('close', () => resolve());
    socket.on('error', () => resolve());
  });
}

test('exposes no TCP port/token to the renderer and enforces token auth on the local tool socket', async ({ appPage, electronApp }) => {
  const bridgeCheck = await appPage.evaluate(() => {
    const api = (window as { electronAPI?: Record<string, unknown> }).electronAPI;
    return {
      hasBackendPort: typeof (api?.backendPort as { connect?: unknown } | undefined)?.connect === 'function',
      hasApiPort: api !== undefined && 'apiPort' in api,
      hasApiToken: api !== undefined && 'apiToken' in api,
    };
  });
  expect(bridgeCheck).toEqual({ hasBackendPort: true, hasApiPort: false, hasApiToken: false });

  const userDataDir = await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR);
  expect(userDataDir, 'the app knows its data dir').toBeTruthy();
  const { appDir } = resolveAppEnvironment({ env: 'test', userDataDir });
  const runtime = readApiRuntimeFile(appDir);
  expect(runtime?.socket, 'the test API publishes a local tool socket').toBeTruthy();
  expect(runtime?.token, 'the test API publishes a local tool token').toBeTruthy();

  await expect(connectToolSocket({ socket: runtime!.socket!, token: '' })).rejects.toThrow();
  await expect(connectToolSocket({ socket: runtime!.socket!, token: 'wrong-guess' })).rejects.toThrow();

  // With the run's token, the Control RPC reaches dev.reload (which rejects with NOT_FOUND/BAD_REQUEST for an unknown pack)
  const client = await connectToolClient({ appDir });
  try {
    await expect(client.control.call('dev.reload', { packId: 'no-such-pack' })).rejects.toThrow();
  } finally {
    await client.close();
  }

  // The API stays healthy after a malformed handshake line
  await sendMalformedHandshake(runtime!.socket!);
  const recovered = await connectToolClient({ appDir });
  try {
    const loaded = await recovered.control.call('packs.loaded', undefined);
    expect(Array.isArray(loaded)).toBe(true);
  } finally {
    await recovered.close();
  }
});
