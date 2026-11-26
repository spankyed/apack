// Two defects in the code surface's tab bookkeeping (T3 and T9 in the terminal integration review).
//
// A restore has no completion signal, so it has a 2,500 ms deadline. The deadline is the give-up — a restore
// that completes settles itself as each tab lands — but settling also *persisted* the list it had just
// pruned, which turned a slow restore into a permanent one: the backend spawns restored shells one at a
// time, so a terminal that had not come back in time was dropped from storage as well as from the surface,
// and the next launch had nothing left to ask for.
//
// And moving a terminal from a tab into the panel removed the tab without pruning the group it emptied,
// where every other removal in this machine prunes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenFile } from '#features/code/fe/contract.ts';
import { startMachine } from './_support/asks.ts';

vi.mock('#features/code/fe/utils/terminal-pool.ts', async (importOriginal) => ({
  // The real `viewSettingsOf` is the mapping under test; only the pool is replaced
  ...(await importOriginal<typeof import('#features/code/fe/utils/terminal-pool.ts')>()),
  terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn(), disposeAll: vi.fn(), setCopyOnSelect: vi.fn(), setViewSettings: vi.fn() },
}));
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}));

const codeState = (await import('#features/code/fe/state.ts')).default;
const { terminalPool } = await import('#features/code/fe/utils/terminal-pool.ts');

const TABS_KEY = 'default-setup/code:open-tabs';
const GROUPS_KEY = 'default-setup/code:tab-groups';

/** Every surface a case started, stopped when it ends: a running surface holds listeners on the window */
const running: Array<{ stop(): void }> = [];
const started = () => {
  const h = startMachine(codeState, { id: 'default-setup/code' });
  running.push(h);
  return h;
};
/** Starts the surface as the shell does, and answers what it asks the code system for with `start` */
const startOver = async (h: ReturnType<typeof started>, start: { baseDirectory: string; settings?: object }) => {
  h.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
  await h.latestAsk('GET_CODE_START').answer(start);
  expect(h.read().data.baseDirectory).toBe(start.baseDirectory);
};
const dataOf = (h: ReturnType<typeof started>) => h.read().data;
const storedTabs = (): { tabs: Array<{ path: string }> } => JSON.parse(localStorage.getItem(TABS_KEY) ?? '{"tabs":[]}');

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
  // Stopping a surface disposes its pool, which is one case's subject and no other's
  vi.mocked(terminalPool.disposeAll).mockClear();
});

describe('settling a restore that did not finish', () => {
  /** A previous session: one file and one terminal, the terminal pinned and in a group */
  const seedTwoTabs = () => {
    localStorage.setItem(TABS_KEY, JSON.stringify({
      tabs: [
        { path: '/src/a.ts', type: 'file', order: 0 },
        { path: 'terminal:t-1', type: 'terminal', terminalId: 't-1', order: 1, isPinned: true, groupId: 'g-1' },
      ],
      activeFilePath: '/src/a.ts',
    }));
    localStorage.setItem(GROUPS_KEY, JSON.stringify([{ id: 'g-1', name: 'shells', color: 'blue', isCollapsed: false, order: 0 }]));
  };

  it('leaves storage alone, so what has not arrived is still there next launch', () => {
    seedTwoTabs();
    const h = started();
    // Nothing has arrived: no child answered inside the window
    expect(dataOf(h).openFiles).toEqual([]);

    h.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' });

    expect(storedTabs().tabs.map((tab) => tab.path), 'persisting the pruned list is what made the loss permanent')
      .toEqual(['/src/a.ts', 'terminal:t-1']);
  });

  it('keeps the metadata of a tab that has not arrived, so a late one still has its pin and group', () => {
    seedTwoTabs();
    const h = started();

    h.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' });

    const metadata = dataOf(h).pendingPersistedMetadata;
    expect([...(metadata ?? [])].map(([path]) => path)).toEqual(['/src/a.ts', 'terminal:t-1']);
    expect(metadata?.get('terminal:t-1')).toMatchObject({ isPinned: true, groupId: 'g-1' });
  });

  it('keeps the group a tab that has not arrived belongs to', () => {
    seedTwoTabs();
    const h = started();

    h.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' });

    expect(dataOf(h).tabGroups.map((group) => group.id)).toEqual(['g-1']);
  });

  it('persists nothing while the restore is still arriving, so a partial list is never written', () => {
    seedTwoTabs();
    const h = started();

    // One of the two arrives; the other is still expected, so the batch is in flight
    h.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } as OpenFile });

    expect(storedTabs().tabs.map((tab) => tab.path), 'a save mid-restore wrote the list it had so far')
      .toEqual(['/src/a.ts', 'terminal:t-1']);
  });

  it('keeps what has not arrived when a close forces a save mid-restore', () => {
    seedTwoTabs();
    const h = started();

    // One of the two arrives; the terminal is still expected, so the batch is in flight
    h.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } as OpenFile });
    h.send({ type: 'CLOSE_TAB', path: '/src/a.ts' });

    expect(storedTabs().tabs.map((tab) => tab.path), 'the close wrote a list without the tab still arriving')
      .toEqual(['terminal:t-1']);
  });

  it('keeps a still-expected tab s group when another tab arrives after the settle', () => {
    seedTwoTabs();
    const h = started();
    h.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' });

    // `/src/a.ts` arrives late; `terminal:t-1` is still expected, and `g-1` is its group
    h.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } as OpenFile });

    expect(dataOf(h).tabGroups.map((group) => group.id), 'the group of a tab still coming was pruned')
      .toEqual(['g-1']);
  });

  it('leaves a still-expected tab s group in storage when another tab arrives after the settle', () => {
    seedTwoTabs();
    const h = started();
    h.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' });

    h.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } as OpenFile });

    const stored = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]') as Array<{ id: string }>;
    expect(stored.map((group) => group.id), 'storage lost the group, so the next launch has nothing to restore it from')
      .toEqual(['g-1']);
  });

  it('stops waiting, so a restore settles exactly once', () => {
    seedTwoTabs();
    const h = started();

    h.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' });

    expect(dataOf(h).pendingTabOrder).toBeUndefined();
    expect(dataOf(h).pendingTerminalTabIds).toBeUndefined();
  });
});

describe('moving a terminal from a tab into the panel', () => {
  it('prunes the group it emptied', () => {
    const h = started();
    h.send({ type: 'ADD_TAB', tab: { path: 'terminal:t-1', isTerminal: true, terminalInfo: { id: 't-1', title: 't-1', cwd: '/tmp' } } as never });
    h.send({ type: 'CREATE_GROUP', name: 'shells', tabPaths: ['terminal:t-1'] });
    expect(dataOf(h).tabGroups).toHaveLength(1);

    h.send({ type: 'MOVE_TERMINAL_TO_PANEL', path: 'terminal:t-1' });

    expect(dataOf(h).openFiles).toEqual([]);
    expect(dataOf(h).tabGroups, 'a group with no tabs still renders in the tab bar').toEqual([]);
  });
});

describe('which window keeps the layout', () => {
  const aWindowWithATab = (ownsAppLayout?: boolean) => {
    localStorage.setItem(TABS_KEY, JSON.stringify({
      tabs: [{ path: '/src/a.ts', type: 'file', order: 0 }], activeFilePath: '/src/a.ts',
    }));
    const h = started();
    if (ownsAppLayout !== undefined) h.send({ type: 'SURFACE_STARTED', ownsAppLayout });
    // The restore gives up, which is what makes this machine one that saves from here on
    h.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' });
    h.send({ type: 'ADD_TAB', tab: { path: '/src/b.ts', content: '', originalContent: '', modified: false } as OpenFile });
    return h;
  };

  it('writes nothing when the shell says another window keeps it', () => {
    aWindowWithATab(false);

    expect(storedTabs().tabs.map((tab) => tab.path), "the popout rewrote the main window's tabs")
      .toEqual(['/src/a.ts']);
  });

  it('writes when the shell says this window keeps it', () => {
    aWindowWithATab(true);

    expect(storedTabs().tabs.map((tab) => tab.path)).toContain('/src/b.ts');
  });

  it('writes when nothing has said otherwise, since a window that was never told is the only one', () => {
    aWindowWithATab();

    expect(storedTabs().tabs.map((tab) => tab.path)).toContain('/src/b.ts');
  });
});

describe('the terminal pool the code surface holds', () => {
  it('is left alone while the surface is running', () => {
    const h = started();
    h.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } as OpenFile });

    expect(terminalPool.disposeAll, 'a running surface disposed the emulators it is drawing with')
      .not.toHaveBeenCalled();
  });

  it('is disposed when the surface stops, which is when the shell replaces this frontend', () => {
    const h = started();

    h.stop();

    expect(terminalPool.disposeAll, 'the stopped surface left its emulators in the window')
      .toHaveBeenCalledTimes(1);
  });
});

describe('an open diff read again', () => {
  const unstaged = (modifiedContent: string, originalContent = 'in the index\n') =>
    ({ path: 'a.ts', staged: false, originalContent, modifiedContent });
  const theTab = (h: ReturnType<typeof started>) => dataOf(h).openFiles.find((file) => file.path === 'diff:a.ts:unstaged') as OpenFile;
  const opened = async () => {
    const { diffTab } = await import('#features/code/fe/utils/diff-tabs.ts');
    const h = started();
    h.send({ type: 'ADD_TAB', tab: diffTab(unstaged('first edit\n')) });
    return h;
  };

  it('shows the file as it is now, where the tab is', async () => {
    const h = await opened();
    // Kept, so that the next tab opens beside it and not in its place
    h.send({ type: 'PROMOTE_PREVIEW_TAB', path: 'diff:a.ts:unstaged' });
    h.send({ type: 'ADD_TAB', tab: { path: '/src/other.ts', content: '', originalContent: '', modified: false } });

    h.send({ type: 'REFRESH_DIFF_TAB', diff: unstaged('second edit\n', 'staged since\n') });

    expect(theTab(h)).toMatchObject({ content: 'second edit\n', originalContent: 'second edit\n', modified: false });
    expect(theTab(h).gitDiff?.originalContent).toBe('staged since\n');
    expect(dataOf(h).activeFilePath, 'and the tab being looked at stays the one in front').toBe('/src/other.ts');
  });

  it('keeps what was typed into it, and says the file changed under that', async () => {
    const h = await opened();
    const typed = dataOf(h).openFiles.map((file) => file.path === 'diff:a.ts:unstaged' ? { ...file, content: 'typed, not saved\n', modified: true } : file);
    h.send({ type: 'UPDATE_STATE', updates: { openFiles: typed as OpenFile[] } });

    h.send({ type: 'REFRESH_DIFF_TAB', diff: unstaged('first edit\n', 'staged since\n') });
    expect(theTab(h), 'only the index moved: nothing to settle').toMatchObject({ content: 'typed, not saved\n', modified: true });
    expect(theTab(h).pendingSaveConflict).toBeFalsy();
    expect(theTab(h).gitDiff?.originalContent).toBe('staged since\n');

    h.send({ type: 'REFRESH_DIFF_TAB', diff: unstaged('edited by something else\n') });
    expect(theTab(h)).toMatchObject({ content: 'typed, not saved\n', modified: true, externallyModified: true, pendingSaveConflict: true });
  });

  it('opens no tab for a diff whose tab was closed since', async () => {
    const h = await opened();
    h.send({ type: 'CLOSE_TAB', path: 'diff:a.ts:unstaged' });

    h.send({ type: 'REFRESH_DIFF_TAB', diff: unstaged('second edit\n') });

    expect(dataOf(h).openFiles.map((file) => file.path)).toEqual([]);
  });
});

describe("the feature's settings reaching the terminals", () => {
  it('gives the saved copy-on-selection setting to the terminal pool when the surface starts, not only when it next changes', async () => {
    const h = started();
    vi.mocked(terminalPool.setCopyOnSelect).mockClear();

    await startOver(h, { baseDirectory: '/work', settings: { copyOnSelect: true } });
    expect(terminalPool.setCopyOnSelect, 'the saved value reaches the terminals at start').toHaveBeenLastCalledWith(true);
  });

  it('gives the copy-on-selection setting to the terminal pool as it changes, and off when it is not set', () => {
    const h = started();
    vi.mocked(terminalPool.setCopyOnSelect).mockClear();

    h.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: { copyOnSelect: true } as never });
    expect(terminalPool.setCopyOnSelect).toHaveBeenLastCalledWith(true);

    h.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: { copyOnSelect: false } as never });
    expect(terminalPool.setCopyOnSelect).toHaveBeenLastCalledWith(false);

    h.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: {} as never });
    expect(terminalPool.setCopyOnSelect, 'a setting that is not there is off, not left as it was').toHaveBeenLastCalledWith(false);
  });

  it('gives the cursor and link settings to the terminal pool at start and as they change, with their defaults when unset', async () => {
    const h = started();
    vi.mocked(terminalPool.setViewSettings).mockClear();

    await startOver(h, { baseDirectory: '/work', settings: { cursorInactiveStyle: 'underline', linkPreview: 'all' } });
    expect(terminalPool.setViewSettings).toHaveBeenLastCalledWith({ cursorInactive: 'underline', linkPreview: 'all' });

    // The blink is not a view's setting: one changed leaves the view's as they were, at their defaults here
    h.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: { cursorBlink: 'off' } as never });
    expect(terminalPool.setViewSettings).toHaveBeenLastCalledWith({ cursorInactive: 'hollow', linkPreview: 'osc8' });
  });
});

describe('starting over a folder', () => {
  it("has each panel ask about the folder the start names, which is the surface's by the time they ask", async () => {
    const h = started();
    h.reset();

    await startOver(h, { baseDirectory: '/work' });

    const asked = h.made.map((a) => a.event.type);
    expect(asked, 'the pull request panel asks whether GitHub answers for it').toContain('pr.CHECK_GITHUB_ACCESS');
    expect(asked, 'the commit panel asks for the repositories under it').toContain('commit.LIST_REPOSITORIES');
  });
});

describe('asking for what the surface starts from', () => {
  it('hears the ask made last: one still under way when the directory moves is stopped, and its answer changes nothing', async () => {
    const h = started();
    h.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    const first = h.latestAsk('GET_CODE_START');

    h.send({ type: 'BASE_DIRECTORY_CHANGED', baseDirectory: '/second' });
    const second = h.latestAsk('GET_CODE_START');
    expect(first.stopped).toBe(true);

    await second.answer({ baseDirectory: '/second' });
    await first.answer({ baseDirectory: '/first' });

    expect(dataOf(h).baseDirectory, 'the stopped ask is not heard after it').toBe('/second');
  });
});
