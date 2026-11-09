/** Original Agent output, attributed to its native task; never person input or approval. */
export interface ClaudeAgentHandback {
  taskId: string
  runId?: string
  text: string
  warning?: string
}
