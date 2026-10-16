// Inert wire presentation only. No native handles or process dependencies.
export type ClaudeUiNode =
  | { kind: 'text'; text: string; plugin?: string }
  | { kind: 'box'; children: ClaudeUiNode[]; plugin?: string }
  | { kind: 'button'; label: string; actionId?: string; plugin?: string }
  | { kind: 'unsupported'; component: string; plugin?: string }

export type ClaudeUiMountState =
  | { status: 'connecting' | 'rendering' | 'disconnected' }
  | { status: 'live'; tree: ClaudeUiNode }
  | { status: 'error'; message: string }

