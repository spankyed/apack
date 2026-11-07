// `cmd` in a hotkey config names the platform's accelerator, and the app ships almost every hotkey written
// with it (X10 in the terminal integration review): comparing it against `metaKey` meant Cmd+W, Cmd+S,
// Cmd+P and the rest could never match off a Mac, where the accelerator is Control. The two exceptions are
// written with `ctrl` on purpose — Ctrl+` opens a terminal on every platform — so `ctrl` must not move.
import { describe, expect, it } from 'vitest';
import { matchesHotkey, processHotkeys, type HotkeyEvent, type KeyboardShortcut } from '../../src/fe/hotkeys.ts';

const ON_A_MAC = true;
const OFF_A_MAC = false;

/** A keypress as the window reports it: Control held is what Windows and Linux send for the accelerator */
const pressed = (key: string, held: Partial<Pick<HotkeyEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>> = {}): HotkeyEvent => ({
  type: 'HOTKEY_PRESSED',
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  preventDefault: () => {},
  ...held,
});

/** The shipped default for the code surface's close-tab, which is the shape all but two of them have */
const CMD_W: KeyboardShortcut = { key: 'w', modifiers: ['cmd'] };
/** The shipped default for opening a terminal, deliberately Control on every platform */
const CTRL_BACKTICK: KeyboardShortcut = { key: '`', modifiers: ['ctrl'] };

describe('a hotkey written with cmd', () => {
  it('matches the accelerator on each platform: Meta on a Mac, Control everywhere else', () => {
    expect(matchesHotkey(pressed('w', { metaKey: true }), CMD_W, ON_A_MAC)).toBe(true);
    expect(matchesHotkey(pressed('w', { ctrlKey: true }), CMD_W, OFF_A_MAC)).toBe(true);
  });

  it('matches neither the other platform\'s key nor a bare press', () => {
    // Control on a Mac is a shell's key — reverse-search, delete-word — and must not reach an app hotkey
    expect(matchesHotkey(pressed('w', { ctrlKey: true }), CMD_W, ON_A_MAC)).toBe(false);
    // Meta off a Mac is the Windows or Super key, which nothing sends with a letter
    expect(matchesHotkey(pressed('w', { metaKey: true }), CMD_W, OFF_A_MAC)).toBe(false);
    expect(matchesHotkey(pressed('w'), CMD_W, OFF_A_MAC)).toBe(false);
  });
});

describe('a hotkey written with ctrl', () => {
  it('means Control on every platform, which is what Ctrl+` wants', () => {
    expect(matchesHotkey(pressed('`', { ctrlKey: true }), CTRL_BACKTICK, ON_A_MAC)).toBe(true);
    expect(matchesHotkey(pressed('`', { ctrlKey: true }), CTRL_BACKTICK, OFF_A_MAC)).toBe(true);
  });

  it('does not take the accelerator on a Mac, where the two are different keys', () => {
    expect(matchesHotkey(pressed('`', { metaKey: true }), CTRL_BACKTICK, ON_A_MAC)).toBe(false);
  });
});

describe('the shipped defaults, driven through processHotkeys', () => {
  const hotkeys = { closeTab: CMD_W, openTerminal: CTRL_BACKTICK };
  const actions = { closeTab: 'CLOSE_TAB', openTerminal: 'OPEN_TERMINAL' } as const;

  it('reach their action on Windows and Linux, where none of them used to', () => {
    expect(processHotkeys(pressed('w', { ctrlKey: true }), hotkeys, actions, OFF_A_MAC)).toBe('CLOSE_TAB');
    expect(processHotkeys(pressed('`', { ctrlKey: true }), hotkeys, actions, OFF_A_MAC)).toBe('OPEN_TERMINAL');
  });

  it('still reach their action on a Mac, each by its own modifier', () => {
    expect(processHotkeys(pressed('w', { metaKey: true }), hotkeys, actions, ON_A_MAC)).toBe('CLOSE_TAB');
    expect(processHotkeys(pressed('`', { ctrlKey: true }), hotkeys, actions, ON_A_MAC)).toBe('OPEN_TERMINAL');
  });

  it('do not collide off a Mac, where both resolve to Control', () => {
    // The one thing normalisation could have broken: two configs, two keys, one modifier
    expect(processHotkeys(pressed('w', { ctrlKey: true }), hotkeys, actions, OFF_A_MAC)).toBe('CLOSE_TAB');
    expect(processHotkeys(pressed('`', { ctrlKey: true }), hotkeys, actions, OFF_A_MAC)).toBe('OPEN_TERMINAL');
  });
});
