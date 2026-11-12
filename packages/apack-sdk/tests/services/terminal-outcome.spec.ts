// commandSucceeded: the one question to ask before acting on a command having succeeded. It answers yes
// for an exit status of zero that a mark carrying the session's key reported, and for nothing else — in
// particular not for a status of zero that was only claimed, which is what a forged marker produces.
import { describe, expect, it } from 'vitest';
import { commandSucceeded, type CommandOutcome } from '../../src/services/index.ts';

describe('whether a command is known to have succeeded', () => {
  it('is yes for an exit of zero', () => {
    expect(commandSucceeded({ outcome: { kind: 'exited', code: 0 } })).toBe(true);
  });

  it('is no for every other way a command can stand, a claim of zero among them', () => {
    const others: Array<CommandOutcome | null> = [
      { kind: 'claimed', code: 0 },
      { kind: 'claimed', code: 1 },
      { kind: 'claimed', code: null },
      { kind: 'exited', code: 1 },
      { kind: 'exited', code: -1 },
      { kind: 'unknown', why: 'no_status' },
      { kind: 'unknown', why: 'superseded' },
      { kind: 'unknown', why: 'session_ended' },
      { kind: 'running' },
      null,
    ];
    for (const outcome of others) expect(commandSucceeded({ outcome }), JSON.stringify(outcome)).toBe(false);
  });

  it('is asked of anything that carries an outcome: a command, an event, a session\'s facts', () => {
    const exited: CommandOutcome = { kind: 'exited', code: 0 };
    const command = { id: 1, command: 'make', cwd: '/src', startedMs: 1, finishedMs: 2, outcome: exited };
    const event = { kind: 'commandFinished' as const, outcome: exited };
    const facts = { cwd: null, command: 'make', running: false, outcome: exited, finished: 1, vouched: true, refused: 0 };
    expect([command, event, facts].map(commandSucceeded)).toEqual([true, true, true]);
  });
});
