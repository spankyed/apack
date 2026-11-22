// What an ask a spec made of the code system ended with, as a value to assert on: its answer, or its refusal. Each
// throws naming the other outcome, so a case expecting an answer fails on the refusal's message and not on a field
// read from `undefined` several lines later.
import type { UntypedAskOutcome } from '@apackdev/sdk/events';

/**
 * What the ask was answered with; throws its refusal. Typed `any`: it is whatever the asked handler returned, which
 * the untyped harness cannot know, and a case reads its fields
 */
export async function answered(asked: Promise<UntypedAskOutcome>): Promise<any> {
  const outcome = await asked;
  if (!outcome.ok) throw new Error(`Refused (${outcome.failure.kind}): ${outcome.failure.message}`);
  return outcome.value;
}

/** Why the ask was refused: its kind, its message and the data its kind carries; throws its answer */
export async function refused(asked: Promise<UntypedAskOutcome>): Promise<any> {
  const outcome = await asked;
  if (outcome.ok) throw new Error(`Answered, where a refusal was expected: ${JSON.stringify(outcome.value)}`);
  return outcome.failure;
}
