// The app's own features, as the pack `host`: every host module names them from here. Pack code writes them as
// `'host/<feature>'`, which its generated types check. Frontend-safe: imports only `@apackdev/sdk/ids`.
import { HOST_PACK_ID, resolveName } from '@apackdev/sdk/ids';

export const HOST = {
  /** The root bus machine the app starts every system under: not a feature, but spelled as one */
  bus: resolveName('bus', HOST_PACK_ID),
  /** The app shell: its backend system keeps the shell's state, and the renderer's application actor is its surface */
  application: resolveName('application', HOST_PACK_ID),
  /** Installing, updating and toggling packs: its system, and the renderer's Packs surface */
  packs: resolveName('packs', HOST_PACK_ID),
  /** The app's settings: the store's system, and the renderer's Settings surface */
  settings: resolveName('settings', HOST_PACK_ID),
  help: resolveName('help', HOST_PACK_ID),
  /**
   * An agent or script driving the app, which claims this name on its connection rather than being registered by
   * a pack: not a feature either, and spelled as one for the same reason `bus` is — so every gate that reads a ref
   * keeps working and no second address grammar exists. Nothing holds it unless a drive session is running.
   */
  drive: resolveName('drive', HOST_PACK_ID),
  /**
   * The E2E suite asking a system something from a window. The window claims this name on its own connection
   * when `app.ask` (`@apackdev/testing`) asks, so the system's `reply` comes back to that window, where the
   * renderer hands it to the waiting ask instead of to a surface. Claimed, never registered, as `drive` is.
   */
  e2e: resolveName('e2e', HOST_PACK_ID),
  /**
   * An E2E spec's own connection to the API (the `connection` fixture, `@apackdev/testing`), beside the window's:
   * it claims this name so a system's reply to its asks reaches it. Its own name rather than `e2e`, which the window
   * claims, since a name is held by one connection at a time.
   */
  e2eConnection: resolveName('e2eConnection', HOST_PACK_ID),
} as const;
