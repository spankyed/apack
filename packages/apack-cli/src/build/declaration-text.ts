// Normalising emitted TypeScript declarations, so the same sources produce the same bytes.
//
// Beside its callers, which are both this package's: `bundleDeclarations` (build/types-bundler.ts), which
// writes every declaration bundle a pack build produces, and `apack pack facade-report`, which records one of
// them. It lived in @apackdev/host for a while because the report was a repo script and a script and a
// package's src cannot reach each other — the util moved rather than the thing that was in the wrong place.
import ts from 'typescript';

/**
 * A declaration bundle with literal union members sorted (`"b" | "a"` → `"a" | "b"`).
 * Explicit `undefined` is admitted too: inferred optional fields emit it as an alternative.
 *
 * TypeScript prints an inferred union in the order it created the member types, and that order changes
 * between builds, so identical sources emit different bytes. Measured 2026-09-28: the pack's
 * `action-defs.d.ts` took five distinct hashes in six builds and `pack-types.d.ts` moved with it, which made
 * every chain step caching on `packages/default-setup/dist` go stale for files whose meaning never changed.
 * Sorting is safe because a union's order does not change the type.
 *
 * **Only unions whose members are literals or `undefined`.** `Foo | Bar` is left alone: sorting type references would
 * reorder text whose order this has no evidence varies, and `npm run check:repro` is what would report it if
 * a non-literal union ever did — widen this deliberately then, with the measurement, rather than pre-emptively.
 *
 * Unions with comments are preserved verbatim: moving or dropping their explanations would hide a report change.
 * Malformed input degrades rather than throwing: `createSourceFile` is error-tolerant, so the unions it did
 * parse are still sorted. That is checked, because the alternative — silently returning the input — would
 * make this look applied while doing nothing.
 */
export function sortLiteralUnions(bundle: string, fileName = 'bundle.d.ts'): string {
  const file = ts.createSourceFile(fileName, bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isUnionTypeNode(node) && node.types.every((member) => ts.isLiteralTypeNode(member) || member.kind === ts.SyntaxKind.UndefinedKeyword)) {
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, node.getText(file));
      for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) return;
      }
      edits.push({ start: node.getStart(file), end: node.end, text: node.types.map((member) => member.getText(file)).sort().join(' | ') });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  // Right to left, so an earlier edit's offsets still refer to the text they were taken from
  return edits.reverse().reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), bundle);
}
