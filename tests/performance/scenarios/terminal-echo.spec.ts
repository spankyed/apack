import { test } from '@apackdev/testing';
import { terminalEchoScenario } from '../_support/terminal-echo-scenario.ts';

test('type into a quiet terminal and time each character to the screen', ({ app, appPage, electronApp }) => terminalEchoScenario({ app, appPage, electronApp }));
