import type { Ears } from '@elmdb/ears';
import type { OnboardingService } from '@apackdev/sdk/services';
import { createAppState } from '../app-state/index.ts';

/** Onboarding belongs to this app's engine, including after another runtime is bound in a test. */
export function createOnboarding(ears: Pick<Ears, 'query' | 'upsert'>): OnboardingService {
  const state = createAppState(ears);
  return {
    isComplete: () => state.get().hasOnboarded,
    complete: () => state.update({ hasOnboarded: true }),
  };
}
