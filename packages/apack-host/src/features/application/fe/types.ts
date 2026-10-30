import type { PerformanceCarrier } from '@apackdev/sdk/runtime';
import type { EntityOpeningActor } from './entity-opening.ts';
import type { OpenEntity } from '@apackdev/sdk/events';
// The app shell's state, events and the I/O it's given. Its machine (machine.ts) reads the rest of the app only
// through these ports, so it runs the same in the renderer, over the API and the window, and in a pack's tests.
import type { ContextMenuItem, HotkeyEvent, Surface, SurfaceEvent, ShellPanelSizes } from '@apackdev/sdk/fe';
import type { HostSurfaceEvents, Message, _Asker } from '@apackdev/sdk/events';
import type { ApplicationHotkeys } from '@apackdev/sdk/types';
import type { PackCommand } from '@apackdev/sdk/commands';
import type { ShellClient, ShellFailure } from '../../../fe/client.ts';
import type { ShellPackFrontends } from '../../../fe/pack-frontends.ts';
import type { ShellSurfaceCatalog } from '../../../fe/surface-selection.ts';
import type { FePackRegistry } from '../../../fe/pack-store.ts';
import type { ApplicationSurfaceEvents } from '../events.ts';
import type { BreadcrumbItem } from './trail.ts';

/** Where the panel sizes the user sets are kept, so the next window opens with them */
export interface ShellStorage {
  loadPanelSizes(): Partial<ShellPanelSizes> | undefined;
  savePanelSizes(sizes: ShellPanelSizes): void;
}

/** How the shell tells the user something went wrong */
export interface ShellNotify {
  /** A toast */
  error(title: string, detail?: string): void;
  /** Replaces the window with the error page */
  errorPage(title: string, detail: ShellFailure): void;
}

/** The I/O the shell is given */
export interface ShellOptions {
  /** This window's registered pack frontends: the surfaces the shell starts with, and its default */
  packs: Pick<FePackRegistry, 'getRegisteredSurfaces' | 'surfaceBindings' | 'designation'>;
  catalog: ShellSurfaceCatalog;
  client: ShellClient;
  packFrontends: ShellPackFrontends;
  storage: ShellStorage;
  notify: ShellNotify;
  /** Where the key and mouse listeners attach (the window); with none, none attach */
  target?: EventTarget;
}

/** What a window's shell starts with */
export interface ShellParams {
  /** The surface a popout opens on; opened once its pack's frontend has added it */
  initialSurfaceId?: string;
  /** Whether this is a main window, which opens on the surface last open and records the one it opens; a popout does neither */
  ownsLastActiveSurface?: boolean;
}

/** Who a message says made it */
export type MessageSender = Pick<Message, 'from' | 'via'>;

/**
 * Who made a request, in the two forms the shell needs — **one declaration rather than one per hop.** Both come
 * off the same `Message`, so they travel together and each survives however long the request waited for its
 * pack's frontend.
 *
 * The two are not the same fact and must not be collapsed into one field: `from` is a pack and `via` is what in
 * it, which is what a refusal can name usefully and what nothing can answer; `asker` is a participant, which is
 * the only thing that can be.
 */
export interface RequestSender extends MessageSender {
  diagnostics?: PerformanceCarrier;
  /**
   * Where an answer goes, so the receiving surface's handler is handed a `reply` that reaches whoever asked.
   * Absent for the shell's own sends — a lifecycle event, a hotkey, a navigation — and for an `OPEN_SURFACE`,
   * which is a navigation command rather than a question.
   *
   * The address whole, not a ref: it is built at the door it arrived through (`deliverInWindow` in the SDK, as
   * `askerOf` does on the bus) and carried untouched from there to the delivery. It was a ref through four
   * hops with the channel rebuilt at the end, which read as a fact about this queue and was a guess — right
   * only while every request in it came from a window, and silently wrong for the first that did not.
   */
  asker?: _Asker;
}

/** Asking for a surface: which one, whether to open it or only hand it its events, and who asked */
export interface SurfaceRequest {
  entityToken?: string;
  surface: string;
  select: boolean;
  sender: RequestSender;
  /**
   * Whether this send is an answer to a question rather than something a person asked for. It travels with the
   * request because the wait is what makes it matter: a reply to a surface whose pack is still loading sits in
   * the queue, and what tells the user about it when loading settles would be a toast nobody could act on.
   *
   * Set only by `reply` (`deliverInWindow`, `@apackdev/sdk/events`). Not a property of the asker: a send *to* an
   * asker is an answer, a send *from* one is not, and both carry the same `sender`.
   */
  answering?: string;
  /**
   * The call the send itself is, so the surface's own guards can read `callOf(event)` for a request as well as
   * for an answer. Forwarded from the envelope by `deliverInWindow`.
   */
  call?: string;
}

export interface ShellContext {
  entityOpening: EntityOpeningActor;
  defaultToggles: {
    canvas: boolean;
  };
  activeSurface: Surface;
  /**
    * The surface a pack claims as the app's default, or `null` until one has. Every pack's frontend loads
    * after this window is up, so `null` is the state the app starts in rather than a failure.
    */
  defaultSurface: Surface | null;
  /**
   * Whether to open the default surface as soon as a pack claims one. True for a window that started with no
   * default and nothing specific to show; cleared the moment anything else decides what is open — the user
   * selecting a tab, the host naming the surface last open, or a request for a particular surface.
   */
  wantsDefaultSurface: boolean;
  surfaces: Surface[];
  /** Which tabs show, the host's (AppState) */
  surfaceVisibility: Record<string, boolean>;
  /** The chat's slash commands, the app's: whichever feature plays the `commands` designation serves them */
  commands: PackCommand[];
  /** The surfaces opened, for back and forward */
  surfaceHistory: string[];
  historyIndex: number;
  breadcrumbs: BreadcrumbItem[];
  contextMenuItems: ContextMenuItem[];
  targetView: string;
  panelSizes: ShellPanelSizes;
  hotkeysDisabled: boolean;
  hotkeys: ApplicationHotkeys;
  /** A main window's: it opens on the surface last open and records the one it opens. A popout's surface isn't the app's */
  ownsLastActiveSurface: boolean;
  /**
   * A surface to open that isn't registered yet: the one a popout opens on, or the one last open, when an external
   * pack's frontend adds it after this window starts. Opened when its pack's surfaces arrive, unless the user has
   * opened another surface by then.
   */
  pendingSurfaceId: string | null;
  /**
   * Work waiting on a surface that isn't registered while pack frontends are still loading: an `OPEN_SURFACE`
   * (`select: true`) or a `SEND_TO_SURFACE`. One queue, because the wait is the same question — has that pack's
   * frontend arrived — and `select` is the only thing that differs once it has.
   */
  awaitingSurface: Array<SurfaceRequest & { events: SurfaceEvent[] }>;
  /** Whether this window's bus subscription is established; it reconnects after the connection drops */
  busSubscribed: boolean;
  /** Whether the pack frontend loader is running: one run at a time, so a pack is never loaded twice */
  packLoadRunning: boolean;
  /** A load was asked for while one was running — the list it read may predate the request — so it runs again */
  packLoadQueued: boolean;
  /** Accepted frontends need fresh backend-bound resources after reconnect. */
  packFrontendsNeedRefresh: boolean;
  /** Accepted frontend resources by backend lifetime; failed candidates retain the prior revision. */
  acceptedPackRuntimes: Record<string, string>;
  /**
   * Of those, the packs whose frontend entry loaded — so their systems are waiting for the startup data this
   * window's CLIENT_CONNECTED held back. A pack with no frontend code isn't one: the bus sent its systems that
   * already. Which surfaces each contributed isn't kept: a surface's id names its pack.
   */
  packsWithFrontend: string[];
  /** Packs unloaded while the loader was running: a result that arrives for one of them is dropped */
  packsUnloadedWhileLoading: string[];
  /** Whether the loaded packs were ever read: until it is, a failed read is worth telling the user about */
  loadedPacksRead: boolean;
}

export type ShellEvent =
  | OpenEntity
  | { type: 'ENTITY_OPEN_FINISHED'; token: string }
  /**
   * A selection the shell makes itself: an open whose surface is here, the default surface, the last-active surface
   * restored. Unlike `SELECT_SURFACE`, a person's choice, it cancels no entity open and supersedes no waiting open.
   */
  | { type: 'SELECT_SURFACE_BY_SHELL'; surface: string }
  | ApplicationSurfaceEvents
  | { type: 'SURFACE_DECLARATIONS_CHANGED' }
  | { type: 'SELECT_SURFACE'; surface: string; historyIndex?: number }
  | { type: 'OPEN_SURFACE'; surface: string; events: SurfaceEvent[]; entityToken?: string }
  | ({ type: 'SEND_TO_SURFACE'; surface: string; events: SurfaceEvent[]; answering?: string; call?: string } & RequestSender)
  /** Hands an opened surface its events, once the shell has selected it */
  | { type: 'DELIVER_SURFACE_EVENTS'; diagnostics?: PerformanceCarrier; surface: string; events: SurfaceEvent[]; asker?: RequestSender['asker']; answering?: string; call?: string; entityToken?: string }
  | { type: 'DEFAULT_TOGGLE'; area: 'canvas' }
  | { type: 'TRAIL_UPDATE'; crumbs: BreadcrumbItem[]; target?: string; menuItems: ContextMenuItem[] }
  | { type: 'TRAIL_CLICK'; target: string; info?: unknown }
  | { type: 'RESIZE_PANEL'; panel: 'canvas' | 'inspection'; size: number }
  | { type: 'TOGGLE_INSPECTION_PANEL' }
  | { type: 'MAXIMIZE_CHAT' }
  | { type: 'RESTORE_CHAT' }
  | HotkeyEvent
  | { type: 'SWITCH_SURFACE_UP' }
  | { type: 'SWITCH_SURFACE_DOWN' }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'NAVIGATE_FORWARD' }
  | { type: 'FORWARD_HOTKEY'; event: HotkeyEvent }
  | { type: 'PROCESS_GLOBAL_HOTKEY'; hotkeyEvent: HotkeyEvent; originalEvent?: { preventDefault(): void } }
  | { type: 'HOTKEYS_RECORDING_START' }
  | { type: 'HOTKEYS_RECORDING_END' }
  // What the host's application system and pack systems send this surface; their OPEN_SURFACE arrives as
  // OPEN_SURFACE_FROM_APP, which only a main window acts on
  | Exclude<HostSurfaceEvents['host/application'], { type: 'OPEN_SURFACE' }>
  | { type: 'OPEN_SURFACE_FROM_APP'; surface: string; events?: SurfaceEvent[] }
  | { type: 'SET_SURFACE_VISIBILITY'; surface: string; visible: boolean }
  | { type: 'CLOSE_DEV_LETTER' }
  | { type: 'SYSTEM_ERROR'; errorId?: string; title?: string; message: string; source?: string; operation?: string; entityId?: string; severity?: 'diagnostic' | 'error' | 'fatal'; stack?: string; timestamp?: number }
  | { type: 'BACKEND_ERROR'; error: ShellFailure }
  | { type: 'BUS_SUBSCRIBED' }
  | { type: 'BUS_CONNECTION_LOST' }
  /** Load the frontends of the packs this window hasn't loaded: on connecting, and when a pack activates */
  | { type: 'LOAD_PACK_FRONTENDS' }
  /**
   * The loader finished: `loadedPacksError` is why the loaded packs couldn't be read, when they couldn't,
   * and `failedPacks` the packs that threw while loading, which that read reached
   */
  | { type: 'PACK_FRONTENDS_SETTLED'; loadedPacksError?: string; failedPacks?: { packId: string; error: string }[] }
  /**
   * A pack's frontend was accepted, with its surfaces, or null for a pack without frontend code.
   * Refused candidates do not emit this event.
   */
  | { type: 'PACK_FRONTEND_LOADED'; packId: string; registrationId: string; surfaces: Surface[] | null }
  /**
   * A pack's frontend is gone from this window. `refused`: its replacement was refused, so the incumbent it
   * would have replaced is unloaded too, and no load of it is in flight to discard.
   */
  | { type: 'PACK_SURFACES_UNLOADED'; packId: string; refused?: true };
