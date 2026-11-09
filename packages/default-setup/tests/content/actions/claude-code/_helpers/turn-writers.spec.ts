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

/** The writes a turn writer makes: the service calls that reach a message's rows */
const ROW_WRITES = new Set(['updateMessageState', 'updateMessageBlock', 'appendMessageBlockText', 'updateMessageToolEntry', 'removeMessageBlock', 'compactMessageBlock']);

/**
 * Whether a source holds a turn writer: **a factory per message whose returned functions write its rows.**
 *
 * That shape is what needs bounding — something constructed once for a message and then written through
 * many times as a turn streams, which is where a multiple of what it keeps can hide. A module that writes a
 * row straight from its exported function is a one-shot (`plan-artifact.ts`, `thread-context.ts`) with no
 * accumulation to bound, and the orchestrator that constructs the writers (`stream-consumer.ts`) writes
 * rows too but is not one.
 *
 * **It used to ask whether the module deferred a flush, and that was a proxy that broke.** Deferring stood
 * in for accumulating, so when the tool-activity writer's interval was removed — the entries having become
 * rows written as they arrive — the most expensive writer of the three silently left the population. This
 * gate's own floor case caught it, which is the one direction a derived population can be checked in.
 */
export function turnWriterIn(text: string, file: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  const writesARow = (node: ts.Node): boolean => {
    let found = false;
    const look = (inner: ts.Node): void => {
      if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)
        && ROW_WRITES.has(inner.expression.name.text)) found = true;
      ts.forEachChild(inner, look);
    };
    ts.forEachChild(node, look);
    return found;
  };

  /** A function nested inside the factory: what the factory hands back, rather than what it does itself */
  const nestedWritesARow = (factory: ts.Node): boolean => {
    let found = false;
    const look = (inner: ts.Node): void => {
      if (inner !== factory && (ts.isFunctionDeclaration(inner) || ts.isArrowFunction(inner)
        || ts.isFunctionExpression(inner) || ts.isMethodDeclaration(inner)) && writesARow(inner)) found = true;
      ts.forEachChild(inner, look);
    };
    ts.forEachChild(factory, look);
    return found;
  };

  const takesAMessage = (node: ts.FunctionLikeDeclarationBase): boolean =>
    node.parameters.some((parameter) => parameter.name.getText(source) === 'messageId');

  let writer = false;
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      && takesAMessage(node) && nestedWritesARow(node)) writer = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return writer;
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
    ['hands back a function that writes',
      'export function make(services, messageId) { return { push: () => services.chat.updateMessageBlock(messageId, b) }; }', true],
    ['writes a row itself, taking no message',
      'export function once(services, threadId) { services.chat.updateMessageBlock(threadId, b); }', false],
    ['writes a row itself for a message, handing back nothing',
      'export function once(services, messageId) { services.chat.updateMessageBlock(messageId, b); }', false],
    ['hands back a function that writes nothing',
      'export function make(services, messageId) { return { push: () => count(messageId) }; }', false],
    ['names a write in a comment only',
      'export function make(services, messageId) { return { push: () => /* services.chat.updateMessageBlock */ 1 }; }', false],
    ['neither', 'export const value = 1;', false],
  ])('reads a source that %s', (_what, text, expected) => {
    expect(turnWriterIn(text, 'probe.ts')).toBe(expected);
  });
});
