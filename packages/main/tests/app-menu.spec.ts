// The application menu's accelerators fire wherever focus is, so a terminal cannot refuse one. Off macOS
// Electron's default menu binds a shell's keys — Ctrl+R searches history, Ctrl+W deletes a word, Ctrl+C
// interrupts — and nothing was replacing it, so typing any of them in a shell reloaded or closed the window
// (X3 in the terminal integration review). The template is a function of the platform so that this can be
// checked from any of them.
import {describe, expect, it} from 'vitest';
import {appMenuTemplate} from '../src/modules/app-menu.ts';

const env = {appName: 'apack', isPackaged: false};

/** Every accelerator in a template, however deep its submenus */
const acceleratorsOf = (items: Electron.MenuItemConstructorOptions[]): string[] =>
  items.flatMap(item => [
    ...(item.accelerator ? [item.accelerator] : []),
    ...(Array.isArray(item.submenu) ? acceleratorsOf(item.submenu) : []),
  ]);

/** The roles a template names, which is how the macOS menu declares most of its items */
const rolesOf = (items: Electron.MenuItemConstructorOptions[]): string[] =>
  items.flatMap(item => [
    ...(item.role ? [item.role] : []),
    ...(Array.isArray(item.submenu) ? rolesOf(item.submenu) : []),
  ]);

describe('the application menu off macOS', () => {
  // The keys a shell owns: interrupt, EOF, flow control, line-start, history search, suspend, kill-word,
  // delete-word and quoted-insert. A menu item on any of them takes it from every terminal in the app.
  const SHELL_KEYS = ['c', 'd', 'q', 's', 'a', 'r', 'z', 'u', 'w', 'v', 'k', 'e', 'b', 'f', 'p', 'n'];

  it('binds no accelerator a shell needs', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const accelerators = acceleratorsOf(appMenuTemplate(platform, env));
      expect(accelerators.length, `${platform}: an empty template takes Electron's default, which binds all of them`)
        .toBeGreaterThan(0);

      for (const accelerator of accelerators) {
        const bare = accelerator.replace(/^(Control|Ctrl|CommandOrControl|CmdOrCtrl)\+/i, '');
        const isPlainCtrlKey = bare !== accelerator && SHELL_KEYS.includes(bare.toLowerCase());
        expect(isPlainCtrlKey, `${platform}: ${accelerator} is a key the shell needs`).toBe(false);
      }
    }
  });

  it('names no role whose own accelerator would be one', () => {
    // A role carries Electron's accelerator unless the item overrides it, so `reload` or `close` with no
    // explicit accelerator is Ctrl+R or Ctrl+W by another route
    const roles = rolesOf(appMenuTemplate('win32', env));
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forceReload');
    expect(roles).not.toContain('close');
    expect(roles).not.toContain('quit');
    expect(roles).not.toContain('editMenu');
    expect(roles).not.toContain('windowMenu');
  });

  it('keeps the developer tools reachable', () => {
    expect(rolesOf(appMenuTemplate('linux', env))).toContain('toggleDevTools');
  });

  it('keeps page zoom reachable, which installing a menu takes from Electron s default', () => {
    // `+`, `-` and `0` are not a shell's keys, so the rule above does not ask for these to go — and nothing
    // else in the app binds them, so dropping them made page zoom unreachable off macOS
    expect(rolesOf(appMenuTemplate('win32', env))).toEqual(
      expect.arrayContaining(['resetZoom', 'zoomIn', 'zoomOut']),
    );
  });
});

describe('the application menu on macOS', () => {
  const template = appMenuTemplate('darwin', env);

  it('is the whole menu bar, since it is the only place these commands exist', () => {
    expect(rolesOf(template)).toEqual(expect.arrayContaining(['editMenu', 'windowMenu', 'about', 'services']));
  });

  it('hides on Cmd+Q and quits on Cmd+Shift+Q, so a terminal is not lost to a mistype', () => {
    const accelerators = acceleratorsOf(template);
    expect(accelerators).toContain('CommandOrControl+Q');
    expect(accelerators).toContain('CommandOrControl+Shift+Q');
  });

  it('offers the CLI install only in a packaged build, which is the only one that bundles it', () => {
    const labels = (items: Electron.MenuItemConstructorOptions[]): string[] =>
      items.flatMap(item => [
        ...(typeof item.label === 'string' ? [item.label] : []),
        ...(Array.isArray(item.submenu) ? labels(item.submenu) : []),
      ]);

    expect(labels(template).some(label => label.includes('command in PATH'))).toBe(false);
    expect(labels(appMenuTemplate('darwin', {...env, isPackaged: true})).some(label => label.includes('command in PATH'))).toBe(true);
  });
});
