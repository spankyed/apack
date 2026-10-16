import { z } from 'zod'
import { ClaudeProtocolError } from './errors.ts'
import type { ClaudeInitialization, createHostControls } from './host-controls.ts'

const clientId = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)
const surface = z.enum(['desktop', 'mobile', 'vscode'])
const surfaces = z.array(z.enum(['terminal', 'desktop', 'mobile', 'vscode']))
const viewport = z.object({ columns: z.number().int().positive(), rows: z.number().int().positive(), isFullscreen: z.boolean().optional() }).strict()
const attach = z.object({ client_id: clientId, surface, viewport: viewport.optional() }).strict()
const render = z.object({ client_id: clientId, surface, component: z.string(), instance_id: z.string(), props: z.record(z.unknown()), viewport: viewport.optional() }).strict()
const press = z.object({ client_id: clientId, surface, plugin: z.string(), handle: z.number().int().safe(), key: z.string().optional(), href: z.string().max(2048).optional() }).strict()
const renderResult = z.object({ tree: z.unknown(), props: z.record(z.unknown()), rewritten: z.boolean(), hooked: z.boolean(), drawn_by: z.array(z.string()).optional(), client_modules: z.record(z.string()).optional() }).passthrough().refine(value => value.tree !== undefined, 'native UI response must contain a tree')

export type ClaudeUiAttach = z.infer<typeof attach>
export type ClaudeUiRender = z.infer<typeof render>
export type ClaudeUiPress = z.infer<typeof press>
export type ClaudeUiRenderResult = z.infer<typeof renderResult>

/** Native UI transport only. A renderer must validate tree nodes before displaying them. */
export function createClaudeUiControls(initialized: Promise<ClaudeInitialization>, controls: Pick<ReturnType<typeof createHostControls>, 'request'>) {
  async function request(value: Record<string, unknown> & { subtype: string }): Promise<unknown> {
    const metadata = await initialized
    if (!metadata.capabilities?.includes('ui_surface_v1')) throw new ClaudeProtocolError('native UI surface capability is unavailable')
    return controls.request(value)
  }
  return {
    /** No reverse clipboard/composer/selection handlers are advertised. */
    async attach(options: ClaudeUiAttach) {
      const valid = attach.parse(options)
      return z.object({ surfaces }).passthrough().parse(await request({ subtype: 'ui_attach', ...valid, answers: [] }))
    },
    async detach(id: string) {
      const valid = clientId.parse(id)
      return z.object({ detached: z.boolean(), surfaces }).passthrough().parse(await request({ subtype: 'ui_detach', client_id: valid }))
    },
    async render(options: ClaudeUiRender): Promise<ClaudeUiRenderResult> {
      const valid = render.parse(options)
      return renderResult.parse(await request({ subtype: 'ui_render', ...valid }))
    },
    /** Forward the capability issued in the current tree; a stale handle returns handled:false. */
    async press(options: ClaudeUiPress) {
      const valid = press.parse(options)
      return z.object({ handled: z.boolean(), element: z.string().optional() }).passthrough().parse(await request({ subtype: 'ui_press', ...valid }))
    },
  }
}

export type ClaudeUiControls = ReturnType<typeof createClaudeUiControls>
