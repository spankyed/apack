// What a file's code says about other code: its imports, and each place it calls or refers to a name that isn't local
// to the function it is in. Read from the syntax tree, so it says what is written and nothing about types: `x.f()` is a
// member `f` of something called `x`, which only the resolver (`resolve.ts`) or a compiler can take further.
import { parse as parseSfc } from '@vue/compiler-dom';
import { parseExpression } from '@babel/parser';
import { extractFile, languageOf, parseScript, pluginsFor, type AstNode, type CodeLanguage, type Definition } from './extract.ts';

export interface ImportBinding {
  local: string;
  source: string;
  /** The name it has in `source`: `*` for a namespace, `default` for a default import */
  imported: string;
}

export interface Reexport {
  /** The name it has here, or `*` for `export * from` */
  exported: string;
  source: string;
  imported: string;
}

export type SiteKind = 'call' | 'reference' | 'inherit';
/** How a site is written, which is what decides how far syntax can take it */
export type SiteForm = 'bare' | 'member' | 'chain';

export interface Site {
  kind: SiteKind;
  form: SiteForm;
  /** As written: `['a', 'b', 'f']` for `a.b.f()`, starting at `this`, or at `?` where the head is an expression */
  path: readonly string[];
  /** The innermost definition it is in, as an index into `definitions`; `null` at a module's top level */
  caller: number | null;
  line: number;
  column: number;
}

export interface FileGraph {
  definitions: readonly Definition[];
  /** The local name of what importing this file's default gives */
  defaultLocal: string | null;
  imports: readonly ImportBinding[];
  reexports: readonly Reexport[];
  /** Module specifiers named by a statement only (`import './x'`), and by every import and re-export: what the file needs */
  sources: readonly string[];
  sites: readonly Site[];
}

// Fields that hold no code that runs, so a walk doesn't enter them
const TYPE_ONLY = new Set(['typeAnnotation', 'typeParameters', 'typeArguments', 'returnType', 'predicate', 'implements', 'superTypeParameters', 'superTypeArguments']);
const SKIPPED_KEYS = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'errors', 'tokens']);

function boundBy(pattern: AstNode | null | undefined, into: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier': into.add(pattern.name); return;
    case 'ObjectPattern': for (const property of pattern.properties as AstNode[]) boundBy(property.type === 'RestElement' ? property.argument : property.value, into); return;
    case 'ArrayPattern': for (const element of pattern.elements as (AstNode | null)[]) boundBy(element, into); return;
    case 'AssignmentPattern': boundBy(pattern.left, into); return;
    case 'RestElement': boundBy(pattern.argument, into); return;
    case 'TSParameterProperty': boundBy(pattern.parameter, into); return;
    default:
  }
}

/** What a list of statements declares in its own block */
function declaredIn(statements: readonly AstNode[], into: Set<string>): void {
  for (const raw of statements) {
    const statement = raw.type === 'ExportNamedDeclaration' && raw.declaration ? raw.declaration as AstNode : raw;
    if (statement.type === 'VariableDeclaration') for (const declarator of statement.declarations as AstNode[]) boundBy(declarator.id, into);
    else if ((statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration' || statement.type === 'TSDeclareFunction') && statement.id) into.add(statement.id.name);
  }
}

/** Finds the innermost definition holding an offset. Definitions nest, so the last that starts before it and ends after it is it */
function createCallerLookup(definitions: readonly Definition[]): (offset: number) => number | null {
  const order = definitions.map((definition, index) => ({ definition, index })).sort((a, b) => a.definition.start - b.definition.start || b.definition.end - a.definition.end);
  return (offset) => {
    let low = 0;
    let high = order.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (order[middle]!.definition.start <= offset) low = middle + 1; else high = middle - 1;
    }
    for (let i = high; i >= 0; i--) if (order[i]!.definition.end > offset) return order[i]!.index;
    return null;
  };
}

class SiteWalk {
  readonly sites: Site[] = [];
  readonly imports: ImportBinding[] = [];
  readonly reexports: Reexport[] = [];
  readonly sources = new Set<string>();
  private readonly scopes: Set<string>[] = [];

  constructor(private readonly callerAt: (offset: number) => number | null) {}

  private isLocal(name: string): boolean {
    return this.scopes.some(scope => scope.has(name));
  }

  private addSite(kind: SiteKind, path: readonly string[], node: AstNode): void {
    // A local alone is nothing outside its function. A member of one is: `array.map()` calls something, of a type syntax
    // can't read, so it is kept as a site with a head that resolves to nothing
    const local = path[0] !== 'this' && path[0] !== '?' && this.isLocal(path[0]!);
    if (local && path.length === 1) return;
    if (local) path = ['?', ...path.slice(1)];
    this.sites.push({
      kind, path, form: path.length === 1 ? 'bare' : path.length === 2 ? 'member' : 'chain',
      caller: this.callerAt(node.start), line: node.loc.start.line, column: node.loc.start.column,
    });
  }

  /** `a.b.c` as a path; a computed step or a call in the chain leaves what is after it headed by `?` */
  private pathOf(node: AstNode): string[] | null {
    switch (node.type) {
      case 'Identifier': return [node.name];
      case 'ThisExpression': return ['this'];
      case 'Super': return ['this'];
      case 'TSNonNullExpression':
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression': return this.pathOf(node.expression);
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        if (node.computed || node.property.type === 'PrivateName') {
          if (node.property.type === 'PrivateName') return [...(this.pathOf(node.object) ?? ['?']), `#${node.property.id.name}`];
          return null;
        }
        return [...(this.pathOf(node.object) ?? ['?']), node.property.name];
      }
      default: return null;
    }
  }

  walkProgram(program: AstNode): void {
    for (const statement of program.body as AstNode[]) this.readModuleStatement(statement);
    this.walk(program.body);
  }

  private readModuleStatement(statement: AstNode): void {
    if (statement.type === 'ImportDeclaration') {
      this.sources.add(statement.source.value);
      if (statement.importKind === 'type') return;
      for (const specifier of statement.specifiers as AstNode[]) {
        if (specifier.importKind === 'type') continue;
        const imported = specifier.type === 'ImportNamespaceSpecifier' ? '*'
          : specifier.type === 'ImportDefaultSpecifier' ? 'default'
            : (specifier.imported.name ?? specifier.imported.value);
        this.imports.push({ local: specifier.local.name, source: statement.source.value, imported });
      }
    } else if (statement.type === 'ExportAllDeclaration') {
      this.sources.add(statement.source.value);
      this.reexports.push({ exported: statement.exported?.name ?? '*', source: statement.source.value, imported: '*' });
    } else if (statement.type === 'ExportNamedDeclaration' && statement.source) {
      this.sources.add(statement.source.value);
      for (const specifier of statement.specifiers as AstNode[]) {
        const exported = specifier.exported.name ?? specifier.exported.value;
        const imported = specifier.type === 'ExportNamespaceSpecifier' ? '*' : specifier.local.name ?? specifier.local.value;
        this.reexports.push({ exported, source: statement.source.value, imported });
      }
    }
  }

  /** A function or block's own names are in scope for all of it, which is when they are hoisted or not alike */
  private withScope(names: Set<string>, body: () => void): void {
    this.scopes.push(names);
    body();
    this.scopes.pop();
  }

  private walk(value: unknown): void {
    if (Array.isArray(value)) { for (const item of value) this.walk(item); return; }
    if (value === null || typeof value !== 'object' || !('type' in value)) return;
    this.visit(value as AstNode);
  }

  private walkFields(node: AstNode, except: readonly string[] = []): void {
    for (const key of Object.keys(node)) {
      if (SKIPPED_KEYS.has(key) || TYPE_ONLY.has(key) || except.includes(key)) continue;
      this.walk(node[key]);
    }
  }

  private visit(node: AstNode): void {
    if (node.type.startsWith('TS') && !['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSParameterProperty', 'TSExportAssignment', 'TSModuleBlock', 'TSModuleDeclaration', 'TSEnumDeclaration'].includes(node.type)) return;
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
        return;
      case 'ExportNamedDeclaration':
        if (node.source) return;
        this.walk(node.declaration);
        for (const specifier of node.specifiers as AstNode[]) if (specifier.local?.type === 'Identifier') this.addSite('reference', [specifier.local.name], specifier);
        return;
      case 'CallExpression':
      case 'OptionalCallExpression':
      case 'NewExpression': {
        const path = this.pathOf(node.callee);
        if (path) this.addSite('call', path, node.callee); else this.walk(node.callee);
        if (path && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression')) this.walkCalleeObject(node.callee);
        this.walk(node.arguments);
        return;
      }
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        const path = this.pathOf(node);
        if (path && path[0] !== '?') this.addSite('reference', path, node);
        else { this.walk(node.object); if (node.computed) this.walk(node.property); }
        if (path && node.computed) this.walk(node.property);
        return;
      }
      case 'Identifier':
        this.addSite('reference', [node.name], node);
        return;
      case 'JSXOpeningElement': {
        const name = node.name as AstNode;
        if (name.type === 'JSXIdentifier' && /^[A-Z]/.test(name.name)) this.addSite('call', [name.name], name);
        this.walk(node.attributes);
        return;
      }
      case 'JSXAttribute': this.walk(node.value); return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ObjectMethod':
      case 'ClassMethod':
      case 'ClassPrivateMethod': {
        const names = new Set<string>();
        for (const parameter of node.params as AstNode[]) boundBy(parameter, names);
        if (node.type === 'FunctionExpression' && node.id) names.add(node.id.name);
        if (node.computed) this.walk(node.key);
        this.withScope(names, () => {
          for (const parameter of node.params as AstNode[]) this.walkPatternDefaults(parameter);
          this.walk(node.body);
        });
        return;
      }
      case 'BlockStatement':
      case 'StaticBlock':
      case 'TSModuleBlock': {
        const names = new Set<string>();
        declaredIn(node.body, names);
        this.withScope(names, () => this.walk(node.body));
        return;
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const names = new Set<string>();
        const head = (node.init ?? node.left) as AstNode | null;
        if (head?.type === 'VariableDeclaration') for (const declarator of head.declarations as AstNode[]) boundBy(declarator.id, names);
        this.withScope(names, () => this.walkFields(node));
        return;
      }
      case 'CatchClause': {
        const names = new Set<string>();
        boundBy(node.param, names);
        this.withScope(names, () => this.walk(node.body));
        return;
      }
      case 'SwitchStatement': {
        const names = new Set<string>();
        for (const clause of node.cases as AstNode[]) declaredIn(clause.consequent, names);
        this.walk(node.discriminant);
        this.withScope(names, () => this.walk(node.cases));
        return;
      }
      case 'VariableDeclarator':
        this.walkPatternDefaults(node.id);
        this.walk(node.init);
        return;
      case 'ClassDeclaration':
      case 'ClassExpression': {
        if (node.superClass) {
          const path = this.pathOf(node.superClass);
          if (path) this.addSite('inherit', path, node.superClass); else this.walk(node.superClass);
        }
        this.walk(node.decorators);
        this.walk(node.body);
        return;
      }
      case 'ClassProperty':
      case 'ClassPrivateProperty':
      case 'ClassAccessorProperty':
        if (node.computed) this.walk(node.key);
        this.walk(node.decorators);
        this.walk(node.value);
        return;
      case 'ObjectProperty':
        if (node.computed) this.walk(node.key);
        this.walk(node.value);
        return;
      case 'LabeledStatement': this.walk(node.body); return;
      case 'BreakStatement':
      case 'ContinueStatement': return;
      case 'TSEnumDeclaration': return;
      default:
        this.walkFields(node);
    }
  }

  private walkCalleeObject(callee: AstNode): void {
    let object = callee.object as AstNode | undefined;
    while (object && (object.type === 'MemberExpression' || object.type === 'OptionalMemberExpression')) {
      if (object.computed) this.walk(object.property);
      object = object.object as AstNode;
    }
    if (object && object.type !== 'Identifier' && object.type !== 'ThisExpression' && object.type !== 'Super') this.walk(object);
  }

  /** A pattern binds names, and its defaults run: `{ a = f() }` calls `f` */
  private walkPatternDefaults(pattern: AstNode | null | undefined): void {
    if (!pattern) return;
    switch (pattern.type) {
      case 'ObjectPattern': for (const property of pattern.properties as AstNode[]) { if (property.computed) this.walk(property.key); this.walkPatternDefaults(property.type === 'RestElement' ? property.argument : property.value); } return;
      case 'ArrayPattern': for (const element of pattern.elements as (AstNode | null)[]) this.walkPatternDefaults(element); return;
      case 'AssignmentPattern': this.walkPatternDefaults(pattern.left); this.walk(pattern.right); return;
      case 'RestElement': this.walkPatternDefaults(pattern.argument); return;
      case 'TSParameterProperty': this.walkPatternDefaults(pattern.parameter); return;
      default:
    }
  }

  /** A Vue template: each component tag is a use, each directive's expression is code running in the component */
  walkTemplate(children: readonly TemplateNode[], caller: number): void {
    for (const child of children) {
      if (child.type !== 1) { if (child.type === 5 && child.content?.content) this.readTemplateExpression(child.content, caller); continue; }
      if (child.tagType === 1) {
        const name = child.tag.includes('-') ? child.tag.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('') : child.tag;
        this.sites.push({ kind: 'call', form: 'bare', path: [name], caller, line: child.loc.start.line, column: child.loc.start.column - 1 });
      }
      for (const prop of child.props) if (prop.type === 7 && prop.exp?.content) this.readTemplateExpression(prop.exp, caller);
      this.walkTemplate(child.children, caller);
    }
  }

  private readTemplateExpression(expression: { content: string; loc: { start: { line: number; column: number } } }, caller: number): void {
    let tree: AstNode;
    // A handler may be statements, and `v-for` isn't an expression at all; those say nothing a bare parse can read
    try { tree = parseExpression(expression.content, { plugins: ['typescript'], errorRecovery: true }) as unknown as AstNode; }
    catch { return; }
    const before = this.sites.length;
    this.visit(tree);
    for (let i = before; i < this.sites.length; i++) {
      const site = this.sites[i]!;
      this.sites[i] = { ...site, caller, line: expression.loc.start.line, column: expression.loc.start.column - 1 };
    }
  }
}

interface TemplateNode {
  type: number;
  tag: string;
  tagType: number;
  props: { type: number; exp?: { content: string; loc: { start: { line: number; column: number } } } }[];
  children: TemplateNode[];
  content?: { content: string; loc: { start: { line: number; column: number } } };
  loc: { start: { line: number; column: number } };
}

/** Everything a file defines and refers to, or why it can't be read */
export function extractGraph(path: string, source: string): ({ ok: true } & FileGraph) | { ok: false; error: string } {
  const language: CodeLanguage | null = languageOf(path);
  const extraction = extractFile(path, source);
  if (!extraction.ok || !language) return { ok: false, error: extraction.ok ? 'no language' : extraction.error };
  const { definitions } = extraction;
  const walk = new SiteWalk(createCallerLookup(definitions));
  try {
    if (language === 'vue') {
      const root = parseSfc(source, { parseMode: 'sfc', onError: () => {}, onWarn: () => {} });
      for (const child of root.children) {
        if (child.type !== 1 || child.tag !== 'script') continue;
        const text = child.children[0];
        if (text?.type !== 2) continue;
        const attribute = child.props.find(prop => prop.type === 6 && prop.name === 'lang');
        const lang = attribute?.type === 6 ? attribute.value?.content : undefined;
        walk.walkProgram(parseScript(text.content, pluginsFor('vue', lang), { line: text.loc.start.line, column: text.loc.start.column - 1, index: text.loc.start.offset }));
      }
      for (const child of root.children) {
        if (child.type === 1 && child.tag === 'template') walk.walkTemplate(child.children as unknown as TemplateNode[], 0);
      }
    } else {
      walk.walkProgram(parseScript(source, pluginsFor(language, undefined)));
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, definitions, defaultLocal: extraction.defaultLocal, imports: walk.imports, reexports: walk.reexports, sources: [...walk.sources], sites: walk.sites };
}

/** The names a file asks other files for: what changes in those files can change this one's edges */
export function wantedNamesOf(graph: FileGraph): string[] {
  const wanted = new Set<string>();
  const namespaces = new Set<string>();
  for (const binding of graph.imports) {
    if (binding.imported === '*') namespaces.add(binding.local); else wanted.add(binding.imported);
  }
  for (const site of graph.sites) if (namespaces.has(site.path[0]!) && site.path[1]) wanted.add(site.path[1]);
  for (const reexport of graph.reexports) if (reexport.imported !== '*') wanted.add(reexport.imported);
  return [...wanted].sort();
}
