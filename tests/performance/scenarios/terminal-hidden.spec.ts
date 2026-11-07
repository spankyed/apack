import { test } from '@apackdev/testing';
import { terminalHiddenScenario } from '../_support/terminal-hidden-scenario.ts';

test('keep every terminal alive and record what several hidden sessions cost', ({ app, appPage, electronApp }) => terminalHiddenScenario({ app, appPage, electronApp }));
