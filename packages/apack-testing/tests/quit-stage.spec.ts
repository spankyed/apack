// Each stage of a quit names the fault that stops there, so a close that never finished says where to look.
import { expect, it } from 'vitest';
import { describeQuitStage } from '../src/quit-stage.ts';

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
