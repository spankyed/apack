// The API takes calls only from clients with its token, which Electron main creates for each app run (an API started by
// hand makes up its own): the app's windows send it when connecting, local tools with POST /dev/reload and POST /db. A web page (the in-app browser's included)
// can't learn it. /dev/reload is also only for development and test apps, and the server listens on loopback only.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-dev-reload-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
process.env.APACK_API_TOKEN = 'the-run-token';
const { API_PROTOCOL, acceptsConnection, devRequestRefusal, publishApiFiles } = await import('../../src/transport/websocket.ts');
const { API_HOST } = await import('@apackdev/sdk/utils/pure');
const { apiToken, apiTokenIsOwn, isApiToken } = await import('../../src/boot/config.ts');
const { resolveAppEnvironment } = await import('@apackdev/sdk/env');
const { readApiEndpoint } = await import('@apackdev/host/process-liveness');
const { API_TOKEN_HEADER } = await import('@apackdev/sdk/utils/pure');
const { handleDatabaseRequest } = await import('../../src/transport/database.ts');
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const TOKEN = 'the-run-token';
const withToken = (token: string) => ({ [API_TOKEN_HEADER]: token });

describe('the API token', () => {
  it("is the app run's when one is given", () => {
    expect(apiToken()).toBe(TOKEN);
    expect(apiTokenIsOwn()).toBe(false);
  });

  it('is made up, random and kept, for an API started without one', () => {
    delete process.env.APACK_API_TOKEN;
    try {
      const own = apiToken();
      expect(apiTokenIsOwn()).toBe(true);
      expect(own).toMatch(/^[\w-]{43}$/);
      expect(apiToken()).toBe(own);
      expect(acceptsConnection('apack', own)).toBe(false);
      expect(acceptsConnection(`apack, apack-token.${own}`)).toBe(true);
    } finally {
      process.env.APACK_API_TOKEN = TOKEN;
    }
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

  it("publishes its port and token for every run, so a local tool finds the app on the data dir and can call it", () => {
    clear();
    // A file from an earlier run, readable by anyone
    fs.mkdirSync(path.dirname(apiPortFile), { recursive: true });
    fs.writeFileSync(apiPortFile, '1111', { mode: 0o644 });
    // A packaged app: not development, and main gave it the run's token
    delete process.env.NODE_ENV;
    process.env.APACK_API_TOKEN = TOKEN;
    publishApiFiles(4321, TOKEN);

    expect(JSON.parse(fs.readFileSync(apiPortFile, 'utf-8'))).toEqual({ port: 4321, pid: process.pid });
    // A tool reads it back as this running API
    expect(readApiEndpoint(apiPortFile)).toEqual({ port: 4321, pid: process.pid });
    // Only the user reads it, whatever the data dir's own permissions are
    expect(fs.statSync(apiPortFile).mode & 0o777).toBe(0o600);
    // `apack db` calls a packaged app too, with the run's token, which only the user reads
    expect(fs.readFileSync(apiTokenFile, 'utf-8')).toBe(TOKEN);
    expect(fs.statSync(apiTokenFile).mode & 0o777).toBe(0o600);
  });

  it('publishes the token of a development app, and of one that made up its own', () => {
    clear();
    process.env.NODE_ENV = 'development';
    publishApiFiles(4322, TOKEN);
    expect(fs.readFileSync(apiTokenFile, 'utf-8')).toBe(TOKEN);
    expect(fs.statSync(apiTokenFile).mode & 0o777).toBe(0o600);

    clear();
    delete process.env.NODE_ENV;
    delete process.env.APACK_API_TOKEN;
    try {
      const own = apiToken();
      publishApiFiles(4323, own);
      expect(fs.readFileSync(apiTokenFile, 'utf-8')).toBe(own);
    } finally {
      process.env.APACK_API_TOKEN = TOKEN;
    }
  });
});

describe('POST /db', () => {
  /** What the handler answered: its status and body */
  async function answer(headers: Record<string, string>): Promise<{ status: number; body: string }> {
    let status = 0;
    let body = '';
    const res = { writeHead: (code: number) => { status = code; }, end: (text: string) => { body = text; }, headersSent: false };
    await handleDatabaseRequest({ headers } as never, res as never, TOKEN);
    return { status, body };
  }

  it('answers only a caller with the API token, whatever the build', async () => {
    expect(await answer({})).toEqual({ status: 403, body: 'the API token is missing or wrong' });
    expect(await answer(withToken('a-guess'))).toEqual({ status: 403, body: 'the API token is missing or wrong' });
  });

  it('refuses until the app has opened its data, rather than answer from none', async () => {
    expect(await answer(withToken(TOKEN))).toEqual({ status: 503, body: 'the app has not opened its data yet' });
  });
});
