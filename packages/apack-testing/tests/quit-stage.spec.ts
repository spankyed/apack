// Each stage of a quit names the fault that stops there, so a close that never finished says where to look.
import { describe, expect, it } from 'vitest';
import {
  WILL_QUIT_MARKER,
  chromiumHelperPidsToKill,
  describeQuitStage,
  parseWillQuitLine,
  terminateHelperPids,
} from '../src/quit-stage.ts';

it('names a quit still held in before-quit, which is the app holding it', () => {
  expect(describeQuitStage({ willQuit: false, exitCode: null, signalCode: null })).toMatch(/never reached will-quit/);
});

it('names a quit past will-quit whose process is still running', () => {
  expect(describeQuitStage({ willQuit: true, exitCode: null, signalCode: null })).toMatch(/passed will-quit.*had not exited/);
});

it('names an exited app whose output is still held, with how it exited', () => {
  expect(describeQuitStage({ willQuit: true, exitCode: 0, signalCode: null })).toMatch(/had exited \(code 0\).*held its output/);
  expect(describeQuitStage({ willQuit: false, exitCode: null, signalCode: 'SIGKILL' })).toMatch(/had exited \(SIGKILL\)/);
});

describe('will-quit helper PID capture and cleanup', () => {
  it('parses Chromium helper PIDs from the will-quit marker line', () => {
    expect(parseWillQuitLine('unrelated stdout line')).toBeUndefined();
    expect(parseWillQuitLine(WILL_QUIT_MARKER)).toEqual([]);
    expect(parseWillQuitLine(`${WILL_QUIT_MARKER} [101, 202, 303]`)).toEqual([101, 202, 303]);
    // Still parses when a prior log line lacked a trailing newline
    expect(parseWillQuitLine(`some log${WILL_QUIT_MARKER} [404, 505]`)).toEqual([404, 505]);
    // Filters invalid entries and degrades gracefully on malformed JSON
    expect(parseWillQuitLine(`${WILL_QUIT_MARKER} [12, 0, -5, 3.5, "x", null, 34]`)).toEqual([12, 34]);
    expect(parseWillQuitLine(`${WILL_QUIT_MARKER} not-json`)).toEqual([]);
  });

  it('deduplicates helper PIDs and excludes main, API, and test runner PIDs', () => {
    const pids = chromiumHelperPidsToKill(
      [100, 200, 300, 200, 400, 500, 0, -1, 1.5],
      { mainPid: 100, apiPid: 300, selfPid: 500 },
    );
    expect(pids).toEqual([200, 400]);
  });

  it('sends SIGKILL to each helper PID and ignores ESRCH and EPERM', () => {
    const signaled: Array<[number, 'SIGKILL']> = [];
    const killed = terminateHelperPids([11, 22, 33, 44], (pid, signal) => {
      signaled.push([pid, signal]);
      if (pid === 22) throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      if (pid === 33) throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
    });
    expect(signaled).toEqual([[11, 'SIGKILL'], [22, 'SIGKILL'], [33, 'SIGKILL'], [44, 'SIGKILL']]);
    expect(killed).toEqual([11, 44]);
  });

  it('rethrows unexpected kill errors', () => {
    expect(() => terminateHelperPids([99], () => {
      throw Object.assign(new Error('invalid'), { code: 'EINVAL' });
    })).toThrow('invalid');
  });
});
