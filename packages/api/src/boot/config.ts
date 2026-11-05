import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SERVER_CONFIG = {
  DEFAULT_PORT: 3001,
  get port(): number {
    return process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : this.DEFAULT_PORT;
  }
};

/** The token an API started without `APACK_API_TOKEN` (by hand) made up for itself */
let ownToken: string | undefined;

/**
 * The token every client must present: the one Electron main creates for each app run and passes as
 * `APACK_API_TOKEN`, or, for an API started by hand, a random one it makes up (see `apiTokenIsOwn`).
 * The API is never open: an open API would take any local web page's calls.
 */
export function apiToken(): string {
  return process.env.APACK_API_TOKEN || (ownToken ??= randomBytes(32).toString('base64url'));
}

/** Whether the API made up its own token (nobody passed one), so only its token file tells clients what it is */
export const apiTokenIsOwn = (): boolean => !process.env.APACK_API_TOKEN;

/** Whether `given` is the API token, compared in constant time */
export function isApiToken(given: string | null | undefined, token = apiToken()): boolean {
  if (!given) return false;
  const actual = Buffer.from(token);
  const candidate = Buffer.from(given);
  return candidate.length === actual.length && timingSafeEqual(candidate, actual);
}
