import type { PerformanceCarrier } from '../runtime/performance.ts';
// The app shell as frontend code reaches it: what it may read and what it may ask. The shell is the host
// `application` feature's surface, which lists the surfaces, holds which is open and lays out the panels. Pack code
// uses `useShell()`; nothing outside the host holds the shell's actor.
import { getCurrentScope, onScopeDispose, shallowReadonly, shallowRef, type Ref } from 'vue'
import type { AnyActorRef } from 'xstate'
import type { Surface } from './surface.ts'
import type { PackCommand } from '../commands/index.ts'
import { boundFeHost } from '../runtime/fe-host.ts'
import type { _Asker } from '../events/delivery.ts'

/** An event for a surface's actor */
export type SurfaceEvent = { type: string; [key: string]: unknown };

/** How the window's panels are laid out */
export interface ShellPanelSizes {
  /** The canvas's share of the main area's height, in percent */
  canvasHeight: number;
  /** The inspection panel's width in pixels; 0 while it's collapsed */
  inspectionWidth: number;
  /** The width to restore the inspection panel to after it was collapsed */
  previousInspectionWidth?: number;
  /** Whether the chat fills the main area, the canvas hidden */
  chatMaximized?: boolean;
}

/** The shell's state frontend code may read */
export interface HostShellState {
  /** Every registered surface, in the order the tabs show them */
  surfaces: readonly Surface[];
  /** The surface open in this window */
  activeSurface: Surface;
  /** Which surfaces' tabs show, by ref; a surface absent from it shows */
  surfaceVisibility: Readonly<Record<string, boolean>>;
  /**
   * The chat's slash commands, as the app last published them. The shell holds them because every editor in the
   * window needs them and no surface owns them: the feature playing the `commands` designation serves them on the
   * backend, and this is where the window keeps its copy. Empty until the first connection, and when no pack
   * plays the role.
   */
  commands: readonly PackCommand[];
  panelSizes: ShellPanelSizes;
}

/** The events frontend code may send the shell */
export type HostShellEvent =
  | import('../events/index.ts').OpenEntity
  /**
   * Opens the surface at a ref and hands its actor `events`. The shell waits for a surface whose pack's frontend is
   * still loading, and reports a ref no pack provides once loading has settled.
   */
  | { type: 'OPEN_SURFACE'; surface: string; events: SurfaceEvent[] }
  /**
   * Hands a surface's actor `events` without opening it. The same wait as `OPEN_SURFACE` — a surface whose pack's
   * frontend is still loading is waited for, and one no pack provides is reported once loading settles — but the
   * surface the user has open doesn't change: a send is not a navigation.
   *
   * `asker` is where an answer goes, so the receiving surface's handler is handed a `reply` that reaches whoever
   * asked. `from`/`via` are labels a refusal names and deliberately not an address; this is the address.
   *
   * It is the address rather than a ref because the **channel** is known here and nowhere later: this send stays
   * inside the window, so what answers it answers an actor beside it. The shell carries the value whole from
   * here to the delivery, through the queue a surface whose pack is still loading waits in — where a ref would
   * have had to be read back as a channel someone had to remember was a window's.
   *
   * `answering` says this send is an answer to a question rather than something a person asked for, which is
   * what decides how the shell reports a surface that isn't there — a toast tells a user their command failed,
   * and there is no user behind an answer. Only `reply` sets it.
   */
  | { type: 'SEND_TO_SURFACE'; diagnostics?: PerformanceCarrier; surface: string; events: SurfaceEvent[]; from?: string; via?: string; asker?: _Asker; answering?: string; call?: string }
  | { type: 'RESIZE_PANEL'; panel: 'canvas' | 'inspection'; size: number }
  | { type: 'RESTORE_CHAT' }
  | { type: 'SET_SURFACE_VISIBILITY'; surface: string; visible: boolean }
  | { type: 'CLOSE_DEV_LETTER' }
  | { type: 'HOTKEYS_RECORDING_START' }
  | { type: 'HOTKEYS_RECORDING_END' };

/** A snapshot of the shell, as frontend code reads it */
export interface HostShellSnapshot {
  context: HostShellState;
  /** `'onboarding'` while the user hasn't finished onboarding */
  hasTag(tag: string): boolean;
}

/**
 * The shell's actor as the frontend port holds it. The host's shell is checked against this contract where it is
 * defined, so a change to either side fails the typecheck rather than a pack at runtime.
 */
export interface HostShell {
  getSnapshot(): HostShellSnapshot;
  subscribe(observer: (snapshot: HostShellSnapshot) => void): { unsubscribe(): void };
  send(event: HostShellEvent): void;
  /** The surfaces' running actors, by ref */
  system: { get(id: string): AnyActorRef | undefined };
}

/** The shell, for a component or composable: its state as read-only refs, kept current, and what it may ask of it */
export interface Shell {
  surfaces: Readonly<Ref<readonly Surface[]>>;
  activeSurface: Readonly<Ref<Surface>>;
  surfaceVisibility: Readonly<Ref<Readonly<Record<string, boolean>>>>;
  /** The chat's slash commands, as the app last published them */
  commands: Readonly<Ref<readonly PackCommand[]>>;
  panelSizes: Readonly<Ref<ShellPanelSizes>>;
  isOnboarding: Readonly<Ref<boolean>>;
  /** Shows the canvas again when the chat is maximized */
  restoreChat(): void;
  /** Sets the canvas's share of the main area's height, in percent (kept within 20–95) */
  resizeCanvas(size: number): void;
  /** Shows or hides the tab of the surface at `ref`, in every window */
  setSurfaceVisible(ref: string, visible: boolean): void;
  /** Stops the app's hotkeys while a shortcut is being recorded, and starts them again */
  startHotkeyRecording(): void;
  endHotkeyRecording(): void;
  /** Closes the welcome letter and goes on with onboarding */
  closeDevLetter(): void;
}

/**
 * The app shell. Its refs follow the shell for as long as the calling scope lives (a component's setup, or an
 * effect scope), and stop following it when that scope is disposed. Outside a scope it throws: nothing would ever
 * stop the refs following the shell.
 */
export function useShell(): Shell {
  if (!getCurrentScope()) {
    throw new Error("useShell() runs in a component's setup or an effect scope (effectScope().run(() => useShell())): its refs follow the shell until that scope is disposed")
  }
  const shell = boundFeHost().application
  const read = (snapshot: HostShellSnapshot) => ({
    surfaces: snapshot.context.surfaces,
    activeSurface: snapshot.context.activeSurface,
    surfaceVisibility: snapshot.context.surfaceVisibility,
    commands: snapshot.context.commands,
    panelSizes: snapshot.context.panelSizes,
    isOnboarding: snapshot.hasTag('onboarding'),
  })
  const initial = read(shell.getSnapshot())
  const refs = {
    surfaces: shallowRef(initial.surfaces),
    activeSurface: shallowRef(initial.activeSurface),
    surfaceVisibility: shallowRef(initial.surfaceVisibility),
    commands: shallowRef(initial.commands),
    panelSizes: shallowRef(initial.panelSizes),
    isOnboarding: shallowRef(initial.isOnboarding),
  }
  const subscription = shell.subscribe((snapshot) => {
    const next = read(snapshot)
    // A ref changes only when its value does, so a component reading one field isn't re-rendered for another
    for (const key of Object.keys(refs) as Array<keyof typeof refs>) {
      if (refs[key].value !== next[key]) (refs[key] as Ref<unknown>).value = next[key]
    }
  })
  onScopeDispose(() => subscription.unsubscribe())

  return {
    surfaces: shallowReadonly(refs.surfaces),
    activeSurface: shallowReadonly(refs.activeSurface),
    surfaceVisibility: shallowReadonly(refs.surfaceVisibility),
    commands: shallowReadonly(refs.commands),
    panelSizes: shallowReadonly(refs.panelSizes),
    isOnboarding: shallowReadonly(refs.isOnboarding),
    restoreChat: () => shell.send({ type: 'RESTORE_CHAT' }),
    resizeCanvas: (size) => shell.send({ type: 'RESIZE_PANEL', panel: 'canvas', size }),
    setSurfaceVisible: (ref, visible) => shell.send({ type: 'SET_SURFACE_VISIBILITY', surface: ref, visible }),
    startHotkeyRecording: () => shell.send({ type: 'HOTKEYS_RECORDING_START' }),
    endHotkeyRecording: () => shell.send({ type: 'HOTKEYS_RECORDING_END' }),
    closeDevLetter: () => shell.send({ type: 'CLOSE_DEV_LETTER' }),
  }
}
