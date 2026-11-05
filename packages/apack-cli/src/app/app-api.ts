import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import type { AppEnv } from '@apackdev/sdk/env';
import { readApiEndpoint } from '@apackdev/host/process-liveness';
import { API_HOST, API_TOKEN_HEADER, errorMessage } from '@apackdev/sdk/utils/pure';

/**
 * Asking a running app to do something for a local tool, and what that came to: `/dev/install` and `/dev/reload` for a
 * pack, `/db/changed-elsewhere` for a commit made beside it.
 */

/**
 * Where an app runs: its environment, and its data dir when a profile overrides the default. Leaving
 * `userDataDir` out is not the same as naming the default one — it lets `APACK_USER_DATA_DIR` from the
 * caller's shell still apply, which is an escape hatch that predates profiles.
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

/** The running app's API: its URL and the token it requires, from the files the API writes */
function findAppApi(place: AppPlace): { api: { url: string; token: string } } | { problem: string } {
  const { apiPortFile, apiTokenFile } = resolveAppEnvironment(place);
  const endpoint = readApiEndpoint(apiPortFile);
  if (!endpoint) return { problem: `no running ${place.env} app in ${apiPortFile}` };
  let token: string;
  try {
    token = fs.readFileSync(apiTokenFile, 'utf-8').trim();
  } catch (err) {
    return { problem: `couldn't read ${apiTokenFile}: ${errorMessage(err)}` };
  }
  if (!token) return { problem: `${apiTokenFile} is empty` };
  return { api: { url: `http://${API_HOST}:${endpoint.port}`, token } };
}

/**
 * What handing a request to the app came to. `detail` says which of the several ways it failed, since they ask
 * different things of the author: start the app, look at its logs, or check what is holding the port.
 */
export type AppDelivery =
  /** The app took it */
  | { status: 'delivered' }
  /** No port or token file to reach an app with */
  | { status: 'not-running'; detail: string }
  /** The app answered and refused, or couldn't do it */
  | { status: 'failed'; detail: string }
  /** Nothing answered on the port the app published */
  | { status: 'unreachable'; detail: string };

/** What handing a build to the app came to, which may also be that it already runs it */
export type DevDelivery = AppDelivery
  /** The app already runs this build's backend; Vite serves the rest */
  | { status: 'current' };

/** Posts one request to a running app's API */
async function post(url: string, token: string, body: object): Promise<AppDelivery> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [API_TOKEN_HEADER]: token },
      body: JSON.stringify(body),
    });
    if (res.ok) return { status: 'delivered' };
    const text = await res.text().catch(() => '');
    return { status: 'failed', detail: `${res.status} ${res.statusText}${text.trim() ? `: ${text.trim()}` : ''}` };
  } catch (err) {
    return { status: 'unreachable', detail: `${url}: ${errorMessage(err)}` };
  }
}

/** Posts one development request to the running app's API, with its token. */
async function devRequest(endpoint: string, body: object, place: AppPlace): Promise<AppDelivery> {
  const found = findAppApi(place);
  if ('problem' in found) return { status: 'not-running', detail: found.problem };
  return post(`${found.api.url}${endpoint}`, found.api.token, body);
}

/** Asks the running app to reload a pack's runtime. */
export function reloadPack(packId: string, place: AppPlace = { env: 'development' }): Promise<DevDelivery> {
  return devRequest('/dev/reload', { packId }, place);
}

/**
 * Asks the running app to install the build in a pack's source directory and start it. The app copies the
 * files and loads them itself, so nothing else it does can load a half-copied build.
 */
export function installPackInApp(root: string, place: AppPlace = { env: 'development' }): Promise<DevDelivery> {
  return devRequest('/dev/install', { root: path.resolve(root) }, place);
}

/** Tells the running app that this process committed to its database, which it can't otherwise hear. */
export async function tellAppDataChanged(place: AppPlace): Promise<AppDelivery> {
  const { apiPortFile } = resolveAppEnvironment(place);
  const endpoint = readApiEndpoint(apiPortFile);
  if (!endpoint?.dataChangedToken) return { status: 'not-running', detail: `no running ${place.env} app in ${apiPortFile}` };
  return post(`http://${API_HOST}:${endpoint.port}/db/changed-elsewhere`, endpoint.dataChangedToken, {});
}
