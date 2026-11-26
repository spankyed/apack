import type { ExecutionContext, StepInput } from '@apackdev/sdk/steps';

export function handler(_input: StepInput, _node: unknown, ctx: ExecutionContext, actor: unknown): void {
  const a = actor as { send: (event: any) => void };

  ctx.runtime.killFlow(ctx.flowRunNodeId);

  a.send({ type: 'COMPLETE', result: { killed: true } });
}
