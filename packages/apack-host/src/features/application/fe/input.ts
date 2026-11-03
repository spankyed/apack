/// <reference lib="dom" />
// The keyboard and mouse, heard on the target the shell is given (the window): global hotkeys, and the mouse's back
// and forward buttons. With no target, neither listens.
import { fromCallback } from 'xstate';
import type { HotkeyEvent } from '@apackdev/sdk/fe';
import { HOST } from '../../../refs.ts';

/**
 * Tracks which keys are down and sends the shell each key press as a hotkey. Ported from @vueuse/core's
 * useMagicKeys: per-modifier dependency tracking, ordered cleanup on modifier release, macOS's missing keyup for keys
 * held with Meta (#1312), and a reset on blur and focus (#1350).
 */
export function hotkeyListener(target: EventTarget | undefined) {
  return fromCallback(({ system }) => {
    if (!target) return;
    const current = new Set<string>();
    const metaDeps = new Set<string>();
    const depsMap = new Map<string, Set<string>>([
      ['Meta', metaDeps],
      ['Shift', new Set<string>()],
      ['Alt', new Set<string>()],
    ]);

    function updateDeps(value: boolean, e: KeyboardEvent, keys: string[]) {
      if (!value || typeof e.getModifierState !== 'function') return;
      for (const [modifier, depsSet] of depsMap) {
        if (e.getModifierState(modifier)) {
          keys.forEach(key => depsSet.add(key));
          break;
        }
      }
    }

    function clearDeps(value: boolean, key: string) {
      if (value) return;
      const deps = depsMap.get(`${key[0].toUpperCase()}${key.slice(1)}`);
      if (!(['shift', 'alt'].includes(key)) || !deps) return;
      // Ordered cleanup: only clear keys pressed at or after the modifier, preserving keys pressed before it
      const depsArray = Array.from(deps);
      const depsIndex = depsArray.indexOf(key);
      depsArray.forEach((dep, index) => {
        if (index >= depsIndex) current.delete(dep);
      });
      deps.clear();
    }

    function updateKeys(e: KeyboardEvent, value: boolean) {
      const key = e.key?.toLowerCase();
      if (!key) return;
      if (value) current.add(key);
      else current.delete(key);
      const code = e.code?.toLowerCase();
      if (code) {
        if (value) current.add(code);
        else current.delete(code);
      }
      updateDeps(value, e, [...current]);
      clearDeps(value, key);
      // macOS: Meta release doesn't fire keyup for keys held with it (#1312)
      if (key === 'meta' && !value) {
        for (const dep of metaDeps) current.delete(dep);
        metaDeps.clear();
      }
    }

    const handleKeyDown = (event: Event) => {
      const e = event as KeyboardEvent;
      // Typing in a rich-text or code editor isn't a hotkey, unless it holds a modifier
      const typedIn = e.target as { closest?(selector: string): unknown } | null;
      if ((typedIn?.closest?.('.ProseMirror') || typedIn?.closest?.('.monaco-editor')) && !e.metaKey && !e.ctrlKey) return;

      updateKeys(e, true);

      // An earlier handler (Tiptap/ProseMirror, Monaco) already consumed it: running it through the global hotkey
      // map too would, say, both bold text and toggle the inspection panel on Cmd+B
      if (e.defaultPrevented) return;

      const hotkeyEvent: HotkeyEvent = {
        type: 'HOTKEY_PRESSED',
        key: e.key,
        metaKey: current.has('meta'),
        ctrlKey: current.has('control'),
        altKey: current.has('alt'),
        shiftKey: current.has('shift'),
        preventDefault: () => e.preventDefault(),
      };
      system.get(HOST.application).send({ type: 'PROCESS_GLOBAL_HOTKEY', hotkeyEvent, originalEvent: e });
    };
    const handleKeyUp = (event: Event) => updateKeys(event as KeyboardEvent, false);
    const reset = () => {
      current.clear();
      for (const deps of depsMap.values()) deps.clear();
    };

    target.addEventListener('keydown', handleKeyDown);
    target.addEventListener('keyup', handleKeyUp);
    target.addEventListener('blur', reset);
    target.addEventListener('focus', reset);
    return () => {
      target.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('keyup', handleKeyUp);
      target.removeEventListener('blur', reset);
      target.removeEventListener('focus', reset);
    };
  });
}

/** The mouse's back (button 3) and forward (button 4) buttons, sent to the shell as navigation */
export function mouseListener(target: EventTarget | undefined) {
  return fromCallback(({ system }) => {
    if (!target) return;
    const handleMouseDown = (event: Event) => {
      const e = event as MouseEvent;
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      system.get(HOST.application).send({ type: e.button === 3 ? 'NAVIGATE_BACK' : 'NAVIGATE_FORWARD' });
    };
    target.addEventListener('mousedown', handleMouseDown);
    return () => target.removeEventListener('mousedown', handleMouseDown);
  });
}
