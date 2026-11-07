import { test } from '@apackdev/testing';
import { terminalOpenScenario } from '../_support/terminal-open-scenario.ts';

test('open a terminal through the real pty and draw its first output', ({ app, appPage, electronApp }) => terminalOpenScenario({ app, appPage, electronApp }));
