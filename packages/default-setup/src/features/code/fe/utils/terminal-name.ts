// What a terminal is called when nobody has named it: the last part of where it is.
//
// **X7 and X8 are the two ways `cwd.split('/')` is wrong**, and both call sites had them. A Windows path has
// no forward slashes, so splitting on one returns the whole of `C:\Users\someone\project` as the name — the
// tab shows a path where every other tab shows a word. And a path that is only a root has no last part at
// all, so `C:\` and `/` both fell through to a hardcoded "root", which names the drive for nobody.
//
// It is one function because it was two copies, and they are the kind that drift: one of them already said
// `|| terminal.title` where the other said `|| terminalInfo.title`.

/** The drive a path is rooted at, when that is all the path is (`C:\` and `/` are the two shapes) */
function rootName(cwd: string): string | undefined {
  const drive = /^([A-Za-z]):[/\\]*$/.exec(cwd)
  if (drive) return `${drive[1]!.toUpperCase()}:`
  return /^[/\\]+$/.test(cwd) ? '/' : undefined
}

/**
 * The name to show for a terminal at `cwd`, or `undefined` when the path says nothing.
 *
 * Both separators, because the path belongs to wherever the shell is rather than to whoever is drawing it —
 * and a window drawing a remote or a WSL session is the case where assuming one is quietly wrong.
 */
export function terminalNameFor(cwd: string | undefined): string | undefined {
  const path = cwd?.trim()
  if (!path) return undefined
  const root = rootName(path)
  if (root) return root
  return path.split(/[/\\]/).filter(Boolean).pop()
}
