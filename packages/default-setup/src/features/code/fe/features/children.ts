// The code surface's children: which machine each spawned id runs, and the two ways to reach one.
//
// The id and the machine behind it are stated once, here. A caller passes the id and the type follows, so an id
// can't be paired with the wrong actor and an id no child is spawned under doesn't compile.
import type { AnyActorRef, AnyEventObject } from 'xstate';
import type { CodeActionsActor } from './actions/state.ts';
import type { CodeIndexActor } from './code-index/state.ts';
import type { CommitActor } from './commit/state.ts';
import type { ExplorerActor } from './explorer/state.ts';
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
  codeIndex: CodeIndexActor;
}

/** Those ids at runtime, for the code that reaches every child in turn */
export const CODE_CHILD_IDS = [
  'explorer', 'terminal', 'commit', 'pr', 'search', 'codeActions', 'codePrompts', 'codeIndex',
] as const satisfies readonly (keyof CodeChildren)[];

/**
 * The child spawned under `id`, as the machine that runs there. Its context and the events it takes are checked, so
 * a field or an event that machine drops is a compile error rather than a silent `undefined` or a send that goes
 * nowhere — which is what both terminal restarts did with a `shell` the create event never carried.
 */
export const codeChild = <K extends keyof CodeChildren>(code: AnyActorRef, id: K): CodeChildren[K] | undefined =>
  code.getSnapshot().children[id] as CodeChildren[K] | undefined;

/**
 * Forwards `event` to the child at `id` without addressing one: the routing the surface does by an event's prefix,
 * and the broadcast that hands every child whatever arrived. No one child is named, so there is no event union to
 * check against — each child ignores what it doesn't handle.
 */
export const routeToCodeChild = (code: AnyActorRef, id: string, event: AnyEventObject): void => {
  (code.getSnapshot().children[id] as AnyActorRef | undefined)?.send(event);
};
