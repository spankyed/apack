// Every writer that flushes a turn's growing state is held to a bound, and the population is derived.
//
// **The amplification was fixed twice and found a third time only by measuring.** A block became a row,
// then a block's text became append-only segments — and the tool-activity entries, which were the larger
// cost both times, were not covered by either, because each bound was a number inside one spec about one
// writer and nothing asked whether the set of writers was complete. `tool-activity-writer.ts` had no spec
// at all while it was the most expensive of the three.
//
// So the rule is over the population rather than over the writers someone remembered: a module that both
// schedules a flush and writes through `services.chat` is a turn writer, and a turn writer must be named
// by a spec that bounds what it writes. A fourth one fails here until somebody measures it.
//
// Read with the compiler rather than matched in the text, for the reason `check:specifiers`' own reader
// records: a specifier inside a comment or a template literal is not one, and no regex over the text can
// tell. In-pack precedent for building a program over this pack's own source:
// `tests/send-to-system-diagnostics.spec.ts`.
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { population } from '@apackdev/sdk/testing';
import { describe, expect, it } from 'vitest';

const HELPERS = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'src', 'content', 'actions', 'claude-code', '_helpers');
const SPECS = import.meta.dirname;

/** The writes a turn writer makes: the service calls that reach a message's row */
const ROW_WRITES = new Set(['updateMessageState', 'updateMessageBlock', 'appendMessageBlockText', 'updateMessageToolEntry', 'removeMessageBlock']);
/** How a writer defers one: the only timer this code has */
const DEFERS = new Set(['setTimeout']);

/**
 * Whether a source both defers a flush and writes a row — which is what makes it a turn writer.
 *
 * Both halves are required, and that is the discriminating part: a module that only writes is a one-shot
 * (`plan-artifact.ts`, `thread-context.ts`) and has no amplification to bound, while a module that only
 * defers is a timer with no store behind it.
 */
export function turnWriterIn(text: string, file: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let defers = false;
  let writes = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && DEFERS.has(callee.text)) defers = true;
      if (ts.isPropertyAccessExpression(callee) && ROW_WRITES.has(callee.name.text)) writes = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return defers && writes;
}

const helperSources = (): string[] => [...population('the claude-code action helpers',
  fs.readdirSync(HELPERS).filter((file) => file.endsWith('.ts')).map((file) => path.join(HELPERS, file)))];

/** The turn writers, derived: every helper that defers a flush and writes a row */
const turnWriters = (files: string[] = helperSources()): string[] => [...population('the turn writers',
  files.filter((file) => turnWriterIn(fs.readFileSync(file, 'utf-8'), file)).map((file) => path.basename(file)))];

/** This file, which bounds nothing and names every writer, so it must not count as any writer's spec */
const SELF = 'turn-writers.spec.ts';

/**
 * Which writers the specs beside this one bound.
 *
 * **Keyed on the import of the shared recorder, not on a word.** A bound is "what reached storage against
 * what it keeps", and that is one declaration — `recordTurnWrites` in `_support/turn-writes.ts`. Asking
 * for the import rather than for a variable name is what makes this structural: the three specs called
 * the same quantity `kept`, `reply` and nothing at all, and a check reading for `kept` both missed a real
 * bound and counted **this file** as every writer's, since it names all three and mentions the word.
 */
function boundedWriters(): Set<string> {
  const bounded = new Set<string>();
  const writers = fs.readdirSync(HELPERS).filter((file) => file.endsWith('.ts'));
  for (const spec of fs.readdirSync(SPECS).filter((file) => file.endsWith('.spec.ts') && file !== SELF)) {
    const text = fs.readFileSync(path.join(SPECS, spec), 'utf-8');
    if (!text.includes('recordTurnWrites')) continue;
    for (const module of writers) if (text.includes(module)) bounded.add(module);
  }
  return bounded;
}

/** The writers nothing holds to a bound */
export const unboundedAmong = (writers: readonly string[], bounded: ReadonlySet<string>): string[] =>
  writers.filter((writer) => !bounded.has(writer));

describe('every turn writer is bounded', () => {
  it('derives the writers rather than naming them', () => {
    const found = turnWriters();
    // The three that exist, so a derivation that silently stopped finding them is a failure here and not
    // a quiet pass. Named as a floor on the answer, never as the answer
    expect(found).toEqual(expect.arrayContaining(['thinking-writer.ts', 'stream-writer.ts', 'tool-activity-writer.ts']));
  });

  it('has a spec bounding each of them', () => {
    expect(unboundedAmong(turnWriters(), boundedWriters()),
      'a writer flushes a turn\'s growing state and nothing holds what it writes to a multiple of what it '
      + 'keeps: drive it against `recordTurnWrites` and assert `written()` against `kept()`')
      .toEqual([]);
  });

  /**
   * The rule reports a writer nothing bounds — the case that matters, since the live one above passes by
   * finding nothing and would read the same if it looked at nothing.
   *
   * Asked of a synthetic writer rather than a planted file: a module written into the helpers directory
   * would be inlined by the next content build, and what is in question is the rule rather than the walk.
   */
  it('reports a writer that no spec bounds', () => {
    expect(unboundedAmong([...turnWriters(), 'new-writer.ts'], boundedWriters())).toEqual(['new-writer.ts']);
  });

  /**
   * The firing case, over the **input** rather than the expectation.
   *
   * `subprocess-inventory.spec.ts`'s header records why: its predecessor doctored the expected list and
   * passed with the detector stubbed to return nothing. Dropping a real writer from the population and
   * requiring the answer to follow is the version that cannot do that.
   */
  it('follows the population it is given', () => {
    const whole = turnWriters();
    expect(whole, 'the file this drops is not in the answer to begin with, so nothing is being mutated')
      .toContain('tool-activity-writer.ts');

    const short = helperSources().filter((file) => path.basename(file) !== 'tool-activity-writer.ts');
    expect(turnWriters(short)).toEqual(whole.filter((writer) => writer !== 'tool-activity-writer.ts'));
  });

  /** And the detector itself, over sources written to be each shape */
  it.each([
    ['defers and writes', 'const t = () => { setTimeout(() => services.chat.updateMessageBlock(id, b), 10); };', true],
    ['writes without deferring', 'const t = () => { services.chat.updateMessageBlock(id, b); };', false],
    ['defers without writing', 'const t = () => { setTimeout(() => done(), 10); };', false],
    ['neither', 'export const value = 1;', false],
    ['names a write in a comment only', '// services.chat.updateMessageBlock\nsetTimeout(() => done(), 10);', false],
  ])('reads a source that %s', (_what, text, expected) => {
    expect(turnWriterIn(text, 'probe.ts')).toBe(expected);
  });
});
