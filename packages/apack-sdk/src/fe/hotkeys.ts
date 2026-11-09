export interface KeyboardShortcut {
  key: string;
  modifiers: string[];
  global?: boolean;
}

export interface HotkeyEvent {
  type: 'HOTKEY_PRESSED';
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  allowedActions?: Set<string>;
  preventDefault: () => void;
}

export type HotkeysMap = {
  [action: string]: KeyboardShortcut | null | undefined;
}

export interface SurfaceHotkeyDefinition {
  action: string;
  global?: boolean;
}

/**
 * Whether this platform's accelerator is Meta, which is macOS and nowhere else.
 *
 * Read from the window, so it answers `false` where there is no window — a spec, a worker — which is also the
 * answer that makes `cmd` mean Control there. Every call site that compares a hotkey takes it as an argument,
 * so nothing here depends on a platform it cannot be told about.
 */
export const primaryModifierIsMeta = (): boolean =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/**
 * Whether `event` is the key combination `config` names.
 *
 * **`cmd` names the platform's accelerator, not the Mac key.** Every hotkey this app ships but two is written
 * with `cmd`, and comparing it against `metaKey` meant none of them could match off a Mac, where the
 * accelerator is Control and `metaKey` is the Windows or Super key nothing sends with a letter. `ctrl` still
 * means Control everywhere, which is what the two exceptions want — `Ctrl+\`` opens a terminal on every
 * platform, as it does in the editors this borrows it from.
 *
 * `cmdIsMeta` is an argument so that the behaviour on a platform is testable from any platform.
 */
export function matchesHotkey(
  event: HotkeyEvent,
  config: KeyboardShortcut,
  cmdIsMeta = primaryModifierIsMeta(),
): boolean {
  if (!config?.key) return false;

  const wantsAccelerator = config.modifiers.includes('cmd');
  const wantsMeta = cmdIsMeta && wantsAccelerator;
  const wantsCtrl = config.modifiers.includes('ctrl') || (!cmdIsMeta && wantsAccelerator);

  const modifierMatch =
    (wantsMeta === event.metaKey) &&
    (wantsCtrl === event.ctrlKey) &&
    (config.modifiers.includes('alt') || config.modifiers.includes('option') ? event.altKey : !event.altKey) &&
    (config.modifiers.includes('shift') === event.shiftKey);

  return event.key.toLowerCase() === config.key.toLowerCase() && modifierMatch;
}

export function processHotkeys<const T extends Record<string, string>, H = unknown>(
  event: HotkeyEvent,
  hotkeys: H | undefined,
  actionMap: T,
  cmdIsMeta = primaryModifierIsMeta(),
): T[keyof T] | undefined {
  if (!hotkeys) return undefined;

  for (const actionName of Object.keys(actionMap) as (keyof T)[]) {
    if (event.allowedActions && !event.allowedActions.has(actionName as string)) continue;
    const hotkeyConfig = (hotkeys as Record<string, unknown>)[actionName as string];
    if (hotkeyConfig && matchesHotkey(event, hotkeyConfig as KeyboardShortcut, cmdIsMeta)) {
      event.preventDefault();
      return actionMap[actionName];
    }
  }

  return undefined;
}

export function createHotkeyProcessor<
  const TMap extends Record<string, string>,
  TContext extends { hotkeys: HotkeysMap } = { hotkeys: HotkeysMap },
  TEvent = HotkeyEvent
>(actionMap: TMap) {
  return ({ event, context, self }: {
    event: TEvent;
    context: TContext;
    self: { send: (event: { type: TMap[keyof TMap] }) => void };
  }) => {
    const hotkeyEvent = event as HotkeyEvent;

    const actionType = processHotkeys(
      hotkeyEvent,
      context.hotkeys,
      actionMap
    );

    if (actionType) {
      self.send({ type: actionType });
    }
  };
}
