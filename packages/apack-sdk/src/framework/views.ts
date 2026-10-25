// Views: a feature's named live reads. A feature declares them with `defineViews` and names the export in
// `apack.json` (`features.<id>.views`); a window subscribes to one with arguments (`useView`, `#generated/fe`),
// and the host runs it on the engine and runs it again after every commit that could change its result
// (`Ears.watch`), sending each changed result to that window alone.
//
// A view is a **pure read of the engine**. What it reads elsewhere — the clock, settings, a module-level cache, a
// file — is not tracked, so its result would go stale without a word. It reads through the pack's repositories
// and `query` like any backend code, and writes nothing.
//
// Frontend-safe: nothing here imports, so the frontend's `useView` and the host's view registry share the wire
// types and the argument key without either reaching the other.

/** One view: its arguments, as the window passes them, to what it reads. A view with no arguments takes none. */
export type ViewRead = (args: never) => unknown;

/** A feature's views by name */
export type ViewDefinitions = Readonly<Record<string, ViewRead>>;

/**
 * A feature's views, typed as written: what `apack.json` `features.<id>.views` names, and what codegen types the
 * frontend's `useView` from.
 *
 * ```ts
 * export const promptViews = defineViews({
 *   page: ({ page }: { page: number }) => repository.promptQueries.connectedData(page),
 *   byId: ({ id }: { id: EARS.EntityId }) => repository.promptQueries.byId(id) ?? null,
 * });
 * ```
 *
 * Arguments and results cross the wire as JSON, so both are plain data. A view that finds nothing returns `null`
 * rather than `undefined`, which JSON has no way to carry.
 */
export function defineViews<const Views extends ViewDefinitions>(views: Views): Views {
  return views;
}

/** The arguments a view takes, or `undefined` for one that takes none */
export type ViewArgs<Read> = Read extends () => unknown ? undefined : Read extends (args: infer Args) => unknown ? Args : never;

/** What a view returns */
export type ViewResult<Read> = Read extends (...args: never[]) => infer Result ? Result : never;

/** What a window asks for: a feature's view, by the feature's ref and the view's name, with its arguments */
export interface ViewRequest {
  /** The feature that declares the view, `<packId>/<featureId>` */
  ref: string;
  /** The view's name, a key of the feature's `defineViews` */
  view: string;
  /** Plain data; absent for a view that takes none */
  args?: unknown;
}

/**
 * What a subscription delivers: the view's result, or why there is none, with the number of the last commit it
 * reflects (`Ears.lastCommit`). A view that throws is still watched, so a later commit can bring a result back;
 * so is one whose pack isn't running, which a pack registering brings back.
 */
export type ViewUpdate<Result = unknown> =
  | { ok: true; value: Result; commit: number }
  | { ok: false; error: string; commit: number };

/**
 * The key two requests share when they ask for the same thing: the ref, the view and the arguments with every
 * object's keys sorted, so `{ a, b }` and `{ b, a }` are one watch.
 */
export function viewKey(request: ViewRequest): string {
  return JSON.stringify([request.ref, request.view, sortedKeys(request.args ?? null)]);
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]));
}
