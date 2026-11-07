// The API takes calls only from clients with its token, which Electron main creates for each app run (an API started by
// hand makes up its own): the app's windows send it when connecting, local tools with POST /dev/reload. A web page (the in-app browser's included)
// can't learn it. /dev/reload is also only for development and test apps, and the server listens on loopback only.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-dev-reload-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
process.env.APACK_API_TOKEN = 'the-run-token';
const { API_PROTOCOL, acceptsConnection, devRequestRefusal, publishApiFiles } = await import('../../src/transport/websocket.ts');
const { API_HOST } = await import('@apackdev/sdk/utils/pure');
const { apiToken, apiTokenIsOwn, captureApiToken, isApiToken } = await import('../../src/boot/config.ts');
// What boot does, in the order boot does it: the token is taken out of the environment before anything can spawn
captureApiToken();
const { resolveAppEnvironment } = await import('@apackdev/sdk/env');
const { readApiEndpoint } = await import('@apackdev/host/process-liveness');
const { API_TOKEN_HEADER } = await import('@apackdev/sdk/utils/pure');
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const TOKEN = 'the-run-token';
const withToken = (token: string) => ({ [API_TOKEN_HEADER]: token });

/**
 * An API booted by hand, in its own module registry: capture happens once per process, so a second boot needs
 * a second copy of the modules that hold the token. `transport` comes along for the cases that read the
 * provenance through `publishApiFiles`.
 */
const bootedWithoutAToken = async () => {
  vi.resetModules();
  delete process.env.APACK_API_TOKEN;
  const config = await import('../../src/boot/config.ts');
  const transport = await import('../../src/transport/websocket.ts');
  config.captureApiToken();
  return { ...config, ...transport };
};

describe('the API token', () => {
  it("is the app run's when one is given", () => {
    expect(apiToken()).toBe(TOKEN);
    expect(apiTokenIsOwn()).toBe(false);
  });

  it('is gone from the environment once captured, so nothing the API spawns inherits it', () => {
    // A terminal spawns the user's shell from this process's environment, where any command the user runs can
    // read it; the token reaches the database system's transaction event, which runs the code it is given.
    // Re-reading the variable instead of capturing it fails here.
    expect(process.env.APACK_API_TOKEN).toBeUndefined();
    expect(apiToken()).toBe(TOKEN);
  });

  it('is made up, random and kept, for an API started without one', async () => {
    const { apiToken: ownTokenOf, apiTokenIsOwn: isOwn, acceptsConnection: accepts } = await bootedWithoutAToken();
    const own = ownTokenOf();
    expect(isOwn()).toBe(true);
    expect(own).toMatch(/^[\w-]{43}$/);
    expect(ownTokenOf()).toBe(own);
    expect(accepts('apack', own)).toBe(false);
    expect(accepts(`apack, apack-token.${own}`, own)).toBe(true);
  });

  it('matches only itself', () => {
    expect(isApiToken(TOKEN, TOKEN)).toBe(true);
    expect(isApiToken('the-run-toke', TOKEN)).toBe(false);
    expect(isApiToken('the-run-tokenX', TOKEN)).toBe(false);
    expect(isApiToken('', TOKEN)).toBe(false);
    expect(isApiToken(undefined, TOKEN)).toBe(false);
  });
});

describe('WebSocket connections', () => {
  it('open with the token among the offered subprotocols', () => {
    expect(acceptsConnection(`apack, apack-token.${TOKEN}`, TOKEN)).toBe(true);
    expect(acceptsConnection(`apack-token.${TOKEN}`, TOKEN)).toBe(true);
    expect(API_PROTOCOL).toBe('apack');
  });

  it('are refused without it, with another, or with anything malformed', () => {
    expect(acceptsConnection(undefined, TOKEN)).toBe(false);
    expect(acceptsConnection('apack', TOKEN)).toBe(false);
    expect(acceptsConnection('apack, apack-token.guess', TOKEN)).toBe(false);
    expect(acceptsConnection('apack, apack-token.', TOKEN)).toBe(false);
    expect(acceptsConnection(TOKEN, TOKEN)).toBe(false);
    expect(acceptsConnection('//[, ,,', TOKEN)).toBe(false);
  });
});

describe('POST /dev/reload', () => {
  it('is taken with the token by a development or test app', () => {
    expect(devRequestRefusal(withToken(TOKEN), 'development', TOKEN)).toBeNull();
    expect(devRequestRefusal(withToken(TOKEN), 'test', TOKEN)).toBeNull();
    // The app environment and the token default to the process's
    expect(devRequestRefusal(withToken(TOKEN))).toBeNull();
  });

  it('is refused without the token, or with another', () => {
    expect(devRequestRefusal({}, 'development', TOKEN)).toMatch(/token is missing or wrong/);
    expect(devRequestRefusal(withToken('guess'), 'development', TOKEN)).toMatch(/token is missing or wrong/);
  });

  it('is refused by a production or beta app, token or not', () => {
    expect(devRequestRefusal(withToken(TOKEN), 'production', TOKEN)).toMatch(/development builds \(this one is production\)/);
    expect(devRequestRefusal(withToken(TOKEN), 'beta', TOKEN)).toMatch(/this one is beta/);
  });
});

it('listens on loopback only', () => {
  expect(API_HOST).toBe('127.0.0.1');
});

describe('the files the API publishes', () => {
  const { apiPortFile, apiTokenFile } = resolveAppEnvironment();
  const clear = () => { for (const file of [apiPortFile, apiTokenFile]) fs.rmSync(file, { force: true }); };

  it("publishes its port for every run, so a local tool can tell an app is running on the data dir", () => {
    clear();
    // A file from an earlier run, readable by anyone
    fs.mkdirSync(path.dirname(apiPortFile), { recursive: true });
    fs.writeFileSync(apiPortFile, '1111', { mode: 0o644 });
    // A packaged app: not development, and main gave it the run's token
    delete process.env.NODE_ENV;
    publishApiFiles(4321, TOKEN);

    const published = { port: 4321, pid: process.pid };
    expect(JSON.parse(fs.readFileSync(apiPortFile, 'utf-8'))).toEqual(published);
    // A tool reads it back as this running API
    expect(readApiEndpoint(apiPortFile)).toEqual(published);
    // Only the user reads it, whatever the data dir's own permissions are
    expect(fs.statSync(apiPortFile).mode & 0o777).toBe(0o600);
    // The API token stays out of the data dir: no local tool needs it there
    expect(fs.existsSync(apiTokenFile)).toBe(false);
  });

  it('publishes the token too for a development app, and for one that made up its own', async () => {
    clear();
    process.env.NODE_ENV = 'development';
    publishApiFiles(4322, TOKEN);
    expect(fs.readFileSync(apiTokenFile, 'utf-8')).toBe(TOKEN);
    expect(fs.statSync(apiTokenFile).mode & 0o777).toBe(0o600);

    clear();
    delete process.env.NODE_ENV;
    const byHand = await bootedWithoutAToken();
    const own = byHand.apiToken();
    byHand.publishApiFiles(4323, own);
    expect(fs.readFileSync(apiTokenFile, 'utf-8')).toBe(own);
  });
});
