// A new pack's tests install the Playwright this repo runs its own against, so what a pack author gets has been run
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { PLAYWRIGHT_VERSION } from '../../src/commands/init-tests.ts';

it("pins the Playwright the repo's own tests install", () => {
  const { devDependencies } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
  expect(devDependencies['@playwright/test']).toBe(PLAYWRIGHT_VERSION);
  expect(devDependencies['playwright-core']).toBe(PLAYWRIGHT_VERSION);
});
