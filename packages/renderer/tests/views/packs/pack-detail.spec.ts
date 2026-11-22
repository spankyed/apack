import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick, reactive, type App } from 'vue';
import type { AppPackSourceSummary, InstalledPackSummary } from '@apackdev/host/fe';
import PackDetail from '@/views/packs/PackDetail.vue';

/** An installed external pack with nothing declared, and `overrides` */
const pack = (overrides: Partial<InstalledPackSummary> = {}): InstalledPackSummary => ({
  id: 'memo-pack', name: 'Memos', version: '1.0.0', updatesWith: 'user', enabled: true,
  entities: {}, relKinds: {}, roles: {}, features: [], services: [], steps: [], artifacts: [], blocks: [], systems: [],
  entityCount: 0, hasFrontend: false, permissions: [], lifecycleHooks: [], migrationCount: 0, contentOffers: [], contentKept: [], dependencyProblems: [],
  ...overrides,
});

let app: App | undefined;
function render(props: { pack: InstalledPackSummary; appSource?: AppPackSourceSummary; confirmingUninstall?: boolean; onRestore?: (revision: string) => void; onReplace?: (source: string) => void; onAppUpdate?: (revision: string) => void }): HTMLElement {
  app?.unmount();
  const el = document.createElement('div');
  app = createApp(PackDetail, props);
  app.mount(el);
  return el;
}
afterEach(() => app?.unmount());

// A pack the app skipped at load (a build in another format, a runtime that threw) is installed and enabled, but
// runs nothing: its status says so, with the loader's reason, rather than "Enabled"
describe('an installed pack in the Packs view', () => {
  it('shows declared feature purpose without a runtime system or surface', () => {
    const el = render({ pack: pack({ enabled: false, features: [{
      id: 'memos', description: 'Write memos and schedule reminders.', hasSystem: false, services: [],
    }] }) });
    expect(el.textContent).toContain('Write memos and schedule reminders.');
  });
  it("shows why it didn't load, in place of its status", () => {
    const el = render({ pack: pack({ loadProblem: 'its snapshot is format 2, written by a newer apack CLI; update apack to use it' }) });

    expect(el.querySelector('[data-testid="pack-load-problem"]')?.textContent?.trim())
      .toBe('Failed to load: its snapshot is format 2, written by a newer apack CLI; update apack to use it');
    expect(el.textContent).not.toContain('Enabled');
  });

  it('identifies a named dependency the profile cannot supply', () => {
    const message = 'Requires starter-a (^1.0.0). Install the named pack.';
    const el = render({ pack: pack({ dependencyProblems: [message] }) });
    expect(el.querySelector('[aria-label="Pack dependencies"]')?.textContent?.trim()).toBe(message);
  });

  it('shows its status when it loaded', () => {
    const el = render({ pack: pack() });

    expect(el.querySelector('[data-testid="pack-load-problem"]')).toBeNull();
    expect(el.textContent).toContain('Enabled');
  });
});

describe('unavailable pack declarations', () => {
  it('shows the refusal without inventing a version', () => {
    const el = render({ pack: pack({ version: undefined, loadProblem: 'its declarations were refused: invalid snapshot' }) });
    expect(el.textContent).toContain('Pack metadata is unavailable');
    expect(el.querySelector('[data-testid="pack-load-problem"]')?.textContent).toContain('invalid snapshot');
    expect(el.textContent).not.toContain('vundefined');
  });
});

/**
 * **The two kinds of decision a pack's content can leave the user, and the buttons each one gets.** The
 * view decides nothing — it emits the content key and the system writes — so what is worth holding here is
 * that an item whose newer version is waiting can be taken and an item the pack dropped cannot: there is
 * no version to take, only the choice between keeping it and deleting it.
 */
describe('the decisions a pack’s content leaves the user', () => {
  const offers = {
    contentOffers: [
      { key: 'memo-pack:actions/a', label: 'actions / Action "Echo"', kind: 'update' as const, parts: ['actionFn'], contentHash: 'echo-v2' },
      { key: 'memo-pack:actions/b', label: 'actions / Action "Gone"', kind: 'removed' as const, parts: ['inputs'] },
    ],
  };

  it('offers the newer version of an item the user changed, naming the parts they changed', () => {
    const el = render({ pack: pack(offers) });
    const [update] = [...el.querySelectorAll('[data-testid="pack-content-offer"]')];

    expect(update!.textContent).toContain('actions / Action "Echo"');
    expect(update!.textContent, 'the pack and the version it would write').toContain('Memos v1.0.0');
    expect(update!.querySelector('[data-testid="offer-take"]')).toBeTruthy();
    expect(update!.querySelector('[data-testid="offer-keep"]')).toBeTruthy();
    expect(update!.querySelector('[data-testid="offer-delete"]'), 'nothing was removed, so there is nothing to delete').toBeNull();
  });

  it('offers to keep or delete an item the pack no longer ships, and no version to take', () => {
    const el = render({ pack: pack(offers) });
    const removed = [...el.querySelectorAll('[data-testid="pack-content-offer"]')][1];

    expect(removed!.textContent).toContain('no longer ships it');
    expect(removed!.querySelector('[data-testid="offer-take"]'), 'there is no newer version to take').toBeNull();
    expect(removed!.querySelector('[data-testid="offer-keep"]')).toBeTruthy();
    expect(removed!.querySelector('[data-testid="offer-delete"]')).toBeTruthy();
  });

  it('offers to reset an item the user kept their own version of, and nothing when there are none', () => {
    const kept = render({ pack: pack({ contentKept: [{ key: 'memo-pack:actions/a', label: 'actions / Action "Echo"' }] }) });
    expect(kept.querySelector('[data-testid="kept-reset"]')).toBeTruthy();

    const none = render({ pack: pack() });
    expect(none.querySelector('[data-testid="pack-content-offers"]')).toBeNull();
    expect(none.querySelector('[data-testid="pack-content-kept"]')).toBeNull();
  });
});


describe('app-default controls', () => {
  it('offers disable, remove and explicit replacement for app-managed installations', async () => {
    const replacements: string[] = [];
    const el = render({ pack: pack({ updatesWith: 'app' }), onReplace: source => replacements.push(source) });
    expect(el.textContent).toContain('App-managed');
    expect(el.querySelector('button[title="Disable"]')).toBeTruthy();
    expect([...el.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Remove')).toBe(true);
    const input = el.querySelector('[data-testid="pack-replacement"] input') as HTMLInputElement;
    input.value = '/fork';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    (el.querySelector('[data-testid="pack-replace"]') as HTMLButtonElement).click();
    expect(replacements).toEqual(['/fork']);
  });

  it('confirms restoration and sends the revision the user selected, even if the offer changes', async () => {
    const restores: string[] = [];
    const source = reactive({ id: 'memo-pack', name: 'App memos', version: '1.0.0', sourceRevision: 'a'.repeat(64) });
    const el = render({ pack: pack(), appSource: source, onRestore: revision => restores.push(revision) });
    (el.querySelector('[data-testid="pack-restore"]') as HTMLButtonElement).click();
    await nextTick();
    expect(restores).toEqual([]);
    expect(el.querySelector('[data-testid="pack-restore-confirmation"]')).toBeTruthy();
    source.sourceRevision = 'b'.repeat(64);
    await nextTick();
    (el.querySelector('[data-testid="pack-confirm-restore"]') as HTMLButtonElement).click();
    expect(restores).toEqual(['a'.repeat(64)]);
  });

  it('shows removal confirmation in the selected detail pane', () => {
    const el = render({ pack: pack({ updatesWith: 'app' }), confirmingUninstall: true });
    expect(el.querySelector('[data-testid="pack-remove-confirmation"]')?.textContent).toContain('Pack files will be deleted');
  });
});


it('offers app updates separately from restoration and forwards the selected revision', () => {
  const updates: string[] = [];
  const source = { id: 'memo-pack', name: 'Memos', version: '1.0.0', sourceRevision: 'a'.repeat(64) };
  const el = render({ pack: pack({ updatesWith: 'app', enabled: false, appUpdate: source }),
    onAppUpdate: revision => updates.push(revision) });
  expect(el.querySelector('[data-testid="pack-app-update"]')?.textContent).toContain('Update from app v1.0.0');
  (el.querySelector('[data-testid="pack-app-update"]') as HTMLButtonElement).click();
  expect(updates).toEqual([source.sourceRevision]);
});

it('shows an unavailable app source without hiding installed-pack controls', () => {
  const el = render({ pack: pack({ updatesWith: 'app', appSourceProblem: 'Duplicate app source' }) });
  expect(el.querySelector('[data-testid="pack-app-source-problem"]')?.textContent).toContain('Duplicate app source');
  expect(el.querySelector('button[title="Disable"]')).toBeTruthy();
});
