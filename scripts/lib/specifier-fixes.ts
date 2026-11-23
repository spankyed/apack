/**
 * Applying the repairs the specifier rules already compute.
 *
 * Two rules print the answer as advice — `own-modules` says `write '#generated/events.ts'`, and the `.js` rule
 * fires only because the source sibling exists — and until now a human retyped it. This goal's own migrations
 * wrote 736 specifiers by throwaway script and then 87 more; that logic belongs where the rule is
 * (`docs/goals/goal-one-rule-set.md`, Phase 5).
 *
 * Pure and injectable, so the safety rules are unit-testable without a tree: what makes a rewriter safe is not
 * the writing but the refusals.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** One replacement: the span to overwrite, what is there now, and what to put there */
export interface Splice {
  readonly start: number;
  readonly end: number;
  readonly specifier: string;
  readonly named: string;
}

/** A fixable finding: a file, a span inside it, and the specifier the rule says should be there */
export interface Fix extends Splice {
  /** Relative to the root the caller passes, `/`-separated — what a report prints */
  readonly file: string;
  readonly line: number;
}

/**
 * One file's text with every splice applied, or a refusal naming why nothing was written.
 *
 * Three refusals, each because the alternative corrupts source:
 *
 * - **a span that does not hold the specifier** — the reader and the disk disagree, so every offset in the file
 *   is suspect, not just this one;
 * - **two spans that overlap** — one of them must be wrong;
 * - nothing to do, which is not a refusal but is worth distinguishing from a write of identical bytes.
 *
 * Right to left, so an earlier offset is still valid after a later replacement: two specifiers on one line and
 * a `.vue` with two script blocks both fall out of that rather than needing a case each.
 */
export function spliceFile(text: string, splices: readonly Splice[]): { text: string } | { refused: string } {
  const ordered = [...splices].sort((a, b) => b.start - a.start);
  for (const [index, splice] of ordered.entries()) {
    if (text.slice(splice.start, splice.end) !== splice.specifier) {
      return { refused: `the file changed since it was read: ${splice.start}..${splice.end} is not '${splice.specifier}'` };
    }
    const next = ordered[index + 1];
    if (next && next.end > splice.start) {
      return { refused: `two findings overlap at ${next.start}..${next.end} and ${splice.start}..${splice.end}` };
    }
  }
  if (ordered.length === 0) return { refused: 'nothing to fix in this file' };
  let out = text;
  for (const { start, end, named } of ordered) out = out.slice(0, start) + named + out.slice(end);
  return { text: out };
}

/**
 * Applies every fix, one read and one write per file.
 *
 * A file whose splices are refused is left byte-identical and reported: a partial rewrite of a file is worse
 * than none. A file with some fixable findings and some unfixable ones *is* written — the alternative would
 * leave 736 repairs unapplied because one specifier sat in a template literal.
 */
export function applyFixes(
  root: string,
  fixes: readonly Fix[],
  write: (file: string, text: string) => void = (file, text) => fs.writeFileSync(file, text),
): { written: { file: string; count: number }[]; refused: { file: string; why: string }[] } {
  const byFile = Map.groupBy(fixes, (fix) => fix.file);
  const written: { file: string; count: number }[] = [];
  const refused: { file: string; why: string }[] = [];
  for (const [file, found] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    const full = path.join(root, file);
    const result = spliceFile(fs.readFileSync(full, 'utf-8'), found);
    if ('refused' in result) refused.push({ file, why: result.refused });
    else {
      write(full, result.text);
      written.push({ file, count: found.length });
    }
  }
  return { written, refused };
}
