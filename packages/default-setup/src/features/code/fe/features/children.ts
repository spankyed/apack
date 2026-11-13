// The code surface's children: which machine each spawned id runs, and the two ways to reach one.
//
// The id and the machine behind it are stated once, here. A caller passes the id and the type follows, so an id
// can't be paired with the wrong actor and an id no child is spawned under doesn't compile.
import type { AnyActorRef, AnyEventObject, EventFrom } from 'xstate';
import type { CodeActionsActor } from './actions/state.ts';
import type { CommitActor } from './commit/state.ts';
import type { ExplorerActor } from './explorer/state.ts';
import type { CodeGitHubActor } from './github/state.ts';
import type { CodePromptsActor } from './prompts/state.ts';
import type { PullRequestActor } from './pull-request/state.ts';
import type { SearchActor } from './search/state.ts';
import type { TerminalActor } from './terminal/state.ts';

/** Every child the code surface spawns, by the id it is spawned under (`fe/state.ts`) */
export interface CodeChildren {
  explorer: ExplorerActor;
  terminal: TerminalActor;
  commit: CommitActor;
  pr: PullRequestActor;
  search: SearchActor;
  codeActions: CodeActionsActor;
  codePrompts: CodePromptsActor;
  github: CodeGitHubActor;
}

/** Those ids at runtime, for the code that reaches every child in turn */
export const CODE_CHILD_IDS = [
  'explorer', 'terminal', 'commit', 'pr', 'search', 'codeActions', 'codePrompts', 'github',
] as const satisfies readonly (keyof CodeChildren)[];

/**
 * The child spawned under `id`, as the machine that runs there. Its context and the events it takes are checked, so
 * a field or an event that machine drops is a compile error rather than a silent `undefined` or a send that goes
 * nowhere — which is what both terminal restarts did with a `shell` the create event never carried.
 */
export const codeChild = <K extends keyof CodeChildren>(code: AnyActorRef, id: K): CodeChildren[K] | undefined =>
  code.getSnapshot().children[id] as CodeChildren[K] | undefined;

/** What a component may send the child at `id`: the events named for it, which the surface routes there */
type PanelEvent<K extends keyof CodeChildren> = Extract<EventFrom<CodeChildren[K]>, { type: `${K}.${string}` }>;

/** The child at `id` as a component holds it: read as itself, sent to through the surface */
export type PanelChild<K extends keyof CodeChildren> = Omit<CodeChildren[K], 'send'> & { send(event: PanelEvent<K>): void };

/**
 * The child at `id`, for a component: its state read from the child, and its sends made through `surface`, the
 * actor `useSurface()` gave the component.
 *
 * A send straight to the child names no sender, because only the surface's own `send` runs inside a delivery naming
 * the surface. A child that asks the backend from that send then gets no answer: the backend has nobody to reply to
 * and drops it. Going through the surface names it, and the surface routes the event to the child by its prefix
 * (`routeEvent`, `fe/state.ts`), which is why only events named for the child can be sent here.
 *
 * Machine code reaching a sibling uses `codeChild`, since it already runs inside the delivery that named the surface.
 */
export const panelChild = <K extends keyof CodeChildren>(surface: AnyActorRef, id: K): PanelChild<K> | undefined => {
  const child = codeChild(surface, id);
  if (!child) return undefined;
  // One function per member, kept, so a selector that compares `subscribe` or `getSnapshot` by identity sees the same one
  const kept = new Map<PropertyKey, unknown>([['send', (event: PanelEvent<K>) => surface.send(event)]]);
  return new Proxy(child, {
    get: (target, prop) => {
      if (kept.has(prop)) return kept.get(prop);
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== 'function') return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(target);
      kept.set(prop, bound);
      return bound;
    },
  }) as unknown as PanelChild<K>;
};

/**
 * Forwards `event` to the child at `id` without addressing one: the routing the surface does by an event's prefix,
 * and the broadcast that hands every child whatever arrived. No one child is named, so there is no event union to
 * check against — each child ignores what it doesn't handle.
 */
export const routeToCodeChild = (code: AnyActorRef, id: string, event: AnyEventObject): void => {
  (code.getSnapshot().children[id] as AnyActorRef | undefined)?.send(event);
};
