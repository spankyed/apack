import { describe, expect, it } from 'vitest';
import { system, type State } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { isState } from '@apackdev/sdk/framework';
import actionsSystem from '#features/actions/be/system.ts';
import promptsSystem from '#features/prompts/be/system.ts';
import browserSystem from '#features/browser/be/system.ts';
import flowsSystem from '#features/flows/be/system.ts';
import notesSystem from '#features/notes/be/system.ts';
import librarySystem from '#features/library/be/system.ts';
import logsSystem from '#features/logs/be/system.ts';

const WAVE1_SYSTEMS = [
  ['default-setup/actions', actionsSystem],
  ['default-setup/prompts', promptsSystem],
  ['default-setup/browser', browserSystem],
  ['default-setup/flows', flowsSystem],
  ['default-setup/notes', notesSystem],
  ['default-setup/library', librarySystem],
  ['default-setup/logs', logsSystem],
] as const;

describe('Wave 1 @apackdev/state backend systems', () => {
  it.each(WAVE1_SYSTEMS)('%s starts and disposes cleanly with zero defects', (ref, def) => {
    expect(isState(def)).toBe(true);
    using guard = defectGuard();
    using sys = system({ side: 'backend', onDefect: guard.onDefect });
    sys.attach({
      tell: () => {},
      ask: (_to, _name, _args, _progress, done) => {
        done({ ok: false, failure: { kind: 'unavailable', message: 'unused' } });
        return () => {};
      },
      follow: (_feature, _view, _args, _updated, failed) => {
        failed({ kind: 'unavailable', message: 'unused' });
        return { stop: () => {} };
      },
    });
    const handle = sys.start(ref, def as State<any, any, any, never>);
    expect(sys.read(handle)).toBeDefined();
    guard.assertNone();
  });
});
