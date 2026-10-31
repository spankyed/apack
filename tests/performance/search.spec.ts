import { test } from '@apackdev/testing';
import { searchScenario } from './search-scenario.ts';

test('search a populated corpus and apply only the current query results', ({ app, appPage, electronApp }) => searchScenario({ app, appPage, electronApp }));
