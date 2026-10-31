import { test } from '@apackdev/testing';
import { threadOpenScenario } from './thread-open-scenario.ts';

test('full-read exceeds the work budget', ({ app, appPage, electronApp }) => threadOpenScenario({ app, appPage, electronApp }, 'full-read'));
test('missing-completion remains incomplete with the populated view rendered', ({ app, appPage, electronApp }) => threadOpenScenario({ app, appPage, electronApp }, 'missing-completion'));
