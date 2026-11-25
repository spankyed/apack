/**
 * The chat's slash commands.
 *
 * **A command is content, and the app reads it.** A pack ships commands the way it ships actions, prompts
 * and flows — a content source, compiled and applied, three-way merged, and editable afterwards. The rows
 * those applies write are `Document`s the SDK owns, so the list is a derivation over the app's own data
 * rather than something a pack hands over. No designation, no provider, no registration: a pack that wants
 * to ship commands writes documents, and a pack that wants to *edit* them edits documents.
 *
 * **One source, so no precedence rule.** Every command is a field of a document of
 * `COMMANDS_DOCUMENT_TYPE`, so there is nothing to merge and no declaration a document could shadow.
 */
import { documentRepository } from '../repositories/document-repository.ts';
import type { ContentSection } from '../types/sdk-entities.ts';
import { _boundBackendHost, _isBackendHostBound } from '../runtime/backend-port.ts';
import { boundFeHost, _isFeHostBound } from '../runtime/fe-host.ts';

/**
 * The `documentType` that marks a document a slash-command list.
 *
 * Both halves must agree on it: a content format stamps it as it writes, and this module reads it back.
 */
export const COMMANDS_DOCUMENT_TYPE = 'commands';

/** A slash command: the name typed after the `/`, and what the chat shows after it */
export interface PackCommand {
  name: string;
  placeholder: string;
}

/**
 * The commands the stored documents define: the field sections of every command document, in document
 * order then name, one `**name**: placeholder` field per command.
 *
 * A name two documents define keeps the first. That is a display rule rather than a precedence one —
 * there is one source — and it is why this returns a list rather than refusing.
 *
 * **This is the backend's answer and the one the app publishes.** Code that only wants the list calls
 * `getCommands()`; the publisher calls this, because `getCommands()` prefers a bound frontend and would
 * hand the publisher back the copy it is about to send.
 */
export function commandsFromDocuments(): PackCommand[] {
  const commands = new Map<string, PackCommand>();
  for (const document of documentRepository.ofType(COMMANDS_DOCUMENT_TYPE)) {
    for (const section of (document.content ?? []) as ContentSection[]) {
      if (section.type !== 'field') continue;
      for (const field of section.fields) {
        if (!commands.has(field.key)) commands.set(field.key, { name: field.key, placeholder: field.value });
      }
    }
  }
  return [...commands.values()];
}

/**
 * The commands, wherever the caller runs.
 *
 * **A bound frontend wins**, as it does for sends and for the registered packs' lookups
 * (`_boundPackExtensions`). The rows live on the backend, so a window reads the list the app published,
 * which the shell holds (`HostShellState.commands`). One name for both hosts, so a caller says what it
 * wants rather than where it runs.
 *
 * It is a plain read, not a reactive one. A component or composable that must re-render when the list
 * changes reads `useShell().commands` (`@apackdev/sdk/fe`) instead; this is for code with no scope to
 * follow it in, such as a ProseMirror plugin reading the list as a transaction arrives.
 */
export function getCommands(): PackCommand[] {
  if (_isFeHostBound()) return [...boundFeHost().application.getSnapshot().context.commands];
  if (_isBackendHostBound()) { _boundBackendHost(); return commandsFromDocuments(); }
  throw new Error('No host is bound to read the commands from: call bindHost(runtime) (backend) or bindFeHost(runtime) (frontend) from @apackdev/sdk/runtime first');
}
