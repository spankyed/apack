import {test} from '@apackdev/testing'
import {verifyAgentBilling,AGENT_BILLING_JOURNEY_TIMEOUT_MS} from '../../fixtures/claude-research/agent-billing-journey.ts'
const workspace=process.env.CLAUDE_RESEARCH_WORKSPACE,project=process.env.CLAUDE_RESEARCH_PROJECT,launcher=process.env.CLAUDE_RESEARCH_LAUNCHER,onboarding=process.env.CLAUDE_RESEARCH_ONBOARDING
test.skip(!workspace||!project||!launcher||!onboarding||process.env.CLAUDE_RESEARCH_AGENT_BILLING!=='1','Explicit owned Agent billing fixture required')
test.describe.configure({timeout:AGENT_BILLING_JOURNEY_TIMEOUT_MS})
test('keeps original billing visible in an otherwise empty selected-Agent status strip',async({app,appPage,electronApp},testInfo)=>{
 await verifyAgentBilling({app,appPage,electronApp},testInfo,{workspace:workspace!,project:project!,launcher:launcher!,onboarding:onboarding!})
})
