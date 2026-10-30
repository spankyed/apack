import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer } from 'ws';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { appRouter } from './index.ts';
import { createRpcContext } from './context.ts';
import { jsonSafeEncoder } from './encoder.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { SERVER_CONFIG, apiToken, apiTokenIsOwn, isApiToken } from '../boot/config.ts';
import { appDatabase, appPacks, appRunHistory, backendActor } from '../runtime/index.ts';
import { installDevPack, reloadPackById } from '@apackdev/host/packs/runtime';
import { writePrivateFile } from '@apackdev/host/private-file';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { closeDatabases } from '@apackdev/host/database';
import type { ApiEndpoint } from '@apackdev/host/process-liveness';
import { API_HOST, API_TOKEN_HEADER } from '@apackdev/sdk/utils/pure';

const logger = createLogger('backend');

/**
 * The WebSocket subprotocol the app's windows speak, the one the server answers with. They send the API token as a
 * second subprotocol (`apack-token.<token>`), not in the URL: browsers print a socket's URL when it fails to connect,
 * and the app logs what the window prints. The renderer's API client (`packages/renderer/src/core/trpc.ts`) offers both.
 */
export const API_PROTOCOL = 'apack';
const TOKEN_PROTOCOL = 'apack-token.';

/** Whether a WebSocket connection may open: the subprotocols it offers (`Sec-WebSocket-Protocol`) carry the API token */
export function acceptsConnection(offeredProtocols: string | undefined, token = apiToken()): boolean {
  const given = (offeredProtocols ?? '').split(',').map((protocol) => protocol.trim())
    .find((protocol) => protocol.startsWith(TOKEN_PROTOCOL))?.slice(TOKEN_PROTOCOL.length);
  return isApiToken(given, token);
}

/**
 * Why a development request (a pack reload or install) is refused, or null to take it. Only a development or test
 * app takes them, and only from a caller with the API token: `apack pack dev` and the built-in pack's watcher read it from the development app's
 * token file, the E2E tests from the app's window. A web page has no way to learn it.
 */
export function devRequestRefusal(headers: http.IncomingHttpHeaders, env = resolveAppEnvironment().env, token = apiToken()): string | null {
  if (env !== 'development' && env !== 'test') return `pack development requests are for development builds (this one is ${env})`;
  const given = headers[API_TOKEN_HEADER];
  if (!isApiToken(Array.isArray(given) ? given[0] : given, token)) return 'the API token is missing or wrong';
  return null;
}

function answer(res: http.ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** The request's JSON body, once it has all arrived */
function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (err) { reject(err); }
    });
  });
}

/**
 * The development endpoints `apack pack dev` and `apack pack build --watch` call. `POST /dev/reload { packId }`
 * reloads a pack the app already has; `POST /dev/install { root }` installs and starts the build in a pack's
 * source directory. Both hold the registry's claim on the pack, so neither overlaps an install, toggle or
 * reload of the same pack.
 */
async function handleDevRequest(url: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const refusal = devRequestRefusal(req.headers);
  if (refusal) return answer(res, 403, { error: refusal });
  try {
    const body = await readJsonBody(req);
    if (url === '/dev/reload') {
      const { packId } = body;
      if (!packId || typeof packId !== 'string') return answer(res, 400, { error: 'packId required' });
      if (!appPacks.claimPackOperation(packId)) return answer(res, 409, { error: 'another operation on this pack is in progress' });
      try { await reloadPackById(appPacks, packId, backendActor); }
      finally { appPacks.releasePackOperation(packId); }
      return answer(res, 200, { ok: true });
    }
    const { root } = body;
    if (!root || typeof root !== 'string' || !path.isAbsolute(root)) return answer(res, 400, { error: 'an absolute root required' });
    return answer(res, 200, { ok: true, ...await installDevPack(appPacks, root, backendActor) });
  } catch (err) {
    logger.error(`${url} failed:`, err as Error);
    answer(res, 500, { error: (err as Error).message });
  }
}

function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === 'POST' && (req.url === '/dev/reload' || req.url === '/dev/install')) {
    void handleDevRequest(req.url, req, res);
    return;
  }

  res.writeHead(404);
  res.end();
}

/**
 * Tells local tools where this API is. Every run publishes its port, so a tool finds it and can tell that an app is
 * running on the data dir, whatever the platform (`apack db` refuses to change a database an app holds); the port
 * alone opens nothing, since a call needs the token. The token itself goes to a file only where a local tool may use
 * it: a development app (`apack pack dev`, the built-in pack's watcher), and an API started by hand, which made up its
 * own. That file is readable only by the user. Both are removed when the process exits.
 */
export function publishApiFiles(port: number, token: string): void {
  const { apiPortFile, apiTokenFile } = resolveAppEnvironment();
  try {
    fs.mkdirSync(path.dirname(apiPortFile), { recursive: true });
    // With the process id, so a tool can tell a running API from a file a crashed run left behind
    writePrivateFile(apiPortFile, JSON.stringify({ port, pid: process.pid } satisfies ApiEndpoint));
  } catch {}

  if (process.env.NODE_ENV !== 'development' && !apiTokenIsOwn()) return;
  try {
    writePrivateFile(apiTokenFile, token);
    if (apiTokenIsOwn()) logger.info(`No APACK_API_TOKEN given: clients send the token in ${apiTokenFile}`);
  } catch {}
}

export function createWebSocketServer() {
  const port = SERVER_CONFIG.port;
  const token = apiToken();

  const httpServer = http.createServer(handleHttpRequest);

  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: ({ req }: { req: http.IncomingMessage }) => acceptsConnection(req.headers['sec-websocket-protocol'], token),
    // Answer with the app's protocol, never echoing the token one
    handleProtocols: (protocols: Set<string>) => protocols.has(API_PROTOCOL) ? API_PROTOCOL : false,
  });

  httpServer.listen(port, API_HOST, () => {
    // ! Log server startup (both to logger and console for main process) do not remove or modify
    const message = `✅ WebSocket Server listening on ws://localhost:${port} (tRPC endpoint: ws://localhost:${port}/trpc)`;
    console.log(message);

    publishApiFiles(port, token);
  });

  // Apply tRPC handler
  const handler = applyWSSHandler({
    wss,
    router: appRouter,
    createContext: createRpcContext,
    // In place of the adapter's `JSON.stringify`, which throws on a BigInt or a cycle — and throws from the loop
    // that drains a subscription rather than from the send, so the throw ends the subscription and the window's
    // whole event stream with it. `encoder.ts` has the measurements and what each case becomes.
    experimental_encoder: jsonSafeEncoder,
  });

  let hooksRun=false;
  const runShutdownHooks=()=>{if(!hooksRun){hooksRun=true;appPacks?.runShutdownHooks();}};
  // Safety net: always kill terminal processes before the API process exits
  process.on('exit', () => {
    runShutdownHooks();
    // Every write committed as it returned; closing syncs what the last group commit hadn't, so the machine failing
    // after exit loses nothing either
    try {
      appDatabase?.close();
    } catch (error) {
      console.error('[backend] Closing the database failed', error);
    }
    try {
      appRunHistory?.database.close();
    } catch (error) {
      console.error('[backend] Closing the run history failed', error);
    }
    const { apiPortFile, apiTokenFile } = resolveAppEnvironment();
    for (const file of [apiPortFile, apiTokenFile]) {
      try { fs.unlinkSync(file); } catch {}
    }
  });

  // Signal shutdown can await workers; the synchronous exit hook is only the final safety net.
  let shutdown:Promise<void>|undefined;
  process.on('SIGTERM', () => {
    shutdown??=(async()=>{
      try {
        backendActor?.stop();
        handler.broadcastReconnectNotification();
        wss.close();httpServer.close();
        runShutdownHooks();
      } finally {
        await closeDatabases([appDatabase,appRunHistory?.database]);
      }
      process.exit(0);
    })().catch(error=>{
      console.error('[backend] Graceful database shutdown failed',error);
      process.exit(1);
    });
  });

  // The parent died (Electron crashed, or was killed): its end of the IPC channel closed, so this process is
  // orphaned and shuts down the way a SIGTERM would. An API started without a channel — a manual boot, a test —
  // has no parent to outlive, so there is nothing to watch.
  if (process.connected) {
    process.on('disconnect', () => {
      console.log('[API] Parent process died, shutting down');
      process.kill(process.pid, 'SIGTERM');
    });
  }

  return { wss, handler, port };
}
