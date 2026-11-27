// The welcome overlay a pack contributes, which this window has to draw on the one boot it is meant for.
//
// `App.vue` mounts before any pack's frontend has loaded — `main.ts` registers none, the shell loads every one,
// the app's own included, once the bus says which packs are running — and the overlay is shown while the shell
// has the `welcome` tag, which is that same window. So reading the slot once at setup was always `undefined`,
// and a pack contributing a welcome screen had nothing drawn for it.
//
// Mocked here: `@/main`, which is the window's boot, and the three sibling views, none of which this case is
// about. The registry is the real one (`@/runtime/packs`), and the pack registers through it as the loader does.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, type App as VueApp } from 'vue';
import { state, system } from '@apackdev/state';
import { HOST, provideHostState } from '@apackdev/host/fe';
import { fePacks } from '@/runtime/packs';
import App from '@/views/App.vue';

vi.mock('@/views/WebApp.vue', () => ({ default: defineComponent({ render: () => h('div', { class: 'web-app' }) }) }));
vi.mock('@/views/SurfacePopoutApp.vue', () => ({ default: defineComponent({ render: () => h('div', { class: 'popout' }) }) }));
vi.mock('@/views/settings/SettingsRecovery.vue', () => ({ default: defineComponent({ render: () => h('div', { class: 'recovery' }) }) }));
// A real ref, not a plain object: `App.vue` branches on `v-if="recovery"`, and a plain `{ value: undefined }`
// is truthy there, so the window would render the recovery view and none of what this case is about
vi.mock('@/runtime/settings', async () => {
  const { shallowRef } = await import('vue');
  return { useSettingsRecovery: () => shallowRef(undefined) };
});

const Welcome = defineComponent({ render: () => h('div', { class: 'pack-welcome' }, 'Hello') });

const stubShellState = state<{
  states: { onboarding: { states: { letter: Record<string, never> } } };
}, never>()({
  initial: 'onboarding',
  states: {
    onboarding: {
      initial: 'letter',
      states: { letter: {} },
    },
  },
});

/** A pack's frontend loading, as the loader does it: the declared slot, and the component bound to it */
function registerWelcomePack(): void {
  fePacks.registerPackFE(
    {
      kind: 'native',
      declaration: { id: 'welcome-pack', appExtensions: { welcome: 'src/Welcome.vue' } },
    },
    { id: 'welcome-pack', appExtensions: { welcome: Welcome } },
  );
}

let app: VueApp | undefined;
let stateSys: ReturnType<typeof system> | undefined;

function render(): HTMLElement {
  const el = document.createElement('div');
  stateSys = system({ side: 'window' });
  stateSys.start(HOST.application, stubShellState);
  app = createApp(App);
  provideHostState(app, stateSys);
  app.mount(el);
  return el;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  app?.unmount();
  app = undefined;
  stateSys?.stop();
  stateSys = undefined;
  if (fePacks.getAppExtension('welcome')) fePacks.unregisterPackFE('welcome-pack');
});

describe('the welcome overlay a pack contributes', () => {
  it("is drawn once the pack's frontend registers, having mounted before it", async () => {
    const mounted = render();
    expect(mounted.querySelector('.pack-welcome')).toBeNull();

    registerWelcomePack();
    await settle();

    expect(mounted.querySelector('.pack-welcome')).not.toBeNull();
  });

  it('goes again when the pack unregisters', async () => {
    registerWelcomePack();
    const mounted = render();
    expect(mounted.querySelector('.pack-welcome')).not.toBeNull();

    fePacks.unregisterPackFE('welcome-pack');
    await settle();

    expect(mounted.querySelector('.pack-welcome')).toBeNull();
  });
});
