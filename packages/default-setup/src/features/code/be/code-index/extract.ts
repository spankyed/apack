// A source file's definitions, read from its syntax tree: what the code index stores and the semantic diff compares.
//
// A definition's two hashes are taken over the tree, not the text, so a reformat, a moved comment or a changed quote
// style moves neither. Parsing is cheap enough to repeat (`docs/plans/code-index.md`, What this repository looks like),
// which is why nothing here is cached and a row holds no position: a position is read by parsing the file again.
import { createHash } from 'node:crypto';
import { parse, type ParserPlugin } from '@babel/parser';
import { parse as parseSfc } from '@vue/compiler-dom';

export type SymbolKind = 'function' | 'class' | 'method' | 'property' | 'variable' | 'interface' | 'type' | 'enum' | 'namespace' | 'component';
export type CodeLanguage = 'typescript' | 'tsx' | 'javascript' | 'vue';

export interface Definition {
  kind: SymbolKind;
  name: string;
  /** Its name inside the file: `Thing.method`, unique with `ordinal` */
  local: string;
  /** Its place among the definitions of this file sharing `local`: an overload, a getter beside its setter */
  ordinal: number;
  exported: boolean;
  /** Its header as written, with whitespace collapsed and at most `SIGNATURE_LIMIT` characters */
  signature: string;
  signatureHash: string;
  bodyHash: string;
  line: number;
  column: number;
  endLine: number;
}

/** A file's definitions, or why it has none */
export type Extraction = { ok: true; definitions: Definition[] } | { ok: false; error: string };

const SIGNATURE_LIMIT = 240;

const LANGUAGES: Readonly<Record<string, CodeLanguage>> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'tsx', '.jsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.vue': 'vue',
};

/** The language a path is extracted as, or `null` for a file the index doesn't read */
export function languageOf(path: string): CodeLanguage | null {
  const dot = path.lastIndexOf('.');
  if (dot === -1 || path.lastIndexOf('/') > dot) return null;
  return LANGUAGES[path.slice(dot)] ?? null;
}

// A syntax tree node: the fields read here are named, and the walk reaches the rest by key
interface AstNode {
  type: string;
  start: number;
  end: number;
  loc: { start: { line: number; column: number }; end: { line: number } };
  // Each node type has its own fields
  [field: string]: any;
}

const POSITIONAL = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'errors', 'tokens']);
const OMIT_BODY: ReadonlySet<string> = new Set(['body']);
const OMIT_VALUE: ReadonlySet<string> = new Set(['value']);
const NOTHING: ReadonlySet<string> = new Set();
const NO_NODES: ReadonlySet<AstNode> = new Set();

function writeTree(value: unknown, parts: string[], omit: ReadonlySet<string>, skip: ReadonlySet<AstNode>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    parts.push('[');
    for (const item of value) writeTree(item, parts, NOTHING, skip);
    parts.push(']');
    return;
  }
  if (typeof value !== 'object') {
    parts.push(String(value));
    return;
  }
  if (skip.has(value as AstNode)) return;
  parts.push('(');
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (POSITIONAL.has(key) || omit.has(key)) continue;
    parts.push(key);
    writeTree(row[key], parts, NOTHING, skip);
  }
  parts.push(')');
}

const digest = (text: string) => createHash('sha1').update(text).digest('base64url').slice(0, 16);

/** A hash of the tree under `nodes`, without positions or comments. `omit` names fields left out of each top-level node */
function hashTree(nodes: readonly unknown[], omit: ReadonlySet<string> = NOTHING, skip: ReadonlySet<AstNode> = NO_NODES): string {
  const parts: string[] = [];
  for (const node of nodes) writeTree(node, parts, omit, skip);
  return parts.length ? digest(parts.join('\u0000')) : '';
}

const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);
const WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'TypeCastExpression']);

const isFunctionMember = (property: AstNode): boolean => property.type === 'ObjectMethod'
  || (property.type === 'ObjectProperty' && FUNCTION_TYPES.has(unwrap(property.value)?.type ?? ''));

/** An initializer under any `as`, `satisfies` or `!` it was written with */
function unwrap(node: AstNode | null | undefined): AstNode | null {
  let current = node ?? null;
  while (current && WRAPPERS.has(current.type)) current = current.expression as AstNode;
  return current;
}

class FileWalk {
  readonly definitions: Omit<Definition, 'ordinal'>[] = [];
  private readonly exportedNames = new Set<string>();

  constructor(private readonly source: string) {}

  /** Collapsed text of `[from, to)`, cut to the limit */
  private header(from: number, to: number): string {
    const text = this.source.slice(from, to).replace(/\s+/g, ' ').trim();
    return text.length > SIGNATURE_LIMIT ? `${text.slice(0, SIGNATURE_LIMIT)}…` : text;
  }

  private add(
    fields: { kind: SymbolKind; name: string; scope: string; exported: boolean; node: AstNode; signatureEnd: number; signatureHash: string; bodyHash: string },
  ): void {
    const { kind, name, scope, exported, node, signatureEnd, signatureHash, bodyHash } = fields;
    this.definitions.push({
      kind, name, local: `${scope}${name}`, exported,
      signature: this.header(node.start, signatureEnd),
      signatureHash, bodyHash,
      line: node.loc.start.line, column: node.loc.start.column, endLine: node.loc.end.line,
    });
  }

  walkProgram(body: readonly AstNode[]): void {
    this.walkStatements(body, '', false);
    for (const definition of this.definitions) {
      const [head] = definition.local.split('.');
      if (head !== undefined && this.exportedNames.has(head)) definition.exported = true;
    }
  }

  private walkStatements(body: readonly AstNode[], scope: string, exported: boolean): void {
    for (const statement of body) this.walkStatement(statement, scope, exported);
  }

  private walkStatement(statement: AstNode, scope: string, exported: boolean): void {
    switch (statement.type) {
      case 'ExportNamedDeclaration':
        if (statement.declaration) this.walkStatement(statement.declaration, scope, true);
        else if (!statement.source) for (const specifier of statement.specifiers as AstNode[]) {
          if (specifier.local?.name) this.exportedNames.add(specifier.local.name);
        }
        return;
      case 'ExportDefaultDeclaration':
        this.walkDefault(statement, scope);
        return;
      case 'FunctionDeclaration':
      case 'TSDeclareFunction':
        this.addFunction(statement, statement.id?.name ?? 'default', scope, exported);
        return;
      case 'ClassDeclaration':
        this.addClass(statement, statement.id?.name ?? 'default', scope, exported);
        return;
      case 'TSInterfaceDeclaration':
        this.addWhole(statement, 'interface', statement.id.name, scope, exported, statement.body.start);
        return;
      case 'TSTypeAliasDeclaration':
        this.addWhole(statement, 'type', statement.id.name, scope, exported, statement.end);
        return;
      case 'TSEnumDeclaration':
        this.addWhole(statement, 'enum', statement.id.name, scope, exported, statement.id.end);
        return;
      case 'TSModuleDeclaration':
        this.walkNamespace(statement, scope, exported);
        return;
      case 'VariableDeclaration':
        for (const declarator of statement.declarations as AstNode[]) this.walkDeclarator(statement, declarator, scope, exported);
        return;
      case 'ExpressionStatement':
        this.walkCommonJsExport(statement);
        return;
      default:
    }
  }

  private walkDefault(statement: AstNode, scope: string): void {
    const declaration = statement.declaration as AstNode;
    const value = unwrap(declaration);
    if (declaration.type === 'FunctionDeclaration' || declaration.type === 'TSDeclareFunction') this.addFunction(declaration, declaration.id?.name ?? 'default', scope, true);
    else if (declaration.type === 'ClassDeclaration') this.addClass(declaration, declaration.id?.name ?? 'default', scope, true);
    else if (value) this.addValue(statement, value, [], 'default', scope, true);
  }

  private walkNamespace(statement: AstNode, scope: string, exported: boolean): void {
    const name = statement.id?.name ?? statement.id?.value ?? 'global';
    this.addWhole(statement, 'namespace', name, scope, exported, statement.body?.start ?? statement.end, true);
    if (statement.body?.type === 'TSModuleBlock') this.walkStatements(statement.body.body, `${scope}${name}.`, false);
  }

  private walkDeclarator(declaration: AstNode, declarator: AstNode, scope: string, exported: boolean): void {
    const id = declarator.id as AstNode;
    if (id.type === 'Identifier') {
      this.addValue(declarator, unwrap(declarator.init), [id], id.name, scope, exported, declaration);
      return;
    }
    // `const { a, b } = x`: each name it binds, holding what the whole pattern was given
    for (const bound of boundNames(id)) {
      this.add({
        kind: 'variable', name: bound.name, scope, exported, node: bound, signatureEnd: bound.end,
        signatureHash: hashTree([declaration.kind, bound.name]), bodyHash: hashTree([declarator.init]),
      });
    }
  }

  /** `exports.x = ...`, `module.exports.x = ...`, `module.exports = { ... }` */
  private walkCommonJsExport(statement: AstNode): void {
    const expression = statement.expression as AstNode;
    if (expression.type !== 'AssignmentExpression' || expression.operator !== '=' || expression.left.type !== 'MemberExpression') return;
    const left = expression.left as AstNode;
    if (left.computed || left.property.type !== 'Identifier') return;
    const isModuleExports = (node: AstNode) => node.type === 'MemberExpression' && !node.computed
      && node.object.type === 'Identifier' && node.object.name === 'module' && node.property.name === 'exports';
    const isExports = (node: AstNode) => (node.type === 'Identifier' && node.name === 'exports') || isModuleExports(node);
    if (isExports(left.object)) this.addValue(statement, unwrap(expression.right), [left.property], left.property.name, '', true);
    else if (isModuleExports(left)) this.addValue(statement, unwrap(expression.right), [], 'default', '', true);
  }

  private addFunction(node: AstNode, name: string, scope: string, exported: boolean): void {
    this.add({
      kind: 'function', name, scope, exported, node, signatureEnd: node.body?.start ?? node.end,
      signatureHash: hashTree([node], OMIT_BODY), bodyHash: hashTree([node.body]),
    });
  }

  private addWhole(node: AstNode, kind: SymbolKind, name: string, scope: string, exported: boolean, signatureEnd: number, omitBody = false): void {
    this.add({
      kind, name, scope, exported, node, signatureEnd,
      signatureHash: hashTree([node], omitBody ? OMIT_BODY : NOTHING), bodyHash: '',
    });
  }

  /** A named value: a function, class or object by what it holds, and otherwise a variable */
  private addValue(node: AstNode, value: AstNode | null, ids: readonly AstNode[], name: string, scope: string, exported: boolean, declaration?: AstNode): void {
    const start = declaration ?? node;
    const asWritten = { ...node, start: start.start, loc: start.loc } as AstNode;
    const keyword = declaration?.kind;
    if (value && FUNCTION_TYPES.has(value.type)) {
      const typed = hashTree([keyword, ids]) + hashTree([value], OMIT_BODY);
      this.add({
        kind: 'function', name, scope, exported, node: asWritten, signatureEnd: value.body.start,
        signatureHash: digest(typed), bodyHash: hashTree([value.body]),
      });
      return;
    }
    if (value?.type === 'ClassExpression') {
      this.addClass({ ...value, start: start.start, loc: start.loc } as AstNode, name, scope, exported);
      return;
    }
    if (value?.type === 'ObjectExpression') {
      const members = (value.properties as AstNode[]).filter(property => isFunctionMember(property) && this.memberName(property) !== null);
      this.add({
        kind: 'variable', name, scope, exported, node: asWritten, signatureEnd: value.start,
        signatureHash: hashTree([keyword, ids]), bodyHash: hashTree([value], NOTHING, new Set(members)),
      });
      for (const member of members) this.addObjectMember(member, `${scope}${name}.`, exported);
      return;
    }
    this.add({
      kind: 'variable', name, scope, exported, node: asWritten, signatureEnd: value?.start ?? node.end,
      signatureHash: hashTree([keyword, ids]), bodyHash: hashTree([value]),
    });
  }

  /** A function-valued member of an object: its own definition, which leaves the object's body hash */
  private addObjectMember(property: AstNode, scope: string, exported: boolean): void {
    const name = this.memberName(property)!;
    const value = property.type === 'ObjectMethod' ? property : unwrap(property.value)!;
    const header = property.type === 'ObjectMethod' ? hashTree([property], OMIT_BODY) : digest(hashTree([name]) + hashTree([value], OMIT_BODY));
    this.add({
      kind: 'method', name, scope, exported, node: property, signatureEnd: value.body.start,
      signatureHash: header, bodyHash: hashTree([value.body]),
    });
  }

  private addClass(node: AstNode, name: string, scope: string, exported: boolean): void {
    // A member is its own definition, so a changed method doesn't read as a changed class
    this.add({
      kind: 'class', name, scope, exported, node, signatureEnd: node.body.start,
      signatureHash: hashTree([node], OMIT_BODY), bodyHash: '',
    });
    const inner = `${scope}${name}.`;
    for (const member of node.body.body as AstNode[]) this.addClassMember(member, inner, exported);
  }

  private addClassMember(member: AstNode, scope: string, exported: boolean): void {
    const name = this.memberName(member);
    if (name === null) return;
    switch (member.type) {
      case 'ClassMethod':
      case 'ClassPrivateMethod':
      case 'TSDeclareMethod':
        this.add({
          kind: 'method', name, scope, exported, node: member, signatureEnd: member.body?.start ?? member.end,
          signatureHash: hashTree([member], OMIT_BODY), bodyHash: hashTree([member.body]),
        });
        return;
      case 'ClassProperty':
      case 'ClassPrivateProperty':
      case 'ClassAccessorProperty': {
        const value = unwrap(member.value);
        if (value && FUNCTION_TYPES.has(value.type)) {
          this.add({
            kind: 'method', name, scope, exported, node: member, signatureEnd: value.body.start,
            signatureHash: digest(hashTree([member], OMIT_VALUE) + hashTree([value], OMIT_BODY)), bodyHash: hashTree([value.body]),
          });
        } else {
          this.add({
            kind: 'property', name, scope, exported, node: member, signatureEnd: member.value?.start ?? member.end,
            signatureHash: hashTree([member], OMIT_VALUE), bodyHash: hashTree([member.value]),
          });
        }
        return;
      }
      default:
    }
  }

  /** A member's name as written: a literal key's value, `#private`, a computed key's source; `null` for a spread */
  private memberName(member: AstNode): string | null {
    const key = member.key as AstNode | undefined;
    if (!key) return null;
    if (member.computed) return `[${this.source.slice(key.start, key.end)}]`;
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'PrivateName') return `#${key.id.name}`;
    if (key.type === 'StringLiteral' || key.type === 'NumericLiteral') return String(key.value);
    return null;
  }
}

function boundNames(pattern: AstNode): AstNode[] {
  switch (pattern.type) {
    case 'Identifier': return [pattern];
    case 'ObjectPattern': return (pattern.properties as AstNode[]).flatMap(property => boundNames(property.type === 'RestElement' ? property.argument : property.value));
    case 'ArrayPattern': return (pattern.elements as (AstNode | null)[]).flatMap(element => (element ? boundNames(element) : []));
    case 'AssignmentPattern': return boundNames(pattern.left);
    case 'RestElement': return boundNames(pattern.argument);
    default: return [];
  }
}

function pluginsFor(language: CodeLanguage, scriptLang: string | undefined): ParserPlugin[] {
  const jsx = language === 'tsx' || language === 'javascript' || scriptLang === 'tsx' || scriptLang === 'jsx';
  return ['typescript', 'decorators', ...(jsx ? ['jsx' as const] : [])];
}

function walkScript(walk: FileWalk, code: string, plugins: ParserPlugin[], position?: { line: number; column: number; index: number }): void {
  const file = parse(code, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
    allowUndeclaredExports: true,
    allowSuperOutsideMethod: true,
    plugins,
    ...(position && { startLine: position.line, startColumn: position.column, startIndex: position.index }),
  });
  walk.walkProgram(file.program.body as unknown as AstNode[]);
}

/** A single-file component's definitions: the component itself, whose body is its template, and its script blocks' */
function walkVue(walk: FileWalk, source: string, path: string): void {
  const root = parseSfc(source, { parseMode: 'sfc', onError: () => {}, onWarn: () => {} });
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.vue$/, '');
  let template = '';
  const scripts: { code: string; lang: string | undefined; position: { line: number; column: number; index: number } }[] = [];
  for (const child of root.children) {
    if (child.type !== 1) continue;
    if (child.tag === 'template') template = child.loc.source.replace(/\s+/g, ' ');
    if (child.tag !== 'script') continue;
    const text = child.children[0];
    if (text?.type !== 2) continue;
    const attribute = child.props.find(prop => prop.type === 6 && prop.name === 'lang');
    const lang = attribute?.type === 6 ? attribute.value?.content : undefined;
    scripts.push({ code: text.content, lang, position: { line: text.loc.start.line, column: text.loc.start.column - 1, index: text.loc.start.offset } });
  }
  walk.definitions.push({
    kind: 'component', name, local: `<${name}>`, exported: true, signature: `<${name}>`,
    signatureHash: '', bodyHash: template ? digest(template) : '',
    line: 1, column: 0, endLine: source.split('\n').length,
  });
  for (const script of scripts) walkScript(walk, script.code, pluginsFor('vue', script.lang), script.position);
}

/** Every definition in a file's text, in file order */
export function extractFile(path: string, source: string): Extraction {
  const language = languageOf(path);
  if (!language) return { ok: false, error: 'no language' };
  const walk = new FileWalk(source);
  try {
    if (language === 'vue') walkVue(walk, source, path);
    else walkScript(walk, source, pluginsFor(language, undefined));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const seen = new Map<string, number>();
  const definitions = walk.definitions.map((definition): Definition => {
    const ordinal = seen.get(definition.local) ?? 0;
    seen.set(definition.local, ordinal + 1);
    return { ...definition, ordinal };
  });
  return { ok: true, definitions };
}

// One of every form the extractor reads. Its result is the stamp, so any change to what the extractor answers changes
// the stamp and re-extracts each project without anyone raising a version
const STAMP_FIXTURES: readonly (readonly [string, string])[] = [
  ['stamp.ts', `
    /** doc */ export function f<T>(a: T, b = 1): T { return a; }
    function over(a: string): void; function over(a: number): void; function over(a: unknown) { void a; }
    export class C<T> extends Base implements I { static s = 1; #p = 2; m(x: T) { return x; } get g() { return 1; } set g(v) { void v; } a = (y: number) => y; [k]() {} }
    export interface I { x: number } export type U = string | number; export enum E { A } namespace N { export const v = 1; }
    export const arrow = async (x: number): Promise<number> => x; const o = { m() {}, a: () => 1, v: 2 } as const; const { d, e: [h] } = source;
    export { o as renamed }; export default class {}
  `],
  ['stamp.cjs', 'exports.a = function a() {}; module.exports.b = () => 1; module.exports = { c() {} };'],
  ['stamp.tsx', 'export const View = (p: { a: string }) => <div>{p.a}</div>;'],
  ['stamp.vue', '<template><div @click="go">x</div></template>\n<script setup lang="ts">\nconst go = () => {};\n</script>\n<script>\nexport default { name: "x", data() { return {}; } };\n</script>'],
];

/** A hash of what the extractor answers over every form it reads */
export function extractorStamp(): string {
  return digest(JSON.stringify(STAMP_FIXTURES.map(([path, source]) => extractFile(path, source))));
}
