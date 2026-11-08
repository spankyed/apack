/**
 * Whether a URL is one this app may open, and how to name it in a log line.
 *
 * **Two doors open a link and both are reached by untrusted text** — a note the user pasted, a model's
 * answer, a pack's UI. The system browser is one (`openExternalUrl`, `@app/main`); a tab inside the app is
 * the other (`openLink`, `@apackdev/sdk/fe`), and it had no filter at all while the external branch did
 * (S4). So the rule lives here, in the one module both can reach, rather than beside either of them.
 *
 * It is not a list of approved sites: the app opens links people wrote, in notes, chats, terminals and
 * packs' UIs, and such a list would either block what they open or grow until it approves everything.
 *
 * @see https://www.electronjs.org/docs/latest/tutorial/security#14-do-not-use-openexternal-with-untrusted-content
 */

/** Schemes a web view or a browser opens. Anything else reaches another program: a mail client, a handler */
const WEB_SCHEMES = new Set(['http:', 'https:']);

/**
 * Why `url` is not a web link this app may open, or `undefined` when it is.
 *
 * `http:` stays allowed beside `https:` because the terminal links what a dev server prints, and that is the
 * address it prints.
 */
export function webUrlProblem(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'it is not a URL';
  }
  if (!WEB_SCHEMES.has(parsed.protocol)) return `its scheme is ${parsed.protocol}, and only http and https open as a link`;
  // "https://apple.com@evil.example" is a link to evil.example, read as one to apple.com
  if (parsed.username || parsed.password) return 'it carries credentials, which hide the host it opens';
  return undefined;
}

/** A URL as a log line names it: its origin and path, without a query that may carry a token */
export function summarizeUrl(url: string): string {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return url.slice(0, 80);
  }
}
