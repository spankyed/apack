import * as path from 'node:path';
import { resolveAppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { ControlRpcError } from '@apackdev/host/transport/mux';
import { connectToolClient, inspectApiRuntime, type ToolClient } from '@apackdev/host/transport/tool-client';
import { runtimeFilePath } from '@apackdev/host/transport/tool-socket';

/**
 * Asking a running app to do something for a local tool, and what that came to: Control Lane RPC
 * `dev.reload` and `dev.install` over the user-private local tool socket discovered through
 * `<appDir>/api-runtime.json`.
 */

/**
 * Where an app is: the build it is, and the profile it keeps its data in.
 *
 * The same pair `resolveAppEnvironment` takes, under the same two words — it is handed straight to it, so a
 * second vocabulary here would be one translation step for nothing.
 */
export interface AppPlace {
  env: AppEnv;
  userDataDir?: string;
}

/** The running app's local tool socket address and auth token, from `<appDir>/api-runtime.json`. */
function findAppToolSocket(place: AppPlace): { socket: string; token: string } | { problem: string } {
  const { appDir } = resolveAppEnvironment(place);
  const file = runtimeFilePath(appDir);
  const inspected = inspectApiRuntime(appDir);
  if (inspected.status === 'missing' || inspected.status === 'stale') {
    return { problem: `no running ${place.env} app in ${file}` };
  }
  if (inspected.status === 'corrupt') {
    return { problem: `couldn't read ${file}` };
  }
  const { record } = inspected;
  if (!record.socket || !record.token) {
    return { problem: `the running ${place.env} app (pid ${record.pid}) exposes no local tool socket` };
  }
  return { socket: record.socket, token: record.token };
}

/**
 * What handing a request to the app came to. `detail` says which of the several ways it failed, since they ask
 * different things of the author: start the app, look at its logs, or check the local tool socket.
 */
export type AppDelivery =
  /** The app took it */
  | { status: 'delivered' }
  /** No live `api-runtime.json` with a tool socket to reach an app with */
  | { status: 'not-running'; detail: string }
  /** The app answered and refused, or couldn't do it */
  | { status: 'failed'; detail: string }
  /** Nothing answered on the local tool socket the app published */
  | { status: 'unreachable'; detail: string };

/** What handing a build to the app came to, which may also be that it already runs it */
export type DevDelivery = AppDelivery
  /** The app already runs this build's backend; Vite serves the rest */
  | { status: 'current' };

async function withToolClient(
  place: AppPlace,
  run: (client: ToolClient) => Promise<void>,
): Promise<AppDelivery> {
  const found = findAppToolSocket(place);
  if ('problem' in found) return { status: 'not-running', detail: found.problem };

  let client: ToolClient;
  try {
    client = await connectToolClient({ socket: found.socket, token: found.token });
  } catch (err) {
    return { status: 'unreachable', detail: `${found.socket}: ${errorMessage(err)}` };
  }

  try {
    await run(client);
    return { status: 'delivered' };
  } catch (err) {
    if (err instanceof ControlRpcError) {
      if (err.code === 'TRANSPORT_CLOSED') {
        return { status: 'unreachable', detail: `${found.socket}: ${err.message}` };
      }
      return { status: 'failed', detail: `${err.code}: ${err.message}` };
    }
    return { status: 'failed', detail: errorMessage(err) };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Asks the running app to reload a pack's runtime over the Control RPC lane. */
export function reloadPack(packId: string, place: AppPlace = { env: 'development' }): Promise<DevDelivery> {
  return withToolClient(place, async (client) => {
    await client.control.call('dev.reload', { packId });
  });
}

/**
 * Asks the running app to install the build in a pack's source directory and start it. The app copies the
 * files and loads them itself, so nothing else it does can load a half-copied build.
 */
export function installPackInApp(root: string, place: AppPlace = { env: 'development' }): Promise<DevDelivery> {
  const absoluteRoot = path.resolve(root);
  return withToolClient(place, async (client) => {
    await client.control.call('dev.install', { root: absoluteRoot });
  });
}
