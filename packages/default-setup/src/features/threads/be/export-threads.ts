/**
 * Thread Export (V2)
 *
 * Exports all threads with full message data (blocks, references, commands),
 * artifacts, fork relations, and media from both instructions and messages.
 */

import { query } from '#generated/ears.ts';
import { EARS } from '#generated/ears.ts'
import { createExportDir } from '@apackdev/sdk/utils'
import { extractMediaRefs, copyMediaByRef } from '@apackdev/sdk/utils'
import { writeExportJson } from '@apackdev/sdk/utils'
import type { MediaRef } from '@apackdev/sdk/utils'
import { repository } from '#generated/repository.ts';
import type { ExportedThread, ExportedThreadsData, ExportedMessage, ExportedThreadLink, ExportedArtifact } from './export-types.ts'
import type { MessageEntity } from './types.ts'

export function exportThreads(outputDir: string): { filePath: string; threadCount: number; mediaCopied: number } {
  outputDir = createExportDir(outputDir, 'threads')
  const threads = repository.threadQueries.all()

  const exportedThreads: ExportedThread[] = []

  for (const thread of threads) {
    // Full message data; a link reaches no message in the trash
    const messages = (query.ids(thread.id)
      .out(EARS.RelKind.CONTAINS, EARS.Entity.Message).pick(['id', 'text', 'sender', 'timestamp', 'blocks', 'blockResponse', 'responseTimestamp', 'forkable', 'references', 'isCommand', 'command'] as const) ?? []) as Partial<MessageEntity>[]

    const linkedThreads = repository.threadQueries.linkedThreads(thread.id)

    // Sort messages by timestamp ascending
    const sortedMessages = [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

    const exportedMessages: ExportedMessage[] = sortedMessages.map(msg => {
      const exported: ExportedMessage = {
        text: msg.text || '',
        sender: msg.sender as 'user' | 'assistant' | 'system',
        timestamp: msg.timestamp || 0,
      }
      if (msg.responseTimestamp) exported.responseTimestamp = msg.responseTimestamp
      if (msg.blocks) exported.blocks = msg.blocks
      if (msg.blockResponse !== undefined) exported.blockResponse = msg.blockResponse
      if (msg.forkable !== undefined) exported.forkable = msg.forkable
      if (msg.isCommand) exported.isCommand = msg.isCommand
      if (msg.command) exported.command = msg.command
      if (msg.references) exported.references = msg.references
      return exported
    })

    // The links this thread stores: a block on it is the blocking thread's, and is exported with that one
    const exportedLinks: ExportedThreadLink[] = linkedThreads
      .flatMap((link) => link.relation === 'blocked by' ? [] : [{
        shortCode: link.shortCode as string,
        relation: link.relation,
      }])

    // Query fork source
    const forkedFromIds = query.ids(thread.id)
      .out(EARS.RelKind.FORKED_FROM, EARS.Entity.Thread)
      .ids()
    let forkedFrom: string | undefined
    if (forkedFromIds.length > 0) {
      const sourceThread = query.ids(forkedFromIds[0]).pickAll()[0]
      if (sourceThread?.shortCode) {
        forkedFrom = sourceThread.shortCode as string
      }
    }

    // Query artifacts
    const artifacts = repository.chatQueries.threadArtifacts(thread.id)
    const exportedArtifacts: ExportedArtifact[] = artifacts.map((a: any) => ({
      id: a.id as string,
      artifactType: a.type,
      title: a.title,
      content: a.content,
    }))

    const exported: ExportedThread = {
      id: thread.id,
      topic: thread.topic,
      instructions: thread.instructions,
      status: thread.status,
      tags: thread.tags || [],
      shortCode: thread.shortCode || '',
      timestamp: thread.timestamp,
      messages: exportedMessages,
      linkedThreads: exportedLinks,
      artifacts: exportedArtifacts,
    }

    if (thread.createdAt) exported.createdAt = thread.createdAt
    if (thread.sideTopics?.length) exported.sideTopics = thread.sideTopics
    if (thread.pinned) exported.pinned = thread.pinned
    if (forkedFrom) exported.forkedFrom = forkedFrom

    exportedThreads.push(exported)
  }

  // Collect media refs from instructions AND message text
  const allRefs: MediaRef[] = []
  for (const thread of exportedThreads) {
    allRefs.push(...extractMediaRefs(thread.instructions))
    for (const msg of thread.messages) {
      allRefs.push(...extractMediaRefs(msg.text))
      // Also check image references for media:// URLs
      if (msg.references?.images) {
        for (const img of msg.references.images) {
          if (img.url.startsWith('media://')) {
            allRefs.push(...extractMediaRefs(`![${img.name}](${img.url})`))
          }
        }
      }
    }
  }

  const exportData: ExportedThreadsData = {
    version: 2,
    threads: exportedThreads,
  }

  const filePath = writeExportJson(outputDir, 'exported-threads.json', exportData)

  const mediaCopied = copyMediaByRef(allRefs, outputDir)

  return { filePath, threadCount: exportedThreads.length, mediaCopied }
}
