import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { population } from '@apackdev/sdk/testing';
import { repoFiles } from './_support/repo-files.ts';

/**
 * Environment identity and data paths are decided only by @apackdev/sdk/env (and the main
 * process bootstrap that feeds it). This guard fails if the old, divergent resolution
 * patterns come back anywhere in the repo's code.
 *
 * Here and not in `@apackdev/sdk`, because its subject is every tracked file and not that package — it
 * imports nothing from it. A suite's project is re-run when that project's inputs move, so a guard over the
 * repo has to sit in a suite that declares the repo (`SUITE_READS`' `repo`); in a package suite it would miss
 * a forbidden path committed anywhere else.
 */

/**
 * The patterns a file is allowed to contain, and why — **per pattern, not per file**.
 *
 * Per pattern, not per file: a file excused wholesale would be invisible to every pattern, so naming the
 * subset is what keeps a file excused for its data dir from quietly gaining a channel read. The env
 * pattern's `(?!\s*=)` — meant to permit assignment — exempts a comparison too.
 */
const ALLOWED: Record<string, { patterns: readonly PatternId[]; why: string }> = {
  'packages/apack-sdk/src/env/index.ts': { patterns: ['data-dir', 'env-read'], why: 'the resolver itself' },
  'packages/main/src/app-environment.ts': {
    patterns: ['env-read'], why: 'main-process bootstrap: infers the environment once',
  },
  'packages/main/vite.config.js': { patterns: ['env-read'], why: 'development launcher: resolves the environment of the app it spawns' },
  'packages/internal-repo-checks/tests/identity-guard.spec.ts': {
    patterns: ['data-dir', 'channel'], why: 'this guard, which has to spell the patterns it looks for',
  },
  'packages/apack-sdk/src/logger/logger.ts': {
    patterns: ['node-env'], why: 'whether debug logging is on by default — a build-mode question, not an identity one',
  },

};

type PatternId = 'data-dir' | 'env-read' | 'channel' | 'node-env';

const FORBIDDEN: Array<{ id: PatternId; pattern: RegExp; why: string; allowInTests?: boolean }> = [
  { id: 'data-dir', pattern: /Application Support/, why: 'platform data dirs are derived only in @apackdev/sdk/env' },
  { id: 'env-read', pattern: /process\.env\.APACK_ENV\b(?!\s*=)/, why: 'read the environment via resolveAppEnvironment()', allowInTests: true },
  { id: 'channel', pattern: /__APACK_CHANNEL__/, why: 'the channel stamp is consumed only by the main bootstrap' },
  // Deliberately narrower than every NODE_ENV read: a bundler config asking what mode it builds in is not
  // this repo's business, and every one of those compares against 'development' or assigns. What this
  // catches is NODE_ENV standing in for the app's identity, such as deciding where the user's database
  // lives — a variable the ecosystem uses to mean "optimize this build".
  // The lookahead `env-read` carries is deliberately absent: `(?!\s*=)` swallows the first `=` of `===`
  // and would make this match nothing it is for.
  { id: 'node-env', pattern: /NODE_ENV\s*[!=]==?\s*['"]production['"]/, why: 'ask resolveAppEnvironment() what this app is, not NODE_ENV', allowInTests: true },
];

const trackedCodeFiles = (): string[] => repoFiles().filter((file) =>
  /\.(ts|tsx|js|mjs|cjs|vue|sh)$/.test(file)
  && !file.includes('node_modules/') && !file.includes('/dist/') && !file.includes('__generated__/'));

/** Which forbidden patterns a file actually contains, after the rule that tests may hold an env read. */
function fires(file: string): PatternId[] {
  const isTest = /(^|\/)tests?\//.test(file) || file.endsWith('.spec.ts');
  const lines = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8').split('\n');
  return FORBIDDEN
    .filter(({ pattern, allowInTests }) => !(allowInTests && isTest) && lines.some((line) => pattern.test(line)))
    .map(({ id }) => id);
}

/**
 * A sample each pattern is meant to catch. A guard whose subject is other people's code can go quiet without
 * anyone noticing — a lookahead that swallows the `=` it was not written for, a renamed constant — and then it
 * reports nothing because it matches nothing. These are the firing cases: they fail in microseconds on every
 * run, and they are what caught `(?!\s*=)` eating the first `=` of `===`.
 */
const FIRES_ON: Record<PatternId, string> = {
  'data-dir': "path.join(home, 'Library', 'Application Support', appName)",
  'env-read': 'const env = process.env.APACK_ENV;',
  'channel': 'const channel = __APACK_CHANNEL__;',
  'node-env': "const packaged = process.env.NODE_ENV === 'production';",
};

describe('the patterns themselves', () => {
  it('each still matches what it is for', () => {
    for (const { id, pattern } of FORBIDDEN) {
      expect(pattern.test(FIRES_ON[id]), `${id} no longer matches ${FIRES_ON[id]}`).toBe(true);
    }
  });

  it('covers every pattern, so a new one cannot arrive without a case', () => {
    expect(FORBIDDEN.map(({ id }) => id).sort()).toEqual(Object.keys(FIRES_ON).sort());
  });
});

describe('environment identity guard', () => {
  it('no code outside the env module resolves environment or data dirs on its own', () => {
    // The subject is every tracked code file; a walk that returned none would report no violation and
    // read exactly like a pass
    const files = population('tracked code files', trackedCodeFiles(), { atLeast: 500 });
    const violations: string[] = [];
    for (const file of files) {
      const excused = ALLOWED[file]?.patterns ?? [];
      const isTest = /(^|\/)tests?\//.test(file) || file.endsWith('.spec.ts');
      const lines = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8').split('\n');
      lines.forEach((line, i) => {
        for (const { id, pattern, why, allowInTests } of FORBIDDEN) {
          // Excused for this pattern, not for the file: an entry earned by a data dir does not also
          // hide a channel read that appears later
          if (excused.includes(id) || (allowInTests && isTest)) continue;
          if (pattern.test(line)) violations.push(`${file}:${i + 1} ${line.trim()}  ← ${why}`);
        }
      });
    }
    expect(violations, 'Resolve identity via @apackdev/sdk/env (resolveAppEnvironment)').toEqual([]);
  });

  /**
   * An exemption excuses nothing once the file stops containing the pattern it was written for. Nothing
   * fails then — the entry simply sits there, and the next reader takes it for a live constraint.
   */
  it('excuses nothing that has stopped needing it', () => {
    const stale = Object.entries(ALLOWED).flatMap(([file, { patterns }]) => {
      if (!fs.existsSync(path.join(REPO_ROOT, file))) return [`${file}: gone`];
      const actual = fires(file);
      const unused = patterns.filter((id) => !actual.includes(id));
      return unused.length > 0 ? [`${file}: no longer contains ${unused.join(', ')}`] : [];
    });
    expect(stale, 'drop these from ALLOWED, or the pattern they name from their entry').toEqual([]);
  });
});
