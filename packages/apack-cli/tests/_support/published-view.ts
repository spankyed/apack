import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect } from 'vitest';
import { readPackBuild } from '@apackdev/host/packs';

/** This fixture publishes one deferred view; inspect the chunk its entry actually imports. */
export function publishedViewCode(root: string): string {
  const output = path.join(root, 'dist');
  const entry = fs.readFileSync(path.join(output, 'runtime/fe.js'), 'utf8');
  const targets: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) targets.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(ts.createSourceFile('fe.js', entry, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
  expect(targets).toHaveLength(1);
  const asset = path.posix.normalize(path.posix.join('runtime', targets[0]!));
  expect(Object.hasOwn(readPackBuild(output).integrity.files, asset)).toBe(true);
  return fs.readFileSync(path.join(output, asset), 'utf8');
}
