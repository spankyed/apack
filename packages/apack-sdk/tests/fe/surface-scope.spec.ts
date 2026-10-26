// A surface's components reach their own surface through useSurface(): the host renders each surface area in a SurfaceScope,
// and a surface's component rendered elsewhere (its settings) gets one too. Nothing else hands out surface actors.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { AnyActorRef } from 'xstate';
import { SurfaceScope, useSurface } from '../../src/fe/actor-system.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

const memos = { id: 'memos-actor' } as unknown as AnyActorRef;
const notes = { id: 'notes-actor' } as unknown as AnyActorRef;

beforeEach(() => {
  const running: Record<string, AnyActorRef> = { 'memo-pack/memos': memos, 'default-setup/notes': notes };
  bindFeHost({ catalog: {} as never,
    application: { system: { get: (ref: string) => running[ref] }, subscribe: () => ({ unsubscribe() {} }) } as never,
    secrets: {} as never,
    settings: {} as never,
    client: { send() {}, watchView: () => () => {} },
    packs: {} as never,
  });
});

afterEach(() => unbindFeHost());

/** A component that renders the id of the surface actor useSurface() gave it */
const ShowsSurface = defineComponent({ setup: () => () => (useSurface<{ id: string }>()).id });

const render = (root: () => ReturnType<typeof h>) => renderToString(createSSRApp(defineComponent({ setup: () => root })));

describe('useSurface', () => {
  it('returns the surface the nearest SurfaceScope names', async () => {
    const html = await render(() => h('div', [
      h(SurfaceScope, { surface: 'memo-pack/memos' }, () => h(ShowsSurface)),
      h(SurfaceScope, { surface: 'memo-pack/memos' }, () => h(SurfaceScope, { surface: 'default-setup/notes' }, () => h(ShowsSurface))),
    ]));
    // Less the SSR fragment markers
    expect(html.replace(/<!--.*?-->/g, '')).toBe('<div>memos-actornotes-actor</div>');
  });

  it('throws outside any surface', async () => {
    await expect(render(() => h(ShowsSurface))).rejects.toThrow('useSurface() runs in a component a surface renders');
  });
});

describe('SurfaceScope', () => {
  it('refuses a surface that is not running, and a name that is not a ref', async () => {
    await expect(render(() => h(SurfaceScope, { surface: 'memo-pack/memoz' }, () => h(ShowsSurface)))).rejects.toThrow('No surface is running at "memo-pack/memoz"');
    await expect(render(() => h(SurfaceScope, { surface: 'memos' }, () => h(ShowsSurface)))).rejects.toThrow(`"memos" doesn't name a surface`);
  });
});
