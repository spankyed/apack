/**
 * The Database console's code runners. Console code is the body of a function that returns its result; a query
 * sees the read helpers, a transaction the read and write helpers, all acting on the installed engine. The
 * Database surface runs its console's code with them, and `apack db query`/`exec` run theirs, so the same code
 * means the same thing in both.
 *
 * @packageDocumentation
 */
import { boundHost, type HostCallReports, type HostDiagnostics } from '../runtime/host-runtime.ts';
import type { EarsNames } from '../runtime/packs-view.ts';
import { EARS as EARS_NAMES } from '../types/index.ts';
import { boundEars, transact, untypedQuery, untypedCreate, untypedUpsert, untypedWrite, getRow, getRoles, getRelation, findRelations, removeRelation, getSchemaStats } from '../ears/index.ts';
import { defineEars } from '@apackdev/ears';
import { errorMessage } from '../utils/shared.ts';

const { getAttr } = /*#__PURE__*/ defineEars(boundEars);

/** The running app's diagnostics, refusing in an app without them */
function diagnostics(): HostDiagnostics {
  const held = boundHost().diagnostics;
  if (!held) throw new Error('engineCalls counts a development app\'s calls to its databases, and this app is not one');
  return held;
}

/**
 * Counting the running app's calls to its databases — reads, writes outside a unit and units, with their time and
 * the code that made each — to measure what a stretch of its work costs: `start()`, then `report()` or `stop()`,
 * each answering the app's database and the run history's. A development app's only; nothing it does writes data
 */
export const engineCalls = {
  start: (): void => diagnostics().calls.start(),
  report: (): HostCallReports => diagnostics().calls.report(),
  stop: (): HostCallReports => diagnostics().calls.stop(),
};

const readHelpers = {
  query: untypedQuery,
  getRow,
  getAttr,
  getRoles,
  getRelation,
  findRelations,
  getSchemaStats,
  engineCalls,
};

const writeHelpers = {
  create: untypedCreate,
  upsert: untypedUpsert,
  write: untypedWrite,
  removeRelation,
};

/**
 * What query code sees besides `EARS`. Nothing here may write: a `query` flow step's safety rests on it (the step
 * refuses a generated query that names a write helper, which is undefined for a query).
 */
export const READ_HELPER_NAMES: readonly string[] = Object.keys(readHelpers);

/** The helpers only a transaction sees: a query naming one fails with "<name> is not defined" */
export const WRITE_HELPER_NAMES: readonly string[] = Object.keys(writeHelpers);

/**
 * The names console code sees besides the helpers: `EARS`, the entity types and relation kinds of the data it
 * runs on (a pack's generated `EARS`, or one built from the installed packs' manifests)
 */
export interface ConsoleScope {
  EARS: object;
}

/**
 * A name the database cannot account for is an error, not a number.
 *
 * A namespace that read `undefined` for a name nothing declares would pass that on as though it were a type.
 * The engine refuses `query(undefined)` too, but only as an unknown type with no name in it; the namespace is the
 * one layer that knows which name was asked for, so it is where the error can name it, list what is known and
 * carry the caller's `hint` (the CLI's `--schema-from`).
 *
 * It is a `Proxy` rather than a getter per name because the names are data: what is declared comes from the
 * installed packs. The traps are what legitimate code does with the object — `db script` is handed it raw
 * (`apack-cli/src/commands/db/script.ts`), so enumerating, spreading and `JSON.stringify` all have to work,
 * and a symbol or a `then`/`toJSON` probe has to read as absent rather than throw, or awaiting a result that
 * carries one would.
 */
function accountedFor<T extends object>(what: string, names: T, hint?: string): T {
  return new Proxy(names, {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || property in target) return Reflect.get(target, property, receiver);
      // A probe, not a name: `await`, `JSON.stringify` and a console's inspection all ask for these by name
      if (property === 'then' || property === 'toJSON' || property === 'inspect' || property === 'constructor') return undefined;
      throw new Error(
        `"${property}" is not ${what} this database can account for.\n`
        + `  Known: ${Object.keys(target).sort().join(', ')}`
        + (hint === undefined ? '' : `\n  ${hint}`),
      );
    },
    // Asking whether a name is there is a question, not a use of it, so it answers rather than throwing
    has: (target, property) => property in target,
  });
}

/**
 * `EARS` for console code: the SDK's, with the entity types and relation kinds `names` declares. Console code
 * queries the whole database, so it names every installed pack's types, not only the pack running the console.
 *
 * `hint` is how a caller says what would supply the missing names — the CLI's `--schema-from`, for a data dir
 * whose rows outlived their pack. The app's console has no such answer and passes none, which is why this is
 * the caller's sentence and not a string written here.
 */
export function consoleEars(names: EarsNames, { hint }: { hint?: string } = {}): ConsoleScope['EARS'] {
  return {
    ...EARS_NAMES,
    Entity: accountedFor('an entity type', { ...EARS_NAMES.Entity, ...names.entities }, hint),
    RelKind: accountedFor('a relation kind', { ...EARS_NAMES.RelKind, ...names.relKinds }, hint),
    RoleKind: accountedFor('a role', { ...EARS_NAMES.RoleKind, ...names.roles }, hint),
  };
}

/** `EARS` for console code in a running app: every registered pack's, from the app's registry */
export function installedEars(): ConsoleScope['EARS'] {
  return consoleEars(boundHost().packs.earsNames());
}

/** Console code as a function of nothing, over the helpers it's given; a plain function, so `await` doesn't parse */
function compileCode(code: string, scope: ConsoleScope, helpers: Record<string, unknown>): () => unknown {
  // Blank code is nothing to run, not code that returns nothing: whitespace alone would otherwise build a function
  // body and answer `undefined`, which reads as a query that found nothing
  if (typeof code !== 'string' || code.trim() === '') throw new Error('No code to run');
  const names = ['EARS', ...Object.keys(helpers)];
  const body = new Function(...names, code);
  return () => body(scope.EARS, ...Object.values(helpers));
}

/** Runs query code with the read helpers; its error's message is the code's */
export async function runQueryCode(code: string, scope: ConsoleScope): Promise<unknown> {
  try {
    return await compileCode(code, scope, readHelpers)();
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

/**
 * Runs transaction code with the read and write helpers as one unit (`transact`): code that throws part way keeps
 * none of its writes, and its error's message starts "Transaction failed:". The code is synchronous — `await`
 * doesn't parse, and a returned promise is refused — since an await would split the unit. A promise is refused only
 * once the code that made it has started, so what that code writes after its first await is outside the unit and
 * kept, which the message says rather than claiming everything was undone.
 */
export async function runTransactionCode(code: string, scope: ConsoleScope): Promise<unknown> {
  let returnedPromise = false;
  try {
    const body = compileCode(code, scope, { ...readHelpers, ...writeHelpers });
    return transact(() => {
      const result = body();
      returnedPromise = result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function';
      return result;
    });
  } catch (error) {
    if (returnedPromise) {
      throw new Error('Transaction failed: transaction code must be synchronous, and this returned a promise.\n'
        + '  What it wrote before its first await was undone; what it writes after that runs outside the transaction and is kept.');
    }
    throw new Error(`Transaction failed: ${errorMessage(error)}\n  Nothing it wrote was kept: a transaction is undone as a whole.`);
  }
}
