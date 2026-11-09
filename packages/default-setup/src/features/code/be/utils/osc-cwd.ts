// The directory a shell reported, out of the escape sequence it reported it in.
//
// A shell that has shell integration announces its working directory with OSC 7, 633 or 1337. OSC 7 carries
// a **file URL**, and the other two carry a plain path — so one of the three needs decoding and all three
// need the result to be a path this machine can start a process in.
//
// **X5 is the Windows shape of that URL.** `file://host/C:/Users/someone` decodes to `/C:/Users/someone`:
// a leading slash before a drive letter, and forward slashes throughout. Nothing on Windows opens that. It
// used to be stored on the Terminal row and spawned from at the next launch; with the restore path checking
// its directory (S3) the symptom became quieter rather than gone — the terminal silently comes back in the
// user's home instead of where they were.

/**
 * The longest reported path this follows.
 *
 * **It is Linux's `PATH_MAX`, the largest of the three platforms' ordinary limits** (macOS allows 1024 and
 * Windows 260 before its extended form) — so nothing a shell can legitimately be sitting in is refused by
 * it. What it refuses is the other thing that writes these sequences: whatever is running in the pty, which
 * may be a hostile program rather than a shell, and which would otherwise have the app store and broadcast
 * an arbitrary string to every window on every prompt. A Windows extended-length path beyond this is not
 * something the terminal needs to follow, which is the decision rather than an oversight.
 */
const LONGEST_PATH = 4096;

/** A `file://` URL's path, or the string itself when it is already a path (OSC 633 and 1337 send one) */
function pathOf(reported: string): string {
  // OSC 7 is a URL, so its path keeps the leading slash — right for POSIX and wrong before a drive
  const drive = /^[/\\]([A-Za-z]:[/\\].*)$/.exec(reported);
  return drive ? drive[1]! : reported;
}

/**
 * The directory a shell reported, in this platform's own spelling, or `undefined` when it reported nothing
 * usable.
 *
 * `platform` is an argument because the answer is about the path and not about where this code is running:
 * a Windows path is wrong on a Mac for the same reasons, and a case can say so without a Windows machine.
 *
 * **Everything it is given is a claim** — the sequence is written by whatever is running in the pty, which
 * need not be the shell and need not be honest. So a claim that is too long or carries a control character
 * is refused outright rather than repaired: the terminal keeps the directory it had, which is the failure
 * that loses nothing. Repairing one would store a path that is not where anything is.
 */
export function cwdAsReported(reported: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const path = pathOf(reported.trim());
  if (path.length === 0 || path.length > LONGEST_PATH) return undefined;
  // A control character cannot be in a path any of the three platforms would hand back, and one in a string
  // the app stores and draws is a claim worth refusing rather than stripping
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(path)) return undefined;
  // A drive-letter path is Windows' whichever machine is reading it, and separators follow the path's shape
  // rather than the reader's
  if (/^[A-Za-z]:[/\\]/.test(path)) return path.replace(/\//g, '\\');
  if (platform === 'win32' && path.startsWith('\\\\')) return path;
  return path.startsWith('/') ? path : undefined;
}
