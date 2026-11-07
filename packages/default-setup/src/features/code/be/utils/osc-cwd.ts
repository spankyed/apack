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

/** A `file://` URL's path, or the string itself when it is already a path (OSC 633 and 1337 send one) */
function pathOf(reported: string): string {
  const decoded = decodeURIComponent(reported);
  // The regex that captured this keeps the leading slash, which is right for POSIX and wrong before a drive
  const drive = /^[/\\]([A-Za-z]:[/\\].*)$/.exec(decoded);
  return drive ? drive[1]! : decoded;
}

/**
 * The directory a shell reported, in this platform's own spelling, or `undefined` when it reported nothing
 * usable.
 *
 * `platform` is an argument because the answer is about the path and not about where this code is running:
 * a Windows path is wrong on a Mac for the same reasons, and a case can say so without a Windows machine.
 */
export function cwdFromOsc(reported: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const path = pathOf(reported.trim());
  if (path.length === 0) return undefined;
  // A drive-letter path is Windows' whichever machine is reading it, and separators follow the path's shape
  // rather than the reader's
  if (/^[A-Za-z]:[/\\]/.test(path)) return path.replace(/\//g, '\\');
  if (platform === 'win32' && path.startsWith('\\\\')) return path;
  return path.startsWith('/') ? path : undefined;
}
