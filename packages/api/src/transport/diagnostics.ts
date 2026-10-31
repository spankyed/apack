import { z } from 'zod';

/** Preserve only a bounded invalid marker on malformed input, so recording reports loss without refusing application work. */
export const diagnosticCarrier = z.object({
  traceparent: z.string().max(512).optional(),
  tracestate: z.string().max(512).optional(),
}).optional().catch({ traceparent: '' });
