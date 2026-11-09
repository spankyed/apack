// The directory a shell reported, out of the sequence it reported it in — X5.
//
// A shell with shell integration announces where it is with OSC 7, 633 or 1337. OSC 7 carries a file URL,
// and on Windows that URL decodes to `/C:/Users/someone`: a slash before a drive letter, and forward
// slashes throughout. Nothing there opens it. It was stored on the Terminal row and spawned from at the
// next launch; with the restore path checking its directory the symptom only got quieter — the terminal
// comes back in the user's home rather than where they were.
import { describe, expect, it } from 'vitest'
import { cwdFromOsc } from '#features/code/be/utils/osc-cwd.ts'

describe('the directory a shell reported', () => {
  it('turns a Windows file URL into a path Windows can open', () => {
    // What `__ab_osc7` sends from a Windows shell, percent-encoded as a URL is
    expect(cwdFromOsc('/C:/Users/someone/my%20project')).toBe('C:\\Users\\someone\\my project')
  })

  it('leaves a POSIX path alone', () => {
    expect(cwdFromOsc('/Users/someone/project')).toBe('/Users/someone/project')
    expect(cwdFromOsc('/home/someone/a%20folder')).toBe('/home/someone/a folder')
  })

  it('takes a plain path, which OSC 633 and 1337 send instead of a URL', () => {
    expect(cwdFromOsc('C:\\Users\\someone')).toBe('C:\\Users\\someone')
    expect(cwdFromOsc('/var/tmp')).toBe('/var/tmp')
  })

  it('keeps a UNC path whole, which is a Windows share and not a drive', () => {
    expect(cwdFromOsc('\\\\server\\share\\work', 'win32')).toBe('\\\\server\\share\\work')
  })

  it('answers nothing for what is not a path, rather than storing it', () => {
    // A relative fragment is what a half-read sequence leaves, and starting a shell in one is not defined
    expect(cwdFromOsc('')).toBeUndefined()
    expect(cwdFromOsc('   ')).toBeUndefined()
    expect(cwdFromOsc('some/relative/thing')).toBeUndefined()
  })

  it('reads a drive path as Windows wherever it is read', () => {
    // The path's own shape says what it is; the machine doing the reading does not come into it, which is
    // what lets this case exist without a Windows machine
    expect(cwdFromOsc('/D:/work', 'darwin')).toBe('D:\\work')
  })
})

/**
 * **A reported path is a claim, and these are the claims that are refused rather than repaired.**
 *
 * The sequence is written by whatever is running in the pty, which need not be the shell. Refusing leaves
 * the terminal where it was; repairing would store a path nothing is at, and stripping a control character
 * out of a path changes which directory it names.
 */
describe('a claim that is not a path', () => {
  it('refuses one longer than any platform could hand back', () => {
    const real = `/Users/me/${'a'.repeat(4000)}`;
    expect(cwdFromOsc(real), 'a long but possible path is still followed').toBe(real);
    expect(cwdFromOsc(`/Users/me/${'a'.repeat(5000)}`)).toBeUndefined();
  });

  it('refuses one carrying a control character', () => {
    expect(cwdFromOsc('/Users/me/\u001b[31mred')).toBeUndefined();
    expect(cwdFromOsc('/Users/me/\u0000')).toBeUndefined();
    expect(cwdFromOsc('/Users/me/ok')).toBe('/Users/me/ok');
  });

  /** A malformed escape used to throw, which a prompt hook turned into an error logged on every prompt */
  it('reads a malformed percent escape as the characters it is', () => {
    expect(cwdFromOsc('/Users/me/100%zz')).toBe('/Users/me/100%zz');
    expect(cwdFromOsc('/Users/me/a%20b')).toBe('/Users/me/a b');
  });
});
