// Asking the app running on a data dir to answer a database request over the data it holds: `apack db query`,
// `exec`, `script` and `runs` go through it when it runs, and open the files only when it doesn't
import * as fs from 'node:fs';
import { DATABASE_REQUEST_PATH, decodeDatabaseAnswer, type DatabaseRequest } from '@apackdev/host/database';
import { readApiEndpoint } from '@apackdev/host/process-liveness';
import { API_HOST, API_TOKEN_HEADER } from '@apackdev/sdk/utils/pure';
import type { DbIo, DbTarget } from './target';

/**
 * The result the running app answered with, or null when no app on the data dir can be asked — none published its
 * port and token, or nothing answers on the port — and the command works offline, where a change is refused while an
 * app runs. What a script logged is printed as it arrives with the answer. An answered failure throws.
 */
export async function askRunningApp(
  target: DbTarget,
  /** The request, made only once an app is there to answer it */
  request: () => DatabaseRequest | Promise<DatabaseRequest>,
  io: DbIo,
): Promise<{ result: unknown } | null> {
  const endpoint = readApiEndpoint(target.apiPortFile);
  if (!endpoint) return null;
  let token: string;
  try {
    token = fs.readFileSync(target.apiTokenFile, 'utf-8').trim();
  } catch {
    return null;
  }
  if (!token) return null;
  let response: Response;
  try {
    response = await fetch(`http://${API_HOST}:${endpoint.port}${DATABASE_REQUEST_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [API_TOKEN_HEADER]: token },
      body: JSON.stringify(await request()),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => '')).trim();
    throw new Error(`The app running on ${target.userDataDir} refused the request: ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
  }
  io.err(`Database: ${target.userDataDir} (the running app's)`);
  const answer = decodeDatabaseAnswer(new Uint8Array(await response.arrayBuffer()));
  if ('error' in answer) throw new Error(answer.error);
  for (const line of answer.lines) io.out(line);
  return { result: answer.result };
}
