#!/usr/bin/env node
/**
 * AST codemod: rewrites Wave 1 XState `defineSystem<Contract>()` backend machines to `@apackdev/state`.
 *
 * Implements the §2.2 AST rewrite rules and §2.3 bail-out rules from the Phase 2 codemod spec.
 * Before writing any file, inspects the full AST and refuses to emit code if any bail-out rule triggers.
 *
 * Usage:
 *   node scripts/codemod-xstate-to-state.mts --audit [files...]
 *   node scripts/codemod-xstate-to-state.mts --dry-run <file...>
 *   node scripts/codemod-xstate-to-state.mts --write <file...>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export type BailRule =
  | 'BAIL_INVOKE'
  | 'BAIL_AFTER'
  | 'BAIL_GUARD_CHAIN'
  | 'BAIL_ENTRY_EXIT'
  | 'BAIL_SPAWN_CHILD'
  | 'BAIL_NESTED_STATES'
  | 'BAIL_SIDE_EFFECT_IN_ASSIGN'
  | 'BAIL_ACTION_CHAIN_READS_PRIOR_ASSIGN'
  | 'BAIL_CLIENT_OR_ROLE'
  | 'BAIL_META_OR_TAGS'
  | 'BAIL_TRANSITION_REF'
  | 'BAIL_EXTERNAL_HELPER_SENDS'
  | 'BAIL_UNSUPPORTED_MACHINE';

export interface BailDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly rule: BailRule;
  readonly snippet: string;
}

export interface FileCodemodResult {
  readonly file: string;
  readonly status: 'CONVERTIBLE' | 'BAIL-OUT';
  readonly diagnostics: readonly BailDiagnostic[];
  readonly output?: string;
}

const HOST_LIFECYCLE_EVENTS = new Set([
  'SEND_STATE',
  'CLIENT_CONNECTED',
  'PACK_CHANGED',
  'FEATURE_SETTINGS_UPDATED',
  'DATA_REPLACED',
  'DATA_CHANGED_ELSEWHERE',
]);

const INVOKE_CREATORS = new Set(['fromCallback', 'fromPromise', 'fromOutcome', 'fromAsk']);
const GUARD_COMBINATORS = new Set(['and', 'or', 'not']);
const CHILD_ACTORS_IDENTIFIERS = new Set([
  'spawnChild',
  'stopChild',
  'sendTo',
  'sendParent',
  'getParentContext',
  'notifySurfaceActor',
]);
const SEND_VERBS = new Set(['tell', 'broadcast', 'sendToSurface', 'sendToWindow']);

function oneLineSnippet(node: ts.Node, sf: ts.SourceFile): string {
  const raw = node.getText(sf).replace(/\s+/g, ' ').trim();
  return raw.length > 84 ? `${raw.slice(0, 81)}...` : raw;
}

function propNameText(name: ts.PropertyName, sf: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText(sf);
}

function isObjectLiteralEmpty(obj: ts.ObjectLiteralExpression): boolean {
  return obj.properties.length === 0;
}

function isEmptyContextExpr(expr: ts.Expression): boolean {
  if (ts.isObjectLiteralExpression(expr)) return expr.properties.length === 0;
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    if (ts.isParenthesizedExpression(expr.body) && ts.isObjectLiteralExpression(expr.body.expression)) {
      return expr.body.expression.properties.length === 0;
    }
    if (ts.isObjectLiteralExpression(expr.body)) return expr.body.properties.length === 0;
    if (ts.isBlock(expr.body) && expr.body.statements.length === 1) {
      const stmt = expr.body.statements[0];
      if (ts.isReturnStatement(stmt) && stmt.expression && ts.isObjectLiteralExpression(stmt.expression)) {
        return stmt.expression.properties.length === 0;
      }
    }
  }
  return false;
}

function findObjectProperty(
  obj: ts.ObjectLiteralExpression,
  name: string,
  sf: ts.SourceFile,
): ts.PropertyAssignment | undefined {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && propNameText(prop.name, sf) === name) {
      return prop;
    }
  }
  return undefined;
}

interface ActionInfo {
  readonly name: string;
  readonly node: ts.Node;
  readonly initializer: ts.Expression;
  readonly isAssign: boolean;
  readonly assignedFields: ReadonlySet<string>;
  readonly readsContextFields: ReadonlySet<string>;
  readonly readsWholeContext: boolean;
  readonly isAsync: boolean;
  readonly usesChildActor: boolean;
}

interface ParsedMachine {
  readonly specVar?: string;
  readonly contractType?: string;
  readonly specDeclStmt?: ts.Statement;
  readonly answersVar?: string;
  readonly answersCall?: ts.CallExpression;
  readonly answersObject?: ts.ObjectLiteralExpression;
  readonly answersDeclStmt?: ts.Statement;
  readonly machineVar?: string;
  readonly machineDeclStmt?: ts.Statement;
  readonly setupConfig?: ts.ObjectLiteralExpression;
  readonly machineConfig?: ts.ObjectLiteralExpression;
  readonly entryDeclStmt?: ts.Statement;
  readonly defaultExportStmt?: ts.Statement;
  readonly actions: Map<string, ActionInfo>;
}

function collectAssignedFields(assignCall: ts.CallExpression, sf: ts.SourceFile): Set<string> {
  const fields = new Set<string>();
  const arg = assignCall.arguments[0];
  if (!arg) return fields;
  if (ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
        const name = propNameText(prop.name, sf);
        if (name) fields.add(name);
      }
    }
  } else if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    const body = ts.isParenthesizedExpression(arg.body) ? arg.body.expression : arg.body;
    if (ts.isObjectLiteralExpression(body)) {
      for (const prop of body.properties) {
        if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
          const name = propNameText(prop.name, sf);
          if (name) fields.add(name);
        }
      }
    }
  }
  return fields;
}

function collectContextReads(node: ts.Node, sf: ts.SourceFile): { fields: Set<string>; wholeContext: boolean } {
  const fields = new Set<string>();
  let wholeContext = false;
  const walk = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'context') {
      fields.add(n.name.text);
      return;
    }
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const name = n.propertyName ? propNameText(n.propertyName, sf) : ts.isIdentifier(n.name) ? n.name.text : undefined;
      if (name === 'context') {
        if (ts.isObjectBindingPattern(n.name)) {
          for (const el of n.name.elements) {
            const sub = el.propertyName ? propNameText(el.propertyName, sf) : ts.isIdentifier(el.name) ? el.name.text : undefined;
            if (sub) fields.add(sub);
          }
        } else {
          wholeContext = true;
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return { fields, wholeContext };
}

function inspectActionInitializer(name: string, prop: ts.Node, init: ts.Expression, sf: ts.SourceFile): ActionInfo {
  const isAssign = ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'assign';
  const assignedFields = isAssign ? collectAssignedFields(init, sf) : new Set<string>();
  const { fields: readsContextFields, wholeContext: readsWholeContext } = collectContextReads(init, sf);
  let isAsync = false;
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
    isAsync = Boolean(init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
  }
  let usesChildActor = false;
  const checkChild = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && CHILD_ACTORS_IDENTIFIERS.has(n.text)) {
      usesChildActor = true;
    }
    ts.forEachChild(n, checkChild);
  };
  checkChild(init);

  return {
    name,
    node: prop,
    initializer: init,
    isAssign,
    assignedFields,
    readsContextFields,
    readsWholeContext,
    isAsync,
    usesChildActor,
  };
}

function parseMachineStructure(sf: ts.SourceFile): ParsedMachine {
  let specVar: string | undefined;
  let contractType: string | undefined;
  let specDeclStmt: ts.Statement | undefined;
  let answersVar: string | undefined;
  let answersCall: ts.CallExpression | undefined;
  let answersObject: ts.ObjectLiteralExpression | undefined;
  let answersDeclStmt: ts.Statement | undefined;
  let machineVar: string | undefined;
  let machineDeclStmt: ts.Statement | undefined;
  let setupConfig: ts.ObjectLiteralExpression | undefined;
  let machineConfig: ts.ObjectLiteralExpression | undefined;
  let entryDeclStmt: ts.Statement | undefined;
  let defaultExportStmt: ts.Statement | undefined;
  const actions = new Map<string, ActionInfo>();

  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = decl.initializer;

        // `export const fooSpec = defineSystem<Contract>();`
        if (
          ts.isCallExpression(init)
          && ts.isIdentifier(init.expression)
          && init.expression.text === 'defineSystem'
        ) {
          specVar = decl.name.text;
          specDeclStmt = stmt;
          contractType = init.typeArguments?.[0]?.getText(sf);
        }

        // `export const answers = fooSpec.answers({ ... })`
        if (
          specVar
          && ts.isCallExpression(init)
          && ts.isPropertyAccessExpression(init.expression)
          && ts.isIdentifier(init.expression.expression)
          && init.expression.expression.text === specVar
          && init.expression.name.text === 'answers'
        ) {
          answersVar = decl.name.text;
          answersCall = init;
          answersDeclStmt = stmt;
          if (init.arguments[0] && ts.isObjectLiteralExpression(init.arguments[0])) {
            answersObject = init.arguments[0];
          }
        }

        // `export const fooSystem = setup({ ... }).createMachine({ ... })`
        if (
          ts.isCallExpression(init)
          && ts.isPropertyAccessExpression(init.expression)
          && init.expression.name.text === 'createMachine'
          && ts.isCallExpression(init.expression.expression)
          && ts.isIdentifier(init.expression.expression.expression)
          && init.expression.expression.expression.text === 'setup'
        ) {
          machineVar = decl.name.text;
          machineDeclStmt = stmt;
          const setupArg = init.expression.expression.arguments[0];
          if (setupArg && ts.isObjectLiteralExpression(setupArg)) {
            setupConfig = setupArg;
          }
          const machineArg = init.arguments[0];
          if (machineArg && ts.isObjectLiteralExpression(machineArg)) {
            machineConfig = machineArg;
          }
        }

        // `const fooEntry = { spec: fooSpec, machine: fooSystem };`
        if (
          specVar
          && machineVar
          && ts.isObjectLiteralExpression(init)
        ) {
          const specProp = findObjectProperty(init, 'spec', sf);
          const machineProp = findObjectProperty(init, 'machine', sf);
          if (
            specProp && ts.isIdentifier(specProp.initializer) && specProp.initializer.text === specVar
            && machineProp && ts.isIdentifier(machineProp.initializer) && machineProp.initializer.text === machineVar
          ) {
            entryDeclStmt = stmt;
          }
        }
      }
    }

    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      defaultExportStmt = stmt;
    }
  }

  // Extract actions defined inside `setup({ actions: { ... } })`
  if (setupConfig) {
    const actionsProp = findObjectProperty(setupConfig, 'actions', sf);
    if (actionsProp && ts.isObjectLiteralExpression(actionsProp.initializer)) {
      const registerActionsFromObject = (obj: ts.ObjectLiteralExpression): void => {
        for (const prop of obj.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const name = propNameText(prop.name, sf);
            if (name) actions.set(name, inspectActionInitializer(name, prop, prop.initializer, sf));
          } else if (ts.isSpreadAssignment(prop)) {
            const expr = prop.expression;
            // `...fooSpec.actions({ ... })`
            if (
              ts.isCallExpression(expr)
              && ts.isPropertyAccessExpression(expr.expression)
              && expr.expression.name.text === 'actions'
              && expr.arguments[0]
              && ts.isObjectLiteralExpression(expr.arguments[0])
            ) {
              registerActionsFromObject(expr.arguments[0]);
            }
          }
        }
      };
      registerActionsFromObject(actionsProp.initializer);
    }
  }

  return {
    specVar,
    contractType,
    specDeclStmt,
    answersVar,
    answersCall,
    answersObject,
    answersDeclStmt,
    machineVar,
    machineDeclStmt,
    setupConfig,
    machineConfig,
    entryDeclStmt,
    defaultExportStmt,
    actions,
  };
}

function getTransitionActionNames(transitionExpr: ts.Expression, sf: ts.SourceFile): string[] | undefined {
  if (ts.isStringLiteral(transitionExpr)) return [transitionExpr.text];
  if (!ts.isObjectLiteralExpression(transitionExpr)) return undefined;
  const actionsProp = findObjectProperty(transitionExpr, 'actions', sf);
  if (!actionsProp) return [];
  const init = actionsProp.initializer;
  if (ts.isStringLiteral(init)) return [init.text];
  if (ts.isArrayLiteralExpression(init)) {
    const names: string[] = [];
    for (const el of init.elements) {
      if (ts.isStringLiteral(el)) names.push(el.text);
      else return undefined;
    }
    return names;
  }
  return undefined;
}

function getEntryActionList(entryInit: ts.Expression): { names: string[]; allStringLiterals: boolean } {
  if (ts.isStringLiteral(entryInit)) return { names: [entryInit.text], allStringLiterals: true };
  if (ts.isArrayLiteralExpression(entryInit)) {
    const names: string[] = [];
    for (const el of entryInit.elements) {
      if (ts.isStringLiteral(el)) names.push(el.text);
      else return { names: [], allStringLiterals: false };
    }
    return { names, allStringLiterals: true };
  }
  return { names: [], allStringLiterals: false };
}

function isNodeInside(node: ts.Node, ancestor: ts.Node | undefined): boolean {
  if (!ancestor) return false;
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

export function analyzeSource(filePath: string, sourceText: string): {
  sf: ts.SourceFile;
  parsed: ParsedMachine;
  diagnostics: BailDiagnostic[];
} {
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parsed = parseMachineStructure(sf);
  const diagnostics: BailDiagnostic[] = [];
  const seen = new Set<string>();

  const addBail = (rule: BailRule, node: ts.Node): void => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const key = `${line}:${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push({
      file: filePath,
      line,
      rule,
      snippet: oneLineSnippet(node, sf),
    });
  };

  // Track which send verbs were imported from `#generated/events` or relative `events.ts`
  const importedSendVerbs = new Set<string>();

  // 1. Scan imports for BAIL_INVOKE, BAIL_GUARD_CHAIN, BAIL_SPAWN_CHILD, send verbs
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const mod = stmt.moduleSpecifier.text;
    if (mod.includes('parent-tabs')) {
      addBail('BAIL_SPAWN_CHILD', stmt);
    }
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const spec of bindings.elements) {
        const importedName = spec.propertyName?.text ?? spec.name.text;
        const localName = spec.name.text;
        if (INVOKE_CREATORS.has(importedName)) {
          addBail('BAIL_INVOKE', spec);
        }
        if (mod === 'xstate' && GUARD_COMBINATORS.has(importedName)) {
          addBail('BAIL_GUARD_CHAIN', spec);
        }
        if (CHILD_ACTORS_IDENTIFIERS.has(importedName)) {
          addBail('BAIL_SPAWN_CHILD', spec);
        }
        if (SEND_VERBS.has(importedName) && (mod.includes('events') || mod.startsWith('#generated/events'))) {
          importedSendVerbs.add(localName);
        }
      }
    }
  }

  // 2. Inspect `setup({ actors, guards, ... })`
  if (parsed.setupConfig) {
    const actorsProp = findObjectProperty(parsed.setupConfig, 'actors', sf);
    if (actorsProp && ts.isObjectLiteralExpression(actorsProp.initializer) && !isObjectLiteralEmpty(actorsProp.initializer)) {
      addBail('BAIL_SPAWN_CHILD', actorsProp);
    }
    const guardsProp = findObjectProperty(parsed.setupConfig, 'guards', sf);
    if (guardsProp && ts.isObjectLiteralExpression(guardsProp.initializer) && !isObjectLiteralEmpty(guardsProp.initializer)) {
      addBail('BAIL_GUARD_CHAIN', guardsProp);
    }
  }

  // 3. Walk the full AST for cross-cutting rules
  const walkAll = (node: ts.Node, inAssign: boolean): void => {
    const enteringAssign = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'assign';
    const nextInAssign = inAssign || enteringAssign;

    if (ts.isCallExpression(node)) {
      // BAIL_INVOKE
      if (ts.isIdentifier(node.expression) && INVOKE_CREATORS.has(node.expression.text)) {
        addBail('BAIL_INVOKE', node);
      }
      // BAIL_SPAWN_CHILD
      if (ts.isIdentifier(node.expression) && CHILD_ACTORS_IDENTIFIERS.has(node.expression.text)) {
        addBail('BAIL_SPAWN_CHILD', node);
      }
      if (ts.isPropertyAccessExpression(node.expression) && CHILD_ACTORS_IDENTIFIERS.has(node.expression.name.text)) {
        addBail('BAIL_SPAWN_CHILD', node);
      }
      // BAIL_CLIENT_OR_ROLE: sendToWindow or tell({ role }) / ask({ role })
      if (ts.isIdentifier(node.expression) && node.expression.text === 'sendToWindow') {
        addBail('BAIL_CLIENT_OR_ROLE', node);
      }
      if (
        ts.isIdentifier(node.expression)
        && (node.expression.text === 'tell' || node.expression.text === 'ask')
        && node.arguments[0]
        && ts.isObjectLiteralExpression(node.arguments[0])
        && findObjectProperty(node.arguments[0], 'role', sf)
      ) {
        addBail('BAIL_CLIENT_OR_ROLE', node);
      }
      // BAIL_SIDE_EFFECT_IN_ASSIGN
      if (inAssign) {
        const isSendCall = ts.isIdentifier(node.expression) && SEND_VERBS.has(node.expression.text);
        const isSelfSend = ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === 'self'
          && node.expression.name.text === 'send';
        const isIoCall = ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === 'io';
        if (isSendCall || isSelfSend || isIoCall) {
          addBail('BAIL_SIDE_EFFECT_IN_ASSIGN', node);
        }
      }
      // BAIL_EXTERNAL_HELPER_SENDS: module-level helper outside answers/setup calling broadcast/tell/sendToSurface/sendToWindow
      if (
        ts.isIdentifier(node.expression)
        && (SEND_VERBS.has(node.expression.text) || importedSendVerbs.has(node.expression.text))
        && !isNodeInside(node, parsed.answersDeclStmt)
        && !isNodeInside(node, parsed.machineDeclStmt)
      ) {
        addBail('BAIL_EXTERNAL_HELPER_SENDS', node);
      }
    }

    // BAIL_CLIENT_OR_ROLE: `client` parameter destructuring in answer or action handler
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      && (isNodeInside(node, parsed.answersDeclStmt) || isNodeInside(node, parsed.machineDeclStmt))
    ) {
      const firstParam = node.parameters[0];
      if (firstParam && ts.isObjectBindingPattern(firstParam.name)) {
        for (const el of firstParam.name.elements) {
          const propName = el.propertyName ? propNameText(el.propertyName, sf) : ts.isIdentifier(el.name) ? el.name.text : undefined;
          if (propName === 'client') {
            addBail('BAIL_CLIENT_OR_ROLE', el);
          }
        }
      }
    }

    ts.forEachChild(node, (child) => walkAll(child, nextInAssign));
  };
  walkAll(sf, false);

  // 4. Inspect machine config structure (states, on, invoke, after, entry, exit, meta, tags, transitions)
  let totalEntries = 0;
  let stateCount = 0;
  let initialStateName: string | undefined;

  if (parsed.machineConfig) {
    const initialProp = findObjectProperty(parsed.machineConfig, 'initial', sf);
    if (initialProp && ts.isStringLiteral(initialProp.initializer)) {
      initialStateName = initialProp.initializer.text;
    }
    const statesProp = findObjectProperty(parsed.machineConfig, 'states', sf);
    if (statesProp && ts.isObjectLiteralExpression(statesProp.initializer)) {
      stateCount = statesProp.initializer.properties.length;
    }

    const inspectOnObject = (onObj: ts.ObjectLiteralExpression): void => {
      for (const prop of onObj.properties) {
        if (ts.isSpreadAssignment(prop)) {
          const expr = prop.expression;
          const isAnswersOnSpread = Boolean(
            parsed.answersVar
            && ts.isPropertyAccessExpression(expr)
            && ts.isIdentifier(expr.expression)
            && expr.expression.text === parsed.answersVar
            && expr.name.text === 'on',
          );
          if (!isAnswersOnSpread) {
            addBail('BAIL_TRANSITION_REF', prop);
          }
          continue;
        }
        if (!ts.isPropertyAssignment(prop)) continue;
        const init = prop.initializer;
        if (ts.isArrayLiteralExpression(init)) {
          addBail('BAIL_GUARD_CHAIN', prop);
          continue;
        }
        // Check non-literal transition ref (e.g., `EV: answers.on.EV`)
        if (
          ts.isPropertyAccessExpression(init)
          && ts.isPropertyAccessExpression(init.expression)
          && parsed.answersVar
          && ts.isIdentifier(init.expression.expression)
          && init.expression.expression.text === parsed.answersVar
          && init.expression.name.text === 'on'
        ) {
          addBail('BAIL_TRANSITION_REF', prop);
          continue;
        }
        if (ts.isObjectLiteralExpression(init)) {
          if (findObjectProperty(init, 'guard', sf)) {
            addBail('BAIL_GUARD_CHAIN', prop);
          }
          const reenterProp = findObjectProperty(init, 'reenter', sf);
          if (reenterProp && reenterProp.initializer.kind === ts.SyntaxKind.TrueKeyword) {
            addBail('BAIL_NESTED_STATES', reenterProp);
          }
          // Check BAIL_ACTION_CHAIN_READS_PRIOR_ASSIGN
          const actionNames = getTransitionActionNames(init, sf);
          if (actionNames && actionNames.length >= 2) {
            const assignedSoFar = new Set<string>();
            let anyPriorAssign = false;
            for (const actName of actionNames) {
              const info = parsed.actions.get(actName);
              if (!info) continue;
              if (anyPriorAssign) {
                const readsPrior = info.readsWholeContext
                  || [...info.readsContextFields].some((f) => assignedSoFar.has(f));
                if (readsPrior) {
                  addBail('BAIL_ACTION_CHAIN_READS_PRIOR_ASSIGN', prop);
                }
              }
              if (info.isAssign) {
                anyPriorAssign = true;
                for (const f of info.assignedFields) assignedSoFar.add(f);
              }
            }
          }
        }
      }
    };

    const inspectStateNode = (stateObj: ts.ObjectLiteralExpression, depth: number, stateName?: string): void => {
      for (const prop of stateObj.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = propNameText(prop.name, sf);
        if (!name) continue;

        if (name === 'invoke') {
          addBail('BAIL_INVOKE', prop);
        } else if (name === 'after') {
          addBail('BAIL_AFTER', prop);
        } else if (name === 'meta' || name === 'tags') {
          addBail('BAIL_META_OR_TAGS', prop);
        } else if (name === 'always') {
          addBail('BAIL_NESTED_STATES', prop);
        } else if (name === 'type' && ts.isStringLiteral(prop.initializer)) {
          if (['final', 'parallel', 'history'].includes(prop.initializer.text)) {
            addBail('BAIL_NESTED_STATES', prop);
          }
        } else if (name === 'exit') {
          addBail('BAIL_ENTRY_EXIT', prop);
        } else if (name === 'entry') {
          totalEntries++;
          const { names, allStringLiterals } = getEntryActionList(prop.initializer);
          const isAllowedPosition = depth === 0 || (depth === 1 && stateCount === 1 && stateName === initialStateName);
          const singleActionName = allStringLiterals && names.length === 1 ? names[0] : undefined;
          const actionInfo = singleActionName ? parsed.actions.get(singleActionName) : undefined;
          const isCleanSyncEntry = Boolean(
            totalEntries === 1
            && isAllowedPosition
            && actionInfo
            && !actionInfo.isAssign
            && !actionInfo.isAsync
            && !actionInfo.usesChildActor,
          );
          if (!isCleanSyncEntry) {
            addBail('BAIL_ENTRY_EXIT', prop);
          }
        } else if (name === 'on' && ts.isObjectLiteralExpression(prop.initializer)) {
          inspectOnObject(prop.initializer);
        } else if (name === 'states' && ts.isObjectLiteralExpression(prop.initializer)) {
          if (depth >= 1) {
            addBail('BAIL_NESTED_STATES', prop);
          }
          for (const subProp of prop.initializer.properties) {
            if (ts.isPropertyAssignment(subProp) && ts.isObjectLiteralExpression(subProp.initializer)) {
              inspectStateNode(subProp.initializer, depth + 1, propNameText(subProp.name, sf));
            }
          }
        }
      }
    };

    inspectStateNode(parsed.machineConfig, 0);
  }

  // 5. Ensure machine is a supported Wave 1 `defineSystem<Contract>()` pattern if no specific bail triggered
  if (diagnostics.length === 0) {
    if (!parsed.specVar || !parsed.contractType || !parsed.machineVar || !parsed.machineConfig) {
      addBail('BAIL_UNSUPPORTED_MACHINE', parsed.machineDeclStmt ?? sf);
    } else if (stateCount > 1) {
      addBail('BAIL_UNSUPPORTED_MACHINE', findObjectProperty(parsed.machineConfig, 'states', sf) ?? parsed.machineConfig);
    } else {
      const ctxProp = findObjectProperty(parsed.machineConfig, 'context', sf);
      if (ctxProp && !isEmptyContextExpr(ctxProp.initializer)) {
        addBail('BAIL_UNSUPPORTED_MACHINE', ctxProp);
      }
    }
  }

  return { sf, parsed, diagnostics };
}

function getLeadingComments(sourceText: string, node: ts.Node): string {
  const fullStart = node.getFullStart();
  const start = node.getStart();
  const trivia = sourceText.slice(fullStart, start);
  const trimmed = trivia.replace(/^\s*\n/, '');
  return trimmed.trim().length > 0 ? trivia : '';
}

function collectIdentifiers(node: ts.Node): Set<string> {
  const ids = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) ids.add(n.text);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return ids;
}

function rewriteAnswerHandler(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  sf: ts.SourceFile,
  sourceText: string,
): string {
  const isAsync = Boolean(fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
  const asyncPrefix = isAsync ? 'async ' : '';
  const bodyText = fn.body.getText(sf);
  const returnTypeText = fn.type ? `: ${fn.type.getText(sf)}` : '';

  const usedSendVerbs = [...SEND_VERBS].filter((v) => {
    let found = false;
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === v) {
        found = true;
      }
      ts.forEachChild(n, walk);
    };
    walk(fn.body);
    return found;
  });

  if (fn.parameters.length === 0) {
    if (usedSendVerbs.length === 0) {
      return `${asyncPrefix}()${returnTypeText} => ${bodyText}`;
    }
    return `${asyncPrefix}(_args, { ${usedSendVerbs.join(', ')} })${returnTypeText} => ${bodyText}`;
  }

  const firstParam = fn.parameters[0];
  if (!ts.isObjectBindingPattern(firstParam.name)) {
    return fn.getText(sf);
  }

  let argsParam = '_args';
  const scopeBindings: string[] = [];
  let hasContext = false;

  for (const el of firstParam.name.elements) {
    const propName = el.propertyName ? propNameText(el.propertyName, sf) : ts.isIdentifier(el.name) ? el.name.text : undefined;
    if (propName === 'args') {
      argsParam = el.name.getText(sf);
    } else if (propName === 'context') {
      hasContext = true;
      const localName = el.name.getText(sf);
      scopeBindings.push(localName === 'context' ? 'data' : `data: ${localName}`);
    } else if (propName === 'signal' || propName === 'progress' || propName === 'refuse') {
      scopeBindings.push(el.getText(sf));
    } else if (propName === 'self') {
      scopeBindings.push('send');
    }
  }

  for (const v of usedSendVerbs) {
    if (!scopeBindings.includes(v)) scopeBindings.push(v);
  }

  let rewrittenBody = bodyText;
  if (hasContext) {
    rewrittenBody = rewrittenBody.replace(/\bcontext\b/g, 'data');
  }

  const paramsText = scopeBindings.length > 0
    ? `(${argsParam}, { ${scopeBindings.join(', ')} })`
    : argsParam === '_args'
      ? '()'
      : `(${argsParam})`;

  void sourceText;
  return `${asyncPrefix}${paramsText}${returnTypeText} => ${rewrittenBody}`;
}

function rewriteOnActionHandler(
  eventType: string,
  action: ActionInfo,
  specVar: string,
  sf: ts.SourceFile,
  sourceText: string,
): string {
  const init = action.initializer;
  if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) {
    return init.getText(sf);
  }

  const body = init.body;
  const usedSendVerbs = [...SEND_VERBS].filter((v) => {
    let found = false;
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === v) {
        found = true;
      }
      ts.forEachChild(n, walk);
    };
    walk(body);
    return found;
  });

  if (init.parameters.length === 0) {
    const params = usedSendVerbs.length > 0 ? `(_event, { ${usedSendVerbs.join(', ')} })` : '()';
    return `${params} => ${body.getText(sf)}`;
  }

  // Check for `const <binding> = <specVar>.typeOf('<eventType>', event);` as first statement
  if (ts.isBlock(body) && body.statements.length > 0) {
    const firstStmt = body.statements[0];
    if (ts.isVariableStatement(firstStmt) && firstStmt.declarationList.declarations.length === 1) {
      const decl = firstStmt.declarationList.declarations[0];
      if (
        decl.initializer
        && ts.isCallExpression(decl.initializer)
        && ts.isPropertyAccessExpression(decl.initializer.expression)
        && ts.isIdentifier(decl.initializer.expression.expression)
        && decl.initializer.expression.expression.text === specVar
        && decl.initializer.expression.name.text === 'typeOf'
        && decl.initializer.arguments.length === 2
        && ts.isStringLiteral(decl.initializer.arguments[0])
        && decl.initializer.arguments[0].text === eventType
        && ts.isIdentifier(decl.initializer.arguments[1])
        && decl.initializer.arguments[1].text === 'event'
      ) {
        // Check whether `event` is referenced anywhere in the remaining statements
        const restStatements = body.statements.slice(1);
        const eventUsedInRest = restStatements.some((s) => collectIdentifiers(s).has('event'));
        if (!eventUsedInRest) {
          const paramBinding = decl.name.getText(sf);
          const params = usedSendVerbs.length > 0
            ? `(${paramBinding}, { ${usedSendVerbs.join(', ')} })`
            : `(${paramBinding})`;
          // Slice body text removing only `firstStmt` (preserving all comments and formatting of rest!)
          const openBraceEnd = body.getStart(sf) + 1;
          const firstEnd = firstStmt.getEnd();
          // Skip trailing newline after removed statement
          let sliceStart = firstEnd;
          if (sourceText[sliceStart] === '\r') sliceStart++;
          if (sourceText[sliceStart] === '\n') sliceStart++;
          const remainingText = sourceText.slice(sliceStart, body.getEnd());
          const bodyOut = `${sourceText.slice(body.getStart(sf), openBraceEnd)}\n${remainingText}`;
          return `${params} => ${bodyOut}`;
        }
      }
    }
  }

  // Fallback: replace `<specVar>.typeOf('<eventType>', event)` with `event`
  const params = usedSendVerbs.length > 0 ? `(event, { ${usedSendVerbs.join(', ')} })` : '(event)';
  const typeOfRegex = new RegExp(`${specVar}\\.typeOf\\(\\s*['"]${eventType}['"]\\s*,\\s*event\\s*\\)`, 'g');
  const rewrittenBody = body.getText(sf).replace(typeOfRegex, 'event');
  return `${params} => ${rewrittenBody}`;
}

function rewriteImports(
  sf: ts.SourceFile,
  sourceText: string,
  usedHostEvents: readonly string[],
  hasAnswers: boolean,
): string {
  const keptImports: string[] = [];
  let hasStateImport = false;
  let hasSdkEventsTypeImport = false;
  let hasHostLifecycleImport = false;

  const sdkEventTypes = hasAnswers
    ? ['ContractAsks', 'IncomingOnlyEventsOf', 'NormalizeAsks']
    : ['IncomingOnlyEventsOf'];

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const mod = stmt.moduleSpecifier.text;
    const leading = getLeadingComments(sourceText, stmt);

    // Drop `xstate` completely
    if (mod === 'xstate') continue;

    // Strip `defineSystem` from `@apackdev/sdk/framework`
    if (mod === '@apackdev/sdk/framework' && stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
      const remaining = stmt.importClause.namedBindings.elements.filter(
        (el) => (el.propertyName?.text ?? el.name.text) !== 'defineSystem',
      );
      if (remaining.length === 0) {
        if (usedHostEvents.length > 0 && !hasHostLifecycleImport) {
          keptImports.push(`${leading}import type { HostLifecycleEvents } from '@apackdev/sdk/framework';`);
          hasHostLifecycleImport = true;
        }
        continue;
      }
      const specText = remaining.map((el) => el.getText(sf)).join(', ');
      const typePrefix = stmt.importClause.isTypeOnly ? 'type ' : '';
      keptImports.push(`${leading}import ${typePrefix}{ ${specText} } from '${mod}';`);
      if (usedHostEvents.length > 0 && !hasHostLifecycleImport) {
        keptImports.push(`import type { HostLifecycleEvents } from '@apackdev/sdk/framework';`);
        hasHostLifecycleImport = true;
      }
      continue;
    }

    if (mod === '#generated/state.ts' || mod === '#generated/state') {
      hasStateImport = true;
    }
    if (mod === '@apackdev/sdk/events') {
      hasSdkEventsTypeImport = true;
    }

    keptImports.push(`${leading}${stmt.getText(sf)}`);
  }

  const injected: string[] = [];
  if (!hasStateImport) {
    injected.push(`import { state } from '#generated/state.ts';`);
  }
  if (!hasSdkEventsTypeImport) {
    injected.push(`import type { ${sdkEventTypes.join(', ')} } from '@apackdev/sdk/events';`);
  }
  if (usedHostEvents.length > 0 && !hasHostLifecycleImport) {
    injected.push(`import type { HostLifecycleEvents } from '@apackdev/sdk/framework';`);
  }

  return [...injected, ...keptImports].join('\n').replace(/^\n+/, '');
}

function reindentBlock(text: string, targetIndent: string): string {
  const lines = text.split('\n');
  if (lines.length <= 1) return text;
  const nonEmptyRest = lines.slice(1).filter((l) => l.trim().length > 0);
  const closingLine = lines[lines.length - 1];
  const baseIndentMatch = closingLine.match(/^(\s*)/);
  const baseIndent = baseIndentMatch ? baseIndentMatch[1] : '';
  const minIndent = nonEmptyRest.reduce((min, l) => {
    const m = l.match(/^(\s*)/);
    const len = m ? m[1].length : 0;
    return Math.min(min, len);
  }, baseIndent.length);

  return [
    lines[0],
    ...lines.slice(1).map((line) => {
      if (line.trim().length === 0) return '';
      return `${targetIndent}${line.slice(Math.min(minIndent, line.length))}`;
    }),
  ].join('\n');
}

export function codemodSource(filePath: string, sourceText: string): FileCodemodResult {
  const { sf, parsed, diagnostics } = analyzeSource(filePath, sourceText);
  if (diagnostics.length > 0) {
    return { file: filePath, status: 'BAIL-OUT', diagnostics };
  }

  const specVar = parsed.specVar!;
  const contractType = parsed.contractType!;
  const machineVar = parsed.machineVar!;
  const machineConfig = parsed.machineConfig!;

  // Collect `on` handlers from root and sole trivial state
  const onHandlers: Array<{ eventType: string; action: ActionInfo; comment: string }> = [];
  const collectOnFrom = (obj: ts.ObjectLiteralExpression): void => {
    const onProp = findObjectProperty(obj, 'on', sf);
    if (!onProp || !ts.isObjectLiteralExpression(onProp.initializer)) return;
    for (const prop of onProp.initializer.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const eventType = propNameText(prop.name, sf);
      if (!eventType) continue;
      const actionNames = getTransitionActionNames(prop.initializer, sf);
      if (!actionNames || actionNames.length !== 1) continue;
      const action = parsed.actions.get(actionNames[0]);
      if (!action) continue;
      const comment = getLeadingComments(sourceText, prop);
      onHandlers.push({ eventType, action, comment });
    }
  };

  // Collect single sync `entry` (if present on root or sole trivial state)
  let entryAction: ActionInfo | undefined;
  const checkEntryOn = (obj: ts.ObjectLiteralExpression): void => {
    const entryProp = findObjectProperty(obj, 'entry', sf);
    if (!entryProp) return;
    const { names } = getEntryActionList(entryProp.initializer);
    if (names.length === 1) {
      entryAction = parsed.actions.get(names[0]);
    }
  };

  collectOnFrom(machineConfig);
  checkEntryOn(machineConfig);
  const statesProp = findObjectProperty(machineConfig, 'states', sf);
  if (statesProp && ts.isObjectLiteralExpression(statesProp.initializer)) {
    for (const stProp of statesProp.initializer.properties) {
      if (ts.isPropertyAssignment(stProp) && ts.isObjectLiteralExpression(stProp.initializer)) {
        collectOnFrom(stProp.initializer);
        checkEntryOn(stProp.initializer);
      }
    }
  }

  const usedHostEvents = onHandlers
    .map((h) => h.eventType)
    .filter((ev) => HOST_LIFECYCLE_EVENTS.has(ev));

  // Build imports section
  const importsSection = rewriteImports(sf, sourceText, usedHostEvents, Boolean(parsed.answersObject));

  // Preserve non-import, non-machine-plumbing top-level statements (loggers, helpers, constants)
  const droppedStmts = new Set<ts.Statement>();
  if (parsed.specDeclStmt) droppedStmts.add(parsed.specDeclStmt);
  if (parsed.answersDeclStmt) droppedStmts.add(parsed.answersDeclStmt);
  if (parsed.machineDeclStmt) droppedStmts.add(parsed.machineDeclStmt);
  if (parsed.entryDeclStmt) droppedStmts.add(parsed.entryDeclStmt);
  if (parsed.defaultExportStmt) droppedStmts.add(parsed.defaultExportStmt);

  const helperParts: string[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) || droppedStmts.has(stmt)) continue;
    const leading = getLeadingComments(sourceText, stmt).replace(/^\n+/, '');
    helperParts.push(`${leading}${stmt.getText(sf)}`);
  }

  // Preserve doc comment above `answersDeclStmt` (if any) on the `state` export
  const systemDocComment = parsed.answersDeclStmt
    ? getLeadingComments(sourceText, parsed.answersDeclStmt).trim()
    : '';

  // Build `run` section (from single sync entry)
  let runSection = '';
  if (entryAction) {
    const fnText = reindentBlock(entryAction.initializer.getText(sf), '  ');
    runSection = `  run: ${fnText},\n`;
  }

  // Build `on` section
  let onSection = '';
  if (onHandlers.length > 0) {
    const entries = onHandlers.map(({ eventType, action, comment }) => {
      const fnText = reindentBlock(rewriteOnActionHandler(eventType, action, specVar, sf, sourceText), '    ');
      const prefix = comment.trim() ? `${comment.trim().split('\n').map((l) => `    ${l.trimStart()}`).join('\n')}\n` : '';
      return `${prefix}    ${eventType}: ${fnText},`;
    });
    onSection = `  on: {\n${entries.join('\n')}\n  },\n`;
  }

  // Build `answers` section
  let answersSection = '';
  if (parsed.answersObject) {
    const entries: string[] = [];
    for (const prop of parsed.answersObject.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const askName = propNameText(prop.name, sf);
      if (!askName) continue;
      const init = prop.initializer;
      if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue;
      const rawComment = getLeadingComments(sourceText, prop).trim();
      const commentPrefix = rawComment
        ? `${rawComment.split('\n').map((l) => `    ${l.trimStart()}`).join('\n')}\n`
        : '';
      const rewrittenFn = reindentBlock(rewriteAnswerHandler(init, sf, sourceText), '    ');
      entries.push(`${commentPrefix}    ${askName}: ${rewrittenFn},`);
    }
    answersSection = `  answers: {\n${entries.join('\n')}\n  },\n`;
  }

  // Build type parameters for `state<Shape, Events, Asks>()`
  const eventsType = usedHostEvents.length > 0
    ? `IncomingOnlyEventsOf<${contractType}> | Extract<HostLifecycleEvents, { type: ${usedHostEvents.map((e) => `'${e}'`).join(' | ')} }>`
    : `IncomingOnlyEventsOf<${contractType}>`;
  const asksType = parsed.answersObject ? `NormalizeAsks<ContractAsks<${contractType}>>` : '{}';

  const systemBlock = [
    systemDocComment ? `${systemDocComment}\n` : '',
    `export const ${machineVar} = state<\n`,
    `  {},\n`,
    `  ${eventsType},\n`,
    `  ${asksType}\n`,
    `>()({\n`,
    runSection,
    onSection,
    answersSection,
    `});\n\n`,
    `export default ${machineVar};\n`,
  ].join('');

  const sections = [importsSection];
  if (helperParts.length > 0) sections.push(helperParts.join('\n\n'));
  sections.push(systemBlock);

  return {
    file: filePath,
    status: 'CONVERTIBLE',
    diagnostics: [],
    output: `${sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`,
  };
}

function collectXStateFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__generated__') continue;
      collectXStateFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      const content = readFileSync(full, 'utf8');
      if (/\bfrom\s+['"]xstate['"]/.test(content) && /\bcreateMachine\s*\(/.test(content)) {
        out.push(full);
      }
    }
  }
}

export function runCodemodCli(argv: readonly string[]): number {
  let mode: 'dry-run' | 'write' | 'audit' = 'dry-run';
  let jsonOutput = false;
  const targets: string[] = [];

  for (const arg of argv) {
    if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--write') mode = 'write';
    else if (arg === '--audit') mode = 'audit';
    else if (arg === '--json') jsonOutput = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/codemod-xstate-to-state.mts [--dry-run | --write | --audit] [--json] [files...]');
      return 0;
    } else {
      targets.push(resolve(arg));
    }
  }

  const repoRoot = resolve(import.meta.dirname, '..');
  let files = targets;
  if (files.length === 0) {
    if (mode !== 'audit') {
      console.error('Error: pass at least one target file for --dry-run or --write (or use --audit to scan the repo).');
      return 1;
    }
    const discovered: string[] = [];
    for (const root of [
      resolve(repoRoot, 'packages/default-setup/src/features'),
      resolve(repoRoot, 'packages/apack-host/src/features'),
      resolve(repoRoot, 'packages/apack-host/src/bus'),
    ]) {
      collectXStateFiles(root, discovered);
    }
    files = discovered.sort();
  }

  const results = files.map((file) => {
    const text = readFileSync(file, 'utf8');
    return codemodSource(file, text);
  });

  if (jsonOutput) {
    console.log(JSON.stringify(
      results.map((r) => ({
        file: relative(repoRoot, r.file),
        status: r.status,
        diagnostics: r.diagnostics.map((d) => ({ ...d, file: relative(repoRoot, d.file) })),
      })),
      null,
      2,
    ));
    return mode === 'write' && results.some((r) => r.status === 'BAIL-OUT') ? 1 : 0;
  }

  if (mode === 'audit') {
    const convertible = results.filter((r) => r.status === 'CONVERTIBLE');
    const bailed = results.filter((r) => r.status === 'BAIL-OUT');
    console.log(`XState -> @apackdev/state Codemod Audit (${results.length} files)`);
    console.log(`  CONVERTIBLE: ${convertible.length}`);
    console.log(`  BAIL-OUT:    ${bailed.length}\n`);
    console.log('STATUS       | FILE | DIAGNOSTICS');
    console.log('-------------|------|------------');
    for (const r of results) {
      const rel = relative(repoRoot, r.file);
      if (r.status === 'CONVERTIBLE') {
        console.log(`CONVERTIBLE  | ${rel} | none`);
      } else {
        const rules = [...new Set(r.diagnostics.map((d) => d.rule))].join(', ');
        console.log(`BAIL-OUT     | ${rel} | ${rules}`);
        for (const d of r.diagnostics) {
          console.log(`             |   L${d.line} [${d.rule}] ${d.snippet}`);
        }
      }
    }
    return 0;
  }

  let hasBailOut = false;
  for (const r of results) {
    const rel = relative(repoRoot, r.file);
    if (r.status === 'BAIL-OUT') {
      hasBailOut = true;
      console.error(`BAIL-OUT: ${rel}`);
      for (const d of r.diagnostics) {
        console.error(`  L${d.line} [${d.rule}] ${d.snippet}`);
      }
      continue;
    }

    if (mode === 'write') {
      writeFileSync(r.file, r.output!, 'utf8');
      console.log(`WROTE: ${rel}`);
    } else {
      console.log(`DRY-RUN (CONVERTIBLE): ${rel}`);
      console.log(r.output!);
    }
  }

  return hasBailOut ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCodemodCli(process.argv.slice(2));
}
