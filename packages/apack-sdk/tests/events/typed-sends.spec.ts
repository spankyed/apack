// Compile-time checks of the typed sends, run by `tsc --noEmit`: the sends sit in functions that never run.
import { describe, expectTypeOf, it } from 'vitest';
import type { TypedSendToSurface, TypedTell, TypedSendToWindow } from '../../src/events/index.ts';
import type { FeatureRef } from '../../src/ids/index.ts';

type Systems = {
  memos:
    | { type: 'ADD_MEMO'; text: string }
    | { type: 'CLEAR_MEMOS' }
    | { type: 'PIN_MEMO' | 'UNPIN_MEMO'; id: string }
    | { type: `memo.${string}`; payload: number }
    | { type: 'TAG_MEMO'; tag: string; [field: string]: unknown };
  tags: { type: 'ADD_TAG'; name: string };
};

type Surfaces = {
  memos: { type: 'MEMO_ADDED'; text: string } | { type: 'MEMOS_CLEARED' };
  tags: { type: 'TAG_ADDED'; name: string };
};

declare const tell: TypedTell<Systems>;
declare const sendToSurface: TypedSendToSurface<Surfaces>;
declare const sendToWindow: TypedSendToWindow<Surfaces>;

describe('tell', () => {
  it('checks the event its type names', () => {
    expectTypeOf(() => {
      tell('memos', { type: 'ADD_MEMO', text: 'x' });
      tell('memos', { type: 'CLEAR_MEMOS' });
      tell('tags', { type: 'ADD_TAG', name: 'x' });
      // A role names whichever system plays it, which the build can't know, so its event isn't checked
      tell({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'x' });
      // @ts-expect-error ADD_MEMO needs its text
      tell('memos', { type: 'ADD_MEMO' });
      // @ts-expect-error the memos system doesn't receive ADD_TAG
      tell('memos', { type: 'ADD_TAG', name: 'x' });
      // @ts-expect-error not a system of the map
      tell('nope', { type: 'CLEAR_MEMOS' });
    }).toBeFunction();
  });

  it('sends a member whose type is a union or a template literal with one literal', () => {
    expectTypeOf(() => {
      tell('memos', { type: 'UNPIN_MEMO', id: 'm1' });
      tell('memos', { type: 'memo.archived', payload: 1 });
      // @ts-expect-error PIN_MEMO needs its id
      tell('memos', { type: 'PIN_MEMO' });
      // @ts-expect-error a memo.* event needs its payload
      tell('memos', { type: 'memo.archived' });
    }).toBeFunction();
  });

  it('keeps named fields beside an index signature', () => {
    expectTypeOf(() => {
      tell('memos', { type: 'TAG_MEMO', tag: 'x', extra: true });
      // @ts-expect-error TAG_MEMO needs its tag
      tell('memos', { type: 'TAG_MEMO' });
    }).toBeFunction();
  });

  it('rejects a union event type or a union system id', () => {
    expectTypeOf((type: 'ADD_MEMO' | 'CLEAR_MEMOS', systemId: 'memos' | 'tags') => {
      // @ts-expect-error one event type per send
      tell('memos', { type, text: 'x' });
      // @ts-expect-error one system per send
      tell(systemId, { type: 'ADD_TAG', name: 'x' });
    }).toBeFunction();
  });
});

describe('sendToSurface', () => {
  it("check the surface's events", () => {
    expectTypeOf(() => {
      sendToSurface('memos', { type: 'MEMO_ADDED', text: 'x' });
      // @ts-expect-error the memos surface doesn't receive TAG_ADDED
      sendToSurface('memos', { type: 'TAG_ADDED', name: 'x' });
      // @ts-expect-error MEMO_ADDED needs its text
      sendToSurface('memos', { type: 'MEMO_ADDED' });
    }).toBeFunction();
  });

  it('reject a union surface id', () => {
    expectTypeOf((surfaceId: 'memos' | 'tags') => {
      // @ts-expect-error one surface per send
      sendToSurface(surfaceId, { type: 'TAG_ADDED', name: 'x' });
    }).toBeFunction();
  });
});

/**
 * The addressed send, which is `sendToSurface`'s checking with the connection in front.
 *
 * **This is the only thing exercising the declared shape.** `defineEvents` casts its implementation to
 * `TypedEvents`, and no pack calls the typed `sendToWindow` yet, so without these the declaration could
 * drift from the function and nothing would say. They do not *bind* the two — only dropping the cast
 * would — but they keep the half a reader relies on honest.
 */
describe('sendToWindow', () => {
  it("checks the surface's events, with the connection first", () => {
    expectTypeOf(() => {
      sendToWindow('c-main', 'memos', { type: 'MEMO_ADDED', text: 'x' });
      // @ts-expect-error the memos surface doesn't receive TAG_ADDED
      sendToWindow('c-main', 'memos', { type: 'TAG_ADDED', name: 'x' });
      // @ts-expect-error MEMO_ADDED needs its text
      sendToWindow('c-main', 'memos', { type: 'MEMO_ADDED' });
      // @ts-expect-error the connection is not optional: a handler holding one must narrow it first
      sendToWindow(undefined, 'memos', { type: 'MEMO_ADDED', text: 'x' });
      // @ts-expect-error and it is not the thing you can leave out
      sendToWindow('memos', { type: 'MEMO_ADDED', text: 'x' });
    }).toBeFunction();
  });

  it('rejects a union surface id, as the broadcast does', () => {
    expectTypeOf((surfaceId: 'memos' | 'tags') => {
      // @ts-expect-error one surface per send
      sendToWindow('c-main', surfaceId, { type: 'TAG_ADDED', name: 'x' });
    }).toBeFunction();
  });
});

// A feature this pack's maps don't name (another pack's, found at run time) still takes what every system and
// surface takes, by its ref: default-setup's settings system tells any feature its settings changed
describe('a feature named by its ref', () => {
  it('takes the events every system and surface takes, and no other', () => {
    const feature = 'other-pack/board' as FeatureRef;
    expectTypeOf(() => {
      tell(feature, { type: 'FEATURE_SETTINGS_UPDATED', settings: {}, changes: null });
      tell(feature, { type: 'PACK_CHANGED', packId: 'other-pack' });
      sendToSurface(feature, { type: 'FEATURE_SETTINGS_UPDATED', settings: {} });
      sendToWindow('c-main', feature, { type: 'FEATURE_SETTINGS_UPDATED', settings: {} });
      // @ts-expect-error only the app-wide events: nothing declares what else that system takes
      tell(feature, { type: 'ADD_MEMO', text: 'x' });
      // @ts-expect-error a surface takes only the settings update from outside its pack's maps
      sendToSurface(feature, { type: 'MEMO_ADDED', text: 'x' });
    }).toBeFunction();
  });
});
