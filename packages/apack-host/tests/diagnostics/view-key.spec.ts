import { expect, it } from 'vitest';
import { viewKey } from '@apackdev/sdk/framework';

it('does not turn diagnostic context into another query or retain it in its identity', () => {
  const request = { ref: 'pack/feature', view: 'page', args: { id: 'business-id' } };
  expect(viewKey({ ...request, diagnostics: { traceparent: 'private-context' } })).toBe(viewKey(request));
  expect(viewKey(request)).not.toContain('private-context');
});
