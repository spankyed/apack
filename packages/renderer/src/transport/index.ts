import { createWSClient, wsLink, createTRPCClient, type TRPCClient } from '@trpc/client';
import { API_HOST } from '@apackdev/sdk/utils/pure';
import type { AppRouter } from '@app/api';   // ← BE import Type‑only!
import type { _HostBridge } from '@apackdev/sdk/fe';

type ApiClient = TRPCClient<AppRouter>;

/**
 * The token the API requires, which main gives the app's windows, and which only this client reads.
 *
 * The cast is to `_HostBridge` — the **whole** bridge a window has — because `window.electronAPI` is
 * declared as the pack-facing view of it, and `apiToken` is one of the two members that view omits
 * (`HOST_ONLY_BRIDGE_MEMBERS`). So host code names the type it means rather than re-declaring the member
 * it wants, which is what this line did while the two types were written by hand.
 */
const apiToken = (typeof window !== 'undefined' && (window.electronAPI as _HostBridge | undefined)?.apiToken) || '';

/**
 * A socket offering the API's subprotocol and the token as a second one (the API's `acceptsConnection`). The token
 * stays out of the URL, which the browser prints when a connection fails, and the app logs what the window prints.
 */
class ApiSocket extends WebSocket {
  constructor(url: string | URL) {
    super(url, ['apack', `apack-token.${apiToken}`]);
  }
}

function connect(port: number) {
  const ws = createWSClient({ url: `ws://${API_HOST}:${port}`, WebSocket: ApiSocket });
  return { port, ws, client: createTRPCClient<AppRouter>({ links: [wsLink({ client: ws })] }) };
}

const ready = typeof window !== 'undefined' && window.electronAPI
  ? await window.electronAPI.apiStatus.whenReady() : undefined;
let connection = connect(ready?.port ?? 3001);

/**
 * The API client. A proxy, because the client is rebuilt when the API restarts on a different
 * port: importers hold this binding for the window's lifetime, so every call has to reach
 * whichever client is current.
 */
export const trpc: ApiClient = new Proxy({} as ApiClient, {
  get: (_, prop) => connection.client[prop as keyof ApiClient],
});

/**
 * Points the client at `port`, closing the old socket. Returns false when the port is unchanged,
 * so a caller can leave a working connection — and its subscriptions — alone.
 */
export function reconnectApiClient(port: number): boolean {
  if (port === connection.port) return false;
  console.info(`[trpc] API moved to port ${port}; reconnecting`);
  connection.ws.close();
  connection = connect(port);
  return true;
}
