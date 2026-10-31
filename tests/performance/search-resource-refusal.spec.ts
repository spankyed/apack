import { test } from '@apackdev/testing';
import { searchScenario } from './search-scenario.ts';

test('renderer resource refusal preserves correctness and incomplete capture', ({ app, appPage, electronApp }) => searchScenario({ app, appPage, electronApp }, true));
