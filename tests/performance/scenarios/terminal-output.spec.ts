import { test } from '@apackdev/testing';
import { terminalOutputScenario } from '../_support/terminal-output-scenario.ts';

test('deliver a fixed corpus of terminal output and count what the pipe made of it', ({ app, appPage, electronApp }) => terminalOutputScenario({ app, appPage, electronApp }));
