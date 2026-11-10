/**
 * `@parcel/watcher`, in a module of its own so that it can be loaded on first use.
 *
 * It is a native binding the host resolves for the pack, and the host resolves what a pack `require`s: this
 * import is one in the pack's bundle, where a dynamic `import('@parcel/watcher')` is resolved by Node's own
 * loader, which looks beside the installed pack and finds nothing. Whoever needs it imports this module
 * dynamically, so a build that lacks the binary fails there and not when the pack loads.
 */
import * as watcher from '@parcel/watcher'

export const subscribe = watcher.subscribe
