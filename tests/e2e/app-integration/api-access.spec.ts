// The API takes calls only with the token Electron main creates for each app run: the app's window connects with it
// (a WebSocket subprotocol, never the URL), and a WebSocket or /dev/reload call without it (a web page's, say) is
// refused. A malformed request doesn't take the API down.
import * as net from 'node:net';
import { API_TOKEN_HEADER } from '@apackdev/sdk/utils/pure';
import { test, expect } from '@apackdev/testing';

/** Whether a WebSocket to `url` offering `protocols` opens, and the subprotocol the server chose */
function connects(url: string, protocols: string[]): Promise<{ open: boolean; protocol?: string }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, protocols);
    socket.addEventListener('open', () => { resolve({ open: true, protocol: socket.protocol }); socket.close(); });
    socket.addEventListener('error', () => resolve({ open: false }));
  });
}

/** Sends a raw WebSocket upgrade whose path no URL parser accepts, and waits for the server to answer or hang up */
function sendMalformedUpgrade(port: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    socket.on('data', () => socket.destroy());
    socket.on('close', () => resolve());
    socket.on('error', () => resolve());
  });
}

test('refuses API connections and reloads without the run token', async ({ appPage }) => {
  const { apiPort, apiToken } = await appPage.evaluate(async () => {
    const api = (window as { electronAPI?: { apiStatus: { whenReady: () => Promise<{ port: number }> }; apiToken?: string } }).electronAPI;
    return { apiPort: (await api?.apiStatus.whenReady())?.port, apiToken: api?.apiToken ?? '' };
  });
  expect(apiPort, 'the renderer knows the API port').toBeTruthy();
  expect(apiToken, 'the renderer knows the API token').toBeTruthy();
  const base = `127.0.0.1:${apiPort}`;

  expect(await connects(`ws://${base}`, [])).toEqual({ open: false });
  expect(await connects(`ws://${base}`, ['apack', 'apack-token.guess'])).toEqual({ open: false });
  expect(await connects(`ws://${base}/?token=${encodeURIComponent(apiToken)}`, ['apack'])).toEqual({ open: false });
  // The server answers with the app's protocol, never the token one
  expect(await connects(`ws://${base}`, ['apack', `apack-token.${apiToken}`])).toEqual({ open: true, protocol: 'apack' });
  expect(await connects(`ws://${base}`, [`apack-token.${apiToken}`, 'apack'])).toEqual({ open: true, protocol: 'apack' });

  const reload = (headers: Record<string, string>) => fetch(`http://${base}/dev/reload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ packId: 'no-such-pack' }),
  });
  expect((await reload({})).status).toBe(403);
  expect((await reload({ [API_TOKEN_HEADER]: 'guess' })).status).toBe(403);
  // With the token, the request reaches the reload itself, which fails for an unknown pack
  expect((await reload({ [API_TOKEN_HEADER]: apiToken })).status).not.toBe(403);

  // The API is still up after a request no URL parser accepts
  await sendMalformedUpgrade(Number(apiPort));
  expect(await connects(`ws://${base}`, ['apack', `apack-token.${apiToken}`])).toEqual({ open: true, protocol: 'apack' });
});
