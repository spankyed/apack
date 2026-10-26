// untypedOpenSurface asks the shell to open a surface (OPEN_SURFACE), since only the shell knows whether a pack's frontend
// that could provide it is still loading; the host's shell specs cover what it does with the request. What untypedOpenSurface
// refuses itself is a string that isn't a ref at all.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { untypedOpenSurface, openHelp } from '../../src/fe/navigation.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

let sent: unknown[];

beforeEach(() => {
  sent = [];
  const application = {
    getSnapshot: () => ({ context: {}, hasTag: () => false }),
    send: (event: unknown) => sent.push(event),
    system: { get: () => undefined },
    subscribe: () => ({ unsubscribe() {} }),
  };
  bindFeHost({ catalog: {} as never, application: application as never, secrets: {} as never,
    settings: {} as never, client: { send() {}, watchView: () => () => {} }, packs: {} as never });
});

afterEach(() => unbindFeHost());

describe('untypedOpenSurface', () => {
  it('asks the shell to open the surface at a ref', () => {
    untypedOpenSurface('memo-pack/memos');
    expect(sent).toEqual([{ type: 'OPEN_SURFACE', surface: 'memo-pack/memos', events: [] }]);
  });

  it('hands the shell the events for the surface, in order, one or several', () => {
    untypedOpenSurface('memo-pack/memos', { type: 'OPEN_MEMO', id: 'm1' });
    untypedOpenSurface('memo-pack/memos', [{ type: 'OPEN_MEMO', id: 'm1' }, { type: 'FOCUS' }]);
    expect(sent).toEqual([
      { type: 'OPEN_SURFACE', surface: 'memo-pack/memos', events: [{ type: 'OPEN_MEMO', id: 'm1' }] },
      { type: 'OPEN_SURFACE', surface: 'memo-pack/memos', events: [{ type: 'OPEN_MEMO', id: 'm1' }, { type: 'FOCUS' }] },
    ]);
  });

  it('refuses a name that is not a ref, rather than resolving it against some pack', () => {
    expect(() => untypedOpenSurface('memos')).toThrow(`"memos" doesn't name a surface`);
    expect(sent).toEqual([]);
  });
});


describe('openHelp', () => {
  it('opens Settings and delivers the requested Help target', () => {
    const target = { packId: 'memo-pack', featureId: 'memos' };
    openHelp(target);
    expect(sent).toEqual([{ type: 'OPEN_SURFACE', surface: 'host/settings', events: [{ type: 'HELP.OPEN', target }] }]);
  });

  it('opens the index by default and rejects ambiguous article or feature targets', () => {
    openHelp();
    expect(sent).toEqual([{ type: 'OPEN_SURFACE', surface: 'host/settings', events: [{ type: 'HELP.OPEN', target: {} }] }]);
    expect(() => openHelp({ articleId: 'start' })).toThrow(/packId/);
    expect(() => openHelp({ featureId: 'memos' })).toThrow(/packId/);
    expect(sent).toHaveLength(1);
  });
});
