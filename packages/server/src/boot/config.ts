import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SERVER_CONFIG = {
  DEFAULT_PORT: 3001,
  get port(): number {
    return process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : this.DEFAULT_PORT;
  }
};

/** The token this process accepts, and whether it made it up, taken once from the environment */
let held: { token: string; own: boolean } | undefined;

/**
 * Takes the token out of the environment: reads `APACK_API_TOKEN`, remembers it and deletes the variable.
 *
 * The delete is the point, and it is why this is a capture rather than a read. The token is
 * app-process-level access to the user's own data — `bus.send` reaches the database system, whose
 * transaction event runs the code it is given — and a variable left set is inherited by every child the API
 * spawns, the user's shell in a terminal among them, where any process the user runs can read it out of
 * `/proc` or an `env` dump. Filtering it at the spawn would cover the spawn sites someone remembered;
 * removing it from the environment covers every child, now and whatever spawns later.
 *
 * Nothing reads the variable after this. A local tool that needs the token reads `apiTokenFile`, which
 * `publishApiFiles` writes for a development app or one that made its own token up.
 */
function capture(): { token: string; own: boolean } {
  if (!held) {
    const given = process.env.APACK_API_TOKEN;
    delete process.env.APACK_API_TOKEN;
    held = given
      ? { token: given, own: false }
      : { token: randomBytes(32).toString('base64url'), own: true };
  }
  return held;
}

/**
 * Captures the token before the app exists, so nothing the API starts can inherit it. `server.ts` calls this
 * first; the readers below capture too, so an API that never calls it still loses the variable on first use.
 */
export const captureApiToken = (): void => void capture();

/**
 * The token every client must present: the one Electron main creates for each app run and passes as
 * `APACK_API_TOKEN`, or, for an API started by hand, a random one it makes up (see `apiTokenIsOwn`).
 * The API is never open: an open API would take any local web page's calls.
 */
export const apiToken = (): string => capture().token;

/** Whether the API made up its own token (nobody passed one), so only its token file tells clients what it is */
export const apiTokenIsOwn = (): boolean => capture().own;

/** Whether `given` is the API token, compared in constant time */
export function isApiToken(given: string | null | undefined, token = apiToken()): boolean {
  if (!given) return false;
  const actual = Buffer.from(token);
  const candidate = Buffer.from(given);
  return candidate.length === actual.length && timingSafeEqual(candidate, actual);
}
