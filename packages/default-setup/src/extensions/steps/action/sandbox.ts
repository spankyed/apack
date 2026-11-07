import { z } from 'zod';
import type { PackServiceAccess } from '@apackdev/sdk/services';

export interface ActionRun {
  /** Names the action's logger and stamps its sends: `action:<label>` */
  label: string;
  params: Record<string, unknown>;
  /** The accepted executing runtime supplies named views without expanding its API selection. */
  servicesForAction: PackServiceAccess['servicesForAction'];
  /** The running flow's RunNode, when a flow step runs the action */
  flowId?: string;
}

/**
 * Runs action code, an async function body, with `params`, `services`, `z` and `flowId`: how a flow's action
 * step and `services.action` run an action.
 *
 * This is where an action stops being anonymous. Its code is a string from the database, so nothing downstream
 * can work out who wrote a message it sends; here both halves are in hand, and go on every message as the pack
 * (`Message.from`) and the action (`Message.via`).
 */
export function runActionCode(actionFn: string, { label, params, servicesForAction, flowId }: ActionRun): Promise<unknown> {
  const actionServices = servicesForAction(label);
  // `z` and `flowId` come from an enclosing scope, so the code can declare its own
  const scoped = new Function('z', 'flowId', `return async function (params, services) {\n${actionFn}\n};`);
  return scoped(z, flowId)(params, actionServices);
}
