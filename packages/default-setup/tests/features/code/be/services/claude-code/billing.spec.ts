import { createClaudeBillingState, claudeBillingText, ClaudeRateLimitInfoSchema } from '../../../../../../src/features/code/common/native-billing.ts'

it('retains only native billing fields and refuses malformed, foreign and older observations', () => {
 const state = createClaudeBillingState(); state.reset('a')
 expect(state.observe('a', {status:'allowed_warning',isUsingOverage:true,secret:'never publish'}, 10)).toBe(true)
 expect(state.value?.info).not.toHaveProperty('secret')
 expect(state.observe('b', {status:'rejected'}, 20)).toBe(false)
 expect(state.observe('a', {status:'rejected'}, 9)).toBe(false)
 expect(state.observe('a', {isUsingOverage:'yes'}, 11)).toBe(false)
 expect(state.value?.info.status).toBe('allowed_warning')
 state.reset('b'); expect(state.value).toBeUndefined()
 expect(state.observe('a', {status:'allowed'}, 30)).toBe(false)
 expect(ClaudeRateLimitInfoSchema.parse({future: true}).future).toBe(true)
})
it('does not infer subscription billing or prevention of an already reported charge', () => {
 const state = createClaudeBillingState(); state.reset('a')
 expect(claudeBillingText()).toContain('unknown')
 state.observe('a', {status:'allowed'}); expect(claudeBillingText(state.value)).toContain('Billing route unknown')
 state.observe('a', {status:'rejected',isUsingOverage:true,resetsAt:1800000000})
 expect(claudeBillingText(state.value)).toContain('Usage limit reached')
 expect(claudeBillingText(state.value)).toContain('Usage credits charged on the reported request')
 expect(claudeBillingText(state.value)).toContain('Resets 2027-')
})
