import type { ClaudeNativeTerminalSession } from '../../../common/native-terminal.ts'

/** The original allocation names an image; only its live owner can supply the broker address. */
export function projectClaudeTerminalImageReferences(tree: unknown, session: ClaudeNativeTerminalSession): unknown {
  let nodes = 0
  function visit(value: unknown, depth = 0): unknown {
    if (++nodes > 8192 || depth > 64) throw new Error('Terminal image projection exceeds its bound')
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1))
    if (!value || typeof value !== 'object') return value
    const node = value as Record<string, unknown>
    if (node.type === 'NativeBrokerImage') throw new Error('Broker image addresses belong to the terminal owner')
    if (node.type === 'NativeImageReference') {
      return { ...node, type: 'NativeBrokerImage', props: { ...(node.props as object), terminalSession: { ...session } } }
    }
    return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, visit(item, depth + 1)]))
  }
  return visit(tree)
}
