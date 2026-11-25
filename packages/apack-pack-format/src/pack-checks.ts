import { z } from 'zod';
import { ALLOWABLE_PACK_CHECKS } from '@apackdev/sdk/framework';

export { ALLOWABLE_PACK_CHECKS };

export const PackChecksSchema = z.object({
  allow: z.array(z.enum(ALLOWABLE_PACK_CHECKS)).describe('Development conventions explicitly allowed by this pack; all other checks remain enabled.').optional(),
}).strict().describe('Build-time source-check policy; does not change runtime permissions.');
