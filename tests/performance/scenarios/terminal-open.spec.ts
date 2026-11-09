import { test } from '@apackdev/testing';
import { terminalOpenScenario } from '../_support/terminal-open-scenario.ts';

test('open a terminal through the real pty and attach its emulator', ({ app, appPage, electronApp }) => terminalOpenScenario({ app, appPage, electronApp }));
