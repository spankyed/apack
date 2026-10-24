// `POST /db`: what `apack db query`, `exec`, `script` and `runs` ask the app running on a data dir, answered over the
// data this process holds (`answerDatabaseRequest`, `@apackdev/host/database`) — the transport only
import type * as http from 'http';
import { answerDatabaseRequest, encodeDatabaseAnswer, findAppDataPaths, readInstalledSchema, type DatabaseRequest } from '@apackdev/host/database';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { API_TOKEN_HEADER } from '@apackdev/sdk/utils/pure';
import { apiToken, isApiToken } from '../boot/config.ts';
import { appEngine, appRunHistory, appStore } from '../runtime/index.ts';

const KINDS: ReadonlySet<string> = new Set(['query', 'exec', 'runs', 'script'] satisfies Array<DatabaseRequest['kind']>);

/** The request's JSON body, once it has all arrived */
function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function refuse(res: http.ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(error);
}

/**
 * Answers a database request from a caller holding the API token — any build's, since `apack db` is the user's own
 * tool on the user's own data, which it could open offline anyway. The answer is the structured clone of the result
 * (`encodeDatabaseAnswer`), so it prints as it would offline.
 */
export async function handleDatabaseRequest(req: http.IncomingMessage, res: http.ServerResponse, token = apiToken()): Promise<void> {
  const given = req.headers[API_TOKEN_HEADER];
  if (!isApiToken(Array.isArray(given) ? given[0] : given, token)) return refuse(res, 403, 'the API token is missing or wrong');
  if (!appEngine || !appStore || !appRunHistory) return refuse(res, 503, 'the app has not opened its data yet');
  let request: DatabaseRequest;
  try {
    request = await readBody(req) as DatabaseRequest;
  } catch {
    return refuse(res, 400, 'the body is not JSON');
  }
  if (typeof request !== 'object' || request === null || !KINDS.has(request.kind)) return refuse(res, 400, 'not a database request');

  const context = resolveAppEnvironment();
  const answer = await answerDatabaseRequest(request, {
    userDataDir: context.userDataDir,
    paths: findAppDataPaths(context.userDataDir),
    // Read per request, as `apack db` reads it offline: the installed packs' manifests
    schema: readInstalledSchema(context),
    store: appStore,
    ears: appEngine,
    admin: appEngine.admin,
    runHistory: appRunHistory,
  });
  res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
  res.end(encodeDatabaseAnswer(answer));
}
