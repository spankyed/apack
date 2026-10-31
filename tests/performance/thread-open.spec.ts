import { test } from '@apackdev/testing';
import { threadOpenScenario } from './thread-open-scenario.ts';

test('open a populated thread through the real transport and render its bounded page', ({ app, appPage, electronApp }) => threadOpenScenario({ app, appPage, electronApp }));
