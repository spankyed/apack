// Terminal restore-gate abort safety: if terminalSystem stops (or an ask is cancelled)
// while RestoreGate is still pending, CREATE_TERMINAL and other gated asks abort immediately
// after await without spawning an orphaned PTY.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { system } from '@apackdev/state';
import { terminalSystem } from '#features/code/be/features/terminal.ts';
import { terminalService } from '#features/code/be/services/terminal.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('terminalSystem restore gate abort safety', () => {
  it('aborts CREATE_TERMINAL without calling terminalService.create when stopped during restore', async () => {
    let releaseRestore!: () => void;
    const restoreGate = new Promise<void>((resolve) => { releaseRestore = resolve; });

    vi.spyOn(terminalService, 'restoreAll').mockImplementation(() => restoreGate);
    vi.spyOn(terminalService, 'endUnclaimedKept').mockResolvedValue();
    const createSpy = vi.spyOn(terminalService, 'create').mockResolvedValue({
      id: 'term-orphan',
      title: 'Orphan',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      shell: '/bin/sh',
      kept: false,
      running: true,
    } as never);

    const sys = system({ side: 'backend' });
    sys.attach({
      tell: () => {},
      ask: () => () => {},
      follow: (_feature, _view, _args, _updated, failed) => {
        failed({ kind: 'unavailable', message: 'not used' });
        return { stop: () => {} };
      },
    });

    try {
      const handle = sys.start('default-setup/terminal', terminalSystem, {
        baseDirectory: '/tmp',
      });

      // Start CREATE_TERMINAL while restoreAll is still pending
      const createOutcomePromise = sys.ask(handle, 'terminal.CREATE_TERMINAL', { title: 'Test' });
      await Promise.resolve();

      // Stop the terminal system while restore is still pending: onExit opens RestoreGate,
      // and the ask's AbortSignal is aborted — CREATE_TERMINAL must NOT spawn a PTY.
      sys.stop();
      releaseRestore();

      const outcome = await createOutcomePromise;
      expect(outcome.ok).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    } finally {
      releaseRestore();
      sys.stop();
    }
  });
});
