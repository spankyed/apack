import { nativeFrontendDeclarationFixture } from '@apackdev/sdk/testing';
// The window's shell reads the panel sizes the user set from localStorage: a saved value it can't read leaves the
// window on the defaults, rather than failing the shell and the window with it.
import { afterEach, expect, it, vi } from 'vitest';
import { state } from '@apackdev/state';

vi.mock('@/transport/client', () => ({
  feClient: {
    send: () => {},
    subscribe: () => () => {},
    packClientReady: () => Promise.resolve(),
    loadedPacks: () => Promise.resolve([]),
    entityExists: () => Promise.resolve(true),
    describeConnection: () => Promise.resolve(''),
    watchView: () => () => {},
  },
}));
vi.mock('@/adapters/toast', () => ({ globalToast: { error: vi.fn() } }));
vi.mock('@/adapters/pack-frontends', () => ({ packFrontendIO: { importModule: vi.fn(), styles: { prepare: vi.fn(), remove: vi.fn() } } }));

const { createAppShell } = await import('@/runtime/shell');
const { fePacks } = await import('@/runtime/packs');

const registration = {
  id: 'memo-pack',
  features: { memos: { surface: { label: 'Memos', icon: {}, state: state<Record<string, never>, never>()({}), canvas: {} }, default: true as const } },
};
fePacks.registerPackFE({ kind: 'native', declaration: nativeFrontendDeclarationFixture(registration) }, registration);

const PANEL_SIZES_KEY = 'apack-panel-sizes';

afterEach(() => localStorage.removeItem(PANEL_SIZES_KEY));

const openedPanelSizes = () => {
  const shell = createAppShell({ ownsLastActiveSurface: false }).start();
  const { panelSizes } = shell.getSnapshot().context;
  shell.stop();
  return panelSizes;
};

it('opens with the panel sizes the user set', () => {
  localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify({ canvasHeight: 70 }));
  expect(openedPanelSizes()).toMatchObject({ canvasHeight: 70, inspectionWidth: 448 });
});

it("opens with the defaults when the saved sizes aren't JSON", () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.setItem(PANEL_SIZES_KEY, '{not json');

  expect(openedPanelSizes()).toMatchObject({ canvasHeight: 50, inspectionWidth: 448 });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring unreadable panel sizes'));
  warn.mockRestore();
});
