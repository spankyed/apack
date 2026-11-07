import { test } from '@apackdev/testing';
import { terminalResizeScenario } from '../_support/terminal-resize-scenario.ts';

test('resize a terminal the way a panel drag does, and count what reaches the database', ({ app, appPage, electronApp }) => terminalResizeScenario({ app, appPage, electronApp }));
