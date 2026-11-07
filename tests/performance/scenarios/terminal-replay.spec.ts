import { test } from '@apackdev/testing';
import { terminalReplayScenario } from '../_support/terminal-replay-scenario.ts';

test('come back to a terminal carrying a large history and record what the reattach costs', ({ app, appPage, electronApp }) => terminalReplayScenario({ app, appPage, electronApp }));
