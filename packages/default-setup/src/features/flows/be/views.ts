// The flows feature's views: the flows a window lists, and the graph of the flow it has open, each run again after
// every commit that changes it and sent to that window alone. The editor edits its own copy of the graph at once and
// takes the view's whenever none of its writes is unanswered (`fe/state.ts`).
import { defineViews } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';
import type { EARS } from '#generated/ears.ts';

export const flowViews = defineViews({
  /** Every flow, newest first, and which one the brain runs */
  list: () => repository.flowsQueries.list(),
  /** A flow's nodes and edges, or `null` once it's gone */
  graph: ({ flowId }: { flowId: EARS.EntityId }) => repository.flowsQueries.graph(flowId),
});
