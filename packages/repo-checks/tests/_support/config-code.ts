/**
 * Reading a config's *code*, for the checks that ask whether it still delegates to a helper.
 *
 * It has to be the code and not the text, and both halves of `pack-test-config.spec.ts` were fooled by
 * prose on its first mutation run: the scaffolded template *mentions* the helper in a comment explaining
 * it, so a config that had gone back to assembling its own still passed, and a `test:` written mid-line —
 * which is what spreading a helper's result looks like — was missed by a pattern anchored to the line
 * start. A check on what code says has to read only the code.
 *
 * **`@apackdev/cli`'s `src/build/config-text.ts` is the same reading, for the scaffolder that reports a
 * config it kept.** The two are separate on purpose and not by oversight: `@app/repo-checks` may import
 * `@apackdev/sdk` and `@apackdev/host` and nothing else (`LAYERS`, `scripts/check-import-specifiers.ts`), and
 * `repo-check-boundary.spec.ts` refuses the cross-package import that would share one copy. The checks
 * below are what keep this copy honest.
 */
import ts from 'typescript';

/** A source file's code, with block comments and line comments removed */
export function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      // Quote-aware, so a `//` inside a string literal is not read as the start of a comment
      let quote: string | null = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]!;
        if (quote !== null) {
          if (ch === '\\') i += 1;
          else if (ch === quote) quote = null;
        } else if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
        else if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** Whether a config's code calls the named helper, rather than merely naming it in a comment */
export const callsHelper = (source: string, helper: string): boolean =>
  new RegExp(`\\b${helper}\\s*\\(`).test(codeOf(source));

/** Whether a config's code declares a key of its own, such as `timeout:` or `test:` */
export const declaresKey = (source: string, key: string): boolean =>
  new RegExp(`\\b${key}\\s*:`).test(codeOf(source));

/** A helper argument delegates configuration; an outer/spread override restates it. */
export function declaresKeyOutsideHelpers(source: string, key: string, helpers: readonly string[]): boolean {
  const file = ts.createSourceFile('config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  function delegated(node: ts.Node): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isCallExpression(parent)) continue;
      const callee = parent.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
      if (name && helpers.includes(name) && parent.arguments.some(argument => argument.pos <= node.pos && node.end <= argument.end)) return true;
    }
    return false;
  }
  function visit(node: ts.Node): void {
    if (found) return;
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node))
      && ts.isObjectLiteralExpression(node.parent)) {
      const name = node.name;
      const literal = ts.isComputedPropertyName(name) ? name.expression : name;
      if ((ts.isIdentifier(literal) || ts.isStringLiteralLike(literal)) && literal.text === key && !delegated(node)) found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
