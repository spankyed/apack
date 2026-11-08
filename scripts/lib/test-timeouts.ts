/**
 * The timing facts a spec file declares, read from its syntax tree: the timeout overrides it sets, and the bare
 * waits it takes.
 *
 * A size budget lives in a vitest config; a third argument to `it()` overrides it for one test. A guard that
 * reads only configs sees the policy and not the escape, which is how fifteen overrides of 60s to 240s sat
 * in small suites whose budget is 15s.
 *
 * **Read with the compiler, not a regular expression.** Two attempts at matching the source text failed in
 * both directions: `}, 500)` matched `setTimeout(() => {…}, 500)` inside a fixture string and gutted it,
 * while `beforeAll(async () => { … }, 240_000);` on a single line matched nothing at all. A timeout argument
 * is a position in a call expression, so the tree is what knows where it is.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { INTEGRATION_SUITES, NATIVE_SUITES } from './chain-steps.ts';
import { CONFIG_BY_HALF, halfOfPath } from './spec-halves.ts';
import type { Size } from './unit-suites.ts';

/** The vitest callables that take a trailing timeout */
const RUNNERS = new Set(['it', 'test', 'describe', 'beforeAll', 'beforeEach', 'afterAll', 'afterEach']);
/** A hook takes `(fn, timeout)`; everything else takes `(name, fn, timeout)` */
const HOOKS = new Set(['beforeAll', 'beforeEach', 'afterAll', 'afterEach']);

export interface TimeoutOverride {
  /** Repo-relative, so a key reads the same wherever it is printed */
  readonly file: string;
  /** `it`, `beforeAll`, … — the callable, not the modifier it was reached through */
  readonly runner: string;
  /** The test's name where one is a literal; a hook has none */
  readonly name: string;
  /** Milliseconds, or `undefined` where the argument is not a literal this can evaluate */
  readonly ms: number | undefined;
  readonly line: number;
  /**
   * What the number bounds. `cpu` is a test's `meta: cpuBudget(ms)`, the CPU it may spend before the progress guard
   * fails it (`@apackdev/testing`'s `vitest-progress-guard.ts`). `clock` is a timeout vitest measures on the clock —
   * a trailing argument, or `timeout` in a test's options — which a busy machine reaches, so the rule refuses one.
   */
  readonly kind: 'cpu' | 'clock';
}

/** How an override is named in the exceptions list, and in anything a person has to read */
export const overrideKey = (override: Pick<TimeoutOverride, 'file' | 'runner' | 'name'>): string =>
  `${override.file} > ${override.name || override.runner}`;

/**
 * Every timeout override in one spec file.
 *
 * The callable is found by walking to the leftmost identifier, so `it`, `it.only`, `it.skipIf(x)(…)` and
 * `it.each(table)(…)` all resolve to `it` and are read at the same argument position.
 */
/**
 * A timeout written as arithmetic over numeric literals — `2 * 60_000 + 20_000`, the way a case composes its
 * phases — evaluated exactly; anything naming a value (a constant, a call) is `undefined`, which the budget
 * check treats as needing review rather than guessing.
 */
export function constantMs(node: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ''));
  if (ts.isParenthesizedExpression(node)) return constantMs(node.expression);
  if (!ts.isBinaryExpression(node)) return undefined;
  const left = constantMs(node.left);
  const right = constantMs(node.right);
  if (left === undefined || right === undefined) return undefined;
  switch (node.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken: return left + right;
    case ts.SyntaxKind.MinusToken: return left - right;
    case ts.SyntaxKind.AsteriskToken: return left * right;
    case ts.SyntaxKind.SlashToken: return left / right;
    default: return undefined;
  }
}

export function timeoutOverrides(absFile: string, repoRoot: string): TimeoutOverride[] {
  const source = ts.createSourceFile(absFile, fs.readFileSync(absFile, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: TimeoutOverride[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      let head: ts.Node = node.expression;
      while (ts.isPropertyAccessExpression(head) || ts.isCallExpression(head)) head = head.expression;
      if (ts.isIdentifier(head) && RUNNERS.has(head.text)) {
        const first = node.arguments[0];
        const record = (at: ts.Node, kind: TimeoutOverride['kind'], ms: number | undefined) => found.push({
          file: path.relative(repoRoot, absFile),
          runner: head.text,
          name: first && ts.isStringLiteralLike(first) ? first.text : '',
          ms,
          line: source.getLineAndCharacterOfPosition(at.getStart(source)).line + 1,
          kind,
        });
        const isFunction = (candidate: ts.Node) => ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate);
        // A trailing timeout: whatever sits after the function, which a test's options object never does
        const trailing = node.arguments[HOOKS.has(head.text) ? 1 : 2];
        if (trailing && !isFunction(trailing) && !ts.isObjectLiteralExpression(trailing)) {
          record(trailing, 'clock', ts.isSpreadElement(trailing) ? undefined : constantMs(trailing));
        }
        // A test's options, the second argument: `timeout` there is the same clock, `meta.cpuBudgetMs` is CPU
        const options = HOOKS.has(head.text) ? undefined : node.arguments[1];
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
            if (property.name.text === 'timeout') record(property.initializer, 'clock', constantMs(property.initializer));
            // `meta: cpuBudget(ms)`, `@apackdev/testing/vitest`'s helper and the one way a test declares it
            const meta = property.name.text === 'meta' ? property.initializer : undefined;
            if (meta && ts.isCallExpression(meta) && ts.isIdentifier(meta.expression) && meta.expression.text === 'cpuBudget') {
              const [ms] = meta.arguments;
              record(ms ?? meta, 'cpu', ms === undefined || ts.isSpreadElement(ms) ? undefined : constantMs(ms));
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * A promise that resolves after a delay — a spec asserting on a duration rather than on the thing it waits for.
 *
 * A sleep puts a guess about how long something takes into every passing run, and when the guess is short the
 * failure reads exactly like the bug it was meant to catch. `@apackdev/sdk/testing/waiting` is the alternative,
 * and its header has the rule: a wait is driven by the thing it waits for and names what never happened — an
 * event where there is one, a poll where there is none.
 */
export interface BareWait {
  readonly file: string;
  /** The named thing it sits in — a helper, or the test — so the exceptions list does not churn with line numbers */
  readonly name: string;
  readonly line: number;
}

/** How a bare wait is named in the exceptions lists, and in anything a person has to read */
export const bareWaitKey = (wait: Pick<BareWait, 'file' | 'name'>): string => `${wait.file} > ${wait.name}`;

/** Whether `fn` is how a promise's own `resolve` gets called — the identifier itself, or something calling it */
function settles(fn: ts.Node, resolve: string): boolean {
  if (ts.isIdentifier(fn)) return fn.text === resolve;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false;
  let calls = false;
  const look = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === resolve) calls = true;
    ts.forEachChild(node, look);
  };
  look(fn);
  return calls;
}

/**
 * Every bare wait in one spec file.
 *
 * **Why it reads the tree and what that buys.** A third of this repo's textual matches for a delayed
 * `setTimeout` are inside string literals — subprocess bodies, an `actionFn`, a script the CLI runs — and a
 * text scan would report every one. The tree knows a string from code.
 *
 * **A deadline is not a wait, and the difference is which function the timer calls.** `setTimeout(resolve, ms)`
 * sleeps; `setTimeout(() => reject(…), ms)` is a kill deadline, which is the thing being promoted here, so only
 * a timer that reaches the promise's own `resolve` counts. A literal `0` does not count either: it yields a turn
 * and claims nothing about duration, so it cannot be wrong because the machine was slow.
 */
export function bareWaits(absFile: string, repoRoot: string): BareWait[] {
  const source = ts.createSourceFile(absFile, fs.readFileSync(absFile, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: BareWait[] = [];
  /** The named things enclosing the node being visited, so a finding is named rather than numbered */
  const enclosing: string[] = [];

  const sleepsIn = (executor: ts.Node, resolve: string): ts.Node | undefined => {
    let timer: ts.Node | undefined;
    const look = (node: ts.Node): void => {
      if (timer) return;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'setTimeout') {
        const [fn, delay] = node.arguments;
        const isTurn = delay !== undefined && ts.isNumericLiteral(delay) && Number(delay.text) === 0;
        if (fn && !isTurn && settles(fn, resolve)) timer = node;
      }
      ts.forEachChild(node, look);
    };
    look(executor);
    return timer;
  };

  const visit = (node: ts.Node): void => {
    // A declaration's name, or a test's, so the key is stable across edits; a line number is the last resort
    const named = (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)
      ? node.name.text
      : ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
        ? node.arguments[0].text
        : undefined;
    if (named !== undefined) enclosing.push(named);

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Promise') {
      const executor = node.arguments?.[0];
      const resolve = executor && (ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))
        ? executor.parameters[0] : undefined;
      if (executor && resolve && ts.isIdentifier(resolve.name)) {
        const timer = sleepsIn(executor, resolve.name.text);
        if (timer) {
          found.push({
            file: path.relative(repoRoot, absFile),
            name: enclosing.at(-1) ?? `line ${source.getLineAndCharacterOfPosition(timer.getStart(source)).line + 1}`,
            line: source.getLineAndCharacterOfPosition(timer.getStart(source)).line + 1,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
    if (named !== undefined) enclosing.pop();
  };
  visit(source);
  return found;
}

/** Every `*.spec.ts` under a directory */
/**
 * The size of the test target a file belongs to, which is what decides the timeout budget it fits inside.
 *
 * There are three targets and this answers for any file in one: a package's fast half, a package's
 * integration half, and the E2E suite. It takes configs and specs alike, because "what budget applies
 * here" is one question and was briefly two functions in two modules deciding it by different means.
 *
 * **The two means are the asymmetry, and it is real.** A config's *existence* is the fact — a package has
 * an integration half exactly when it has an integration config, which is how `INTEGRATION_SUITES` is
 * derived in the first place. A spec's *name* is only a claim: a package without that config runs
 * everything in its fast half, so `x.integration.spec.ts` there is `small` whatever it is called.
 * Checking the claim against `INTEGRATION_SUITES` rather than naming a package is the part with a firing
 * case — naming one put the 8 integration specs in `repo-checks` and `publish-checks` under a small
 * budget while they ran large, invisibly, because neither had a per-test override and the *configs* were
 * already derived.
 *
 * **Not `halfOfPath`, which answers a different question.** That one says which half a spec is *in*, by
 * suffix alone — the suffix is a decision a spec's author makes, so it is that question's subject rather
 * than a hint. The two disagree on exactly one input: a `.integration.spec.ts` in a package with no
 * integration config, which `halfOfPath` calls integration and this calls small. No such file exists, and
 * one would be caught anyway: `spec-placement.spec.ts` fails a suffix naming a half its package does not
 * have, which is the file that would run in neither.
 */
export function sizeOf(file: string): Size {
  // The E2E suite is its own target and belongs to no package
  if (file.endsWith('playwright.config.ts')) return 'large';
  // The expensive halves first: the names are read from `CONFIG_BY_HALF`, which is where the convention lives
  if (file.endsWith(CONFIG_BY_HALF.native)) return 'enormous';
  if (file.endsWith(CONFIG_BY_HALF.integration)) return 'large';
  if (file.endsWith(CONFIG_BY_HALF.fast)) return 'small';
  if (file.endsWith('.spec.ts')) {
    const dir = file.split('/')[1];
    const half = halfOfPath(file);
    if (half === 'native' && NATIVE_SUITES.some((suite) => suite.dir === dir)) return 'enormous';
    return half === 'integration' && INTEGRATION_SUITES.some((suite) => suite.dir === dir) ? 'large' : 'small';
  }
  // Refused rather than answered. Every other file would get `small` — a confident wrong answer, and the
  // budget is a ceiling, so the confident wrong answer is the permissive one.
  throw new Error(`sizeOf: ${file} is neither a test config nor a spec, so no budget applies to it`);
}

export function specFilesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? specFilesUnder(full) : entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}
