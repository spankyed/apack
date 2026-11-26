import { describe, expect, it } from 'vitest';
import type { ContextMenuItem } from '@apackdev/sdk/fe';
import {
  computeTrail,
  topLevelState,
  type SurfaceChrome,
  type SurfaceStateValue,
} from '../../../../src/features/application/fe/chrome.ts';

describe('topLevelState', () => {
  it('extracts the first dot-delimited segment or returns undefined for empty paths', () => {
    expect(topLevelState(undefined)).toBeUndefined();
    expect(topLevelState('')).toBeUndefined();
    expect(topLevelState('.leading')).toBeUndefined();
    expect(topLevelState('list')).toBe('list');
    expect(topLevelState('editor.preview')).toBe('editor');
    expect(topLevelState('library.detail.nested')).toBe('library');
  });
});

describe('computeTrail', () => {
  describe('single-state and root-chrome surfaces (database pattern)', () => {
    const viewHistory: ContextMenuItem = { label: 'View Run History', event: { type: 'VIEW_MODE.TOGGLE' } };
    const backupRestore: ContextMenuItem = {
      separator: true,
      label: 'Backup & Restore',
      event: { type: 'VIEW_BACKUP' },
    };

    it('resolves root breadcrumb and root menu when state has no `at` path', () => {
      const chrome: SurfaceChrome = {
        breadcrumb: { label: 'Database Explorer', target: 'explorer' },
        menu: [viewHistory, backupRestore],
      };

      const trail = computeTrail(chrome, { data: { mode: 'sql' } });

      expect(trail).toEqual({
        breadcrumbs: [{ label: 'Database Explorer', target: 'explorer' }],
        contextMenu: [viewHistory, backupRestore],
        target: 'explorer',
      });
    });

    it('uses `default` as sole crumb on the default view and prepends it on sub-views alongside root menu', () => {
      const chrome: SurfaceChrome = {
        default: { label: 'Database Explorer', target: 'explorer' },
        menu: [viewHistory, backupRestore],
        states: {
          backup: {
            breadcrumb: { label: 'Backup & Restore', target: 'backup' },
          },
        },
      };

      expect(computeTrail(chrome, { at: 'explorer', data: {} })).toEqual({
        breadcrumbs: [{ label: 'Database Explorer', target: 'explorer' }],
        contextMenu: [viewHistory, backupRestore],
        target: 'explorer',
      });

      expect(computeTrail(chrome, { at: 'backup', data: {} })).toEqual({
        breadcrumbs: [
          { label: 'Database Explorer', target: 'explorer' },
          { label: 'Backup & Restore', target: 'backup' },
        ],
        contextMenu: [viewHistory, backupRestore],
        target: 'backup',
      });
    });
  });

  describe('multi-state flat surfaces with default crumb (actions/prompts pattern)', () => {
    interface ActionState extends SurfaceStateValue {
      readonly data: { readonly selectedId?: string; readonly selectedLabel?: string };
    }

    const actionsChrome: SurfaceChrome<ActionState> = {
      default: { label: 'Actions', target: 'list' },
      states: {
        list: {
          breadcrumb: { label: 'Actions', target: 'list' },
        },
        create: {
          breadcrumb: { label: 'New Action', target: 'create' },
        },
        detail: {
          breadcrumb: (state) => ({
            label: state.data.selectedLabel || state.data.selectedId || '',
            target: 'detail',
          }),
          menu: (state) => [
            {
              label: 'Delete Action',
              event: { type: 'ACTION.DELETE', actionId: state.data.selectedId ?? '' },
            },
          ],
        },
      },
    };

    it('does not duplicate the default crumb when on the default state', () => {
      const trail = computeTrail(actionsChrome, { at: 'list', data: {} });

      expect(trail).toEqual({
        breadcrumbs: [{ label: 'Actions', target: 'list' }],
        contextMenu: [],
        target: 'list',
      });
    });

    it('prepends the default crumb on non-default static and dynamic states', () => {
      expect(computeTrail(actionsChrome, { at: 'create', data: {} })).toEqual({
        breadcrumbs: [
          { label: 'Actions', target: 'list' },
          { label: 'New Action', target: 'create' },
        ],
        contextMenu: [],
        target: 'create',
      });

      expect(
        computeTrail(actionsChrome, {
          at: 'detail',
          data: { selectedId: 'act-1', selectedLabel: 'Deploy' },
        }),
      ).toEqual({
        breadcrumbs: [
          { label: 'Actions', target: 'list' },
          { label: 'Deploy', target: 'detail' },
        ],
        contextMenu: [{ label: 'Delete Action', event: { type: 'ACTION.DELETE', actionId: 'act-1' } }],
        target: 'detail',
      });
    });

    it('deduplicates when the leading resolved crumb already targets default.target', () => {
      // Mirrors surfaces like Settings where the state key (`ready`) differs from the crumb target (`settings`).
      const settingsChrome: SurfaceChrome = {
        default: { label: 'Settings', target: 'settings' },
        states: {
          ready: {
            breadcrumb: { label: 'Settings', target: 'settings' },
          },
        },
      };

      expect(computeTrail(settingsChrome, { at: 'ready', data: {} })).toEqual({
        breadcrumbs: [{ label: 'Settings', target: 'settings' }],
        contextMenu: [],
        target: 'settings',
      });
    });
  });

  describe('dynamic breadcrumbs and merged context menus', () => {
    interface NotesState extends SurfaceStateValue {
      readonly data: {
        readonly ancestors: readonly { readonly id: string; readonly title: string }[];
        readonly current?: { readonly id: string; readonly title: string };
        readonly pinned?: boolean;
      };
    }

    const rootItem: ContextMenuItem = { label: 'New Note', event: { type: 'NOTE.CREATE' } };
    const deleteItem: ContextMenuItem = { label: 'Delete Note', event: { type: 'NOTE.DELETE' } };
    const pinItem: ContextMenuItem = { label: 'Pin Note', event: { type: 'NOTE.PIN' } };

    const notesChrome: SurfaceChrome<NotesState> = {
      default: { label: 'Notes', target: 'welcome' },
      menu: () => [rootItem],
      states: {
        welcome: {
          breadcrumb: { label: 'Notes', target: 'welcome' },
        },
        editor: {
          breadcrumb: (state) => {
            if (!state.data.current) return [];
            return [
              ...state.data.ancestors.map((a) => ({ label: a.title, target: 'editor', info: a.id })),
              { label: state.data.current.title, target: 'editor', info: state.data.current.id },
            ];
          },
          menu: (state) => (state.data.current ? [deleteItem, pinItem] : []),
        },
      },
    };

    it('prepends default before a dynamic breadcrumb array and merges root + state menus with a separator', () => {
      const trail = computeTrail(notesChrome, {
        at: 'editor',
        data: {
          ancestors: [{ id: 'n1', title: 'Workspace' }],
          current: { id: 'n2', title: 'Roadmap' },
        },
      });

      expect(trail.breadcrumbs).toEqual([
        { label: 'Notes', target: 'welcome' },
        { label: 'Workspace', target: 'editor', info: 'n1' },
        { label: 'Roadmap', target: 'editor', info: 'n2' },
      ]);
      expect(trail.target).toBe('editor');
      expect(trail.contextMenu).toEqual([
        rootItem,
        { ...deleteItem, separator: true },
        pinItem,
      ]);
      // Does not mutate the original state menu item
      expect(deleteItem.separator).toBeUndefined();
    });

    it('falls back to default crumb when dynamic state breadcrumb returns an empty array', () => {
      const trail = computeTrail(notesChrome, {
        at: 'editor',
        data: { ancestors: [] },
      });

      expect(trail).toEqual({
        breadcrumbs: [{ label: 'Notes', target: 'welcome' }],
        contextMenu: [rootItem],
        target: 'welcome',
      });
    });

    it('falls back to root breadcrumb when dynamic state breadcrumb returns undefined', () => {
      const chrome: SurfaceChrome<{ readonly at?: string; readonly data: { readonly label?: string } }> = {
        breadcrumb: (state) => ({ label: state.data.label ?? 'Root', target: 'root' }),
        states: {
          detail: {
            breadcrumb: (state) => (state.data.label ? { label: state.data.label, target: 'detail' } : undefined),
          },
        },
      };

      expect(computeTrail(chrome, { at: 'detail', data: {} })).toEqual({
        breadcrumbs: [{ label: 'Root', target: 'root' }],
        contextMenu: [],
        target: 'root',
      });

      expect(computeTrail(chrome, { at: 'detail', data: { label: 'Item A' } })).toEqual({
        breadcrumbs: [{ label: 'Item A', target: 'detail' }],
        contextMenu: [],
        target: 'detail',
      });
    });

    it('preserves an existing separator on the first state item without duplicating or altering non-first items', () => {
      const alreadySeparated: ContextMenuItem = {
        label: 'Archive',
        event: { type: 'ARCHIVE' },
        separator: true,
      };
      const chrome: SurfaceChrome = {
        menu: [rootItem],
        states: {
          view: { menu: [alreadySeparated, pinItem] },
        },
      };

      expect(computeTrail(chrome, { at: 'view', data: {} }).contextMenu).toEqual([
        rootItem,
        alreadySeparated,
        pinItem,
      ]);
    });
  });

  describe('depth-2 nested state paths', () => {
    interface LibraryState extends SurfaceStateValue {
      readonly data: { readonly docName?: string };
    }

    const libraryChrome: SurfaceChrome<LibraryState> = {
      default: { label: 'Library', target: 'browser' },
      states: {
        library: {
          breadcrumb: (state) => ({ label: state.data.docName ?? 'Document', target: 'library' }),
        },
        inspect: {
          menu: [{ label: 'Refresh', event: { type: 'REFRESH' } }],
        },
      },
    };

    it('resolves top-level state chrome from a dotted path like library.detail', () => {
      const trail = computeTrail(libraryChrome, {
        at: 'library.detail',
        data: { docName: 'Architecture.md' },
      });

      expect(trail).toEqual({
        breadcrumbs: [
          { label: 'Library', target: 'browser' },
          { label: 'Architecture.md', target: 'library' },
        ],
        contextMenu: [],
        target: 'library',
      });
    });

    it('derives target from topLevelState when no breadcrumbs resolve', () => {
      const chromeWithoutDefault: SurfaceChrome = {
        states: {
          library: {
            menu: [{ label: 'Reload', event: { type: 'RELOAD' } }],
          },
        },
      };

      expect(computeTrail(chromeWithoutDefault, { at: 'library.detail', data: {} })).toEqual({
        breadcrumbs: [],
        contextMenu: [{ label: 'Reload', event: { type: 'RELOAD' } }],
        target: 'library',
      });
    });
  });

  describe('undefined chrome, undefined state, and defensive lookups', () => {
    const sampleChrome: SurfaceChrome = {
      default: { label: 'Home', target: 'home' },
      menu: [{ label: 'Action', event: { type: 'ACT' } }],
    };

    it('returns an empty ComputedTrail when both chrome and state are undefined', () => {
      expect(computeTrail(undefined, undefined)).toEqual({
        breadcrumbs: [],
        contextMenu: [],
        target: undefined,
      });
    });

    it('returns an empty ComputedTrail when state is undefined even if chrome is provided', () => {
      expect(computeTrail(sampleChrome, undefined)).toEqual({
        breadcrumbs: [],
        contextMenu: [],
        target: undefined,
      });
    });

    it('returns empty crumbs and menu when chrome is undefined, falling back target to topLevelState', () => {
      expect(computeTrail(undefined, { data: {} })).toEqual({
        breadcrumbs: [],
        contextMenu: [],
        target: undefined,
      });

      expect(computeTrail(undefined, { at: 'editor.preview', data: {} })).toEqual({
        breadcrumbs: [],
        contextMenu: [],
        target: 'editor',
      });
    });

    it('ignores inherited Object.prototype keys in chrome.states', () => {
      const chrome: SurfaceChrome = {
        states: {
          list: { breadcrumb: { label: 'List', target: 'list' } },
        },
      };

      expect(computeTrail(chrome, { at: 'toString', data: {} })).toEqual({
        breadcrumbs: [],
        contextMenu: [],
        target: 'toString',
      });
    });
  });
});
