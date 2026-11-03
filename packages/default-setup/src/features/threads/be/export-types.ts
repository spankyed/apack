import type { BlockConfig, BlockResponse, MessageReferences, ArtifactType, ThreadRelation } from './types.ts'

export interface ExportedMessage {
  text: string
  sender: 'user' | 'assistant' | 'system'
  timestamp: number
  responseTimestamp?: number
  blocks?: BlockConfig[]
  /**
   * Block response as stored on the message at export time. See
   * `BlockResponse` in `./types` for the full union of observed shapes
   * (raw strings, string arrays, `{approved,reason}`, `{cancelled:true}`).
   * Import round-trips whatever an export carries, unchanged.
   */
  blockResponse?: BlockResponse
  forkable?: boolean
  isCommand?: boolean
  command?: string
  references?: MessageReferences
}

export interface ExportedThreadLink {
  shortCode: string
  relation: ThreadRelation
}

export interface ExportedArtifact {
  id: string
  artifactType: ArtifactType
  title?: string
  content: any
}

export interface ExportedThread {
  id: string
  topic: string
  instructions: string
  status: string
  tags: string[]
  shortCode: string
  timestamp: number
  createdAt?: number
  sideTopics?: string[]
  pinned?: boolean
  messages: ExportedMessage[]
  linkedThreads: ExportedThreadLink[]
  forkedFrom?: string
  artifacts: ExportedArtifact[]
}

export interface ExportedThreadsData {
  version: number
  threads: ExportedThread[]
}
