import { create, write, query } from '#generated/ears.ts';

import { EARS } from '#generated/ears.ts'

import { createLogger } from '@apackdev/sdk/logger'

const logger = createLogger('code')

// Define Terminal entity type with required attributes
export interface TerminalEntity {
  id: EARS.EntityId
  entityType: EARS.Entity.Terminal
  title: string
  customTitle?: string
  /**
   * **No pid.** A row used to carry the process id its session had, and `restoreAll` reached for it on the
   * next boot — checking whether that process was alive and killing it and its group, which is F7, and
   * which could name a process the OS had since given to something else. The broker owns the processes a run
   * leaves behind, so nothing persisted addresses one. The live descriptor still carries a pid, because the
   * renderer tells a new shell from the previous one by it; that is a diagnostic, not a handle.
   */
  shell: string
  cwd: string
  cols: number
  rows: number
  createdAt: number
  updatedAt: number
}

export const terminalQueries = {
  byId: (id: EARS.EntityId): TerminalEntity | undefined => {
    return query.ids(id).ofType(EARS.Entity.Terminal).pickOne() ?? undefined
  },

  /**
   * The terminals there are — which is every row, because **a closed one leaves none** (L3). A query leaves
   * out the trash, and `markClosed` puts a row there, so there is no `active` attribute to filter on and no
   * second record of whether a terminal exists.
   */
  all: (): TerminalEntity[] => {
    return query(EARS.Entity.Terminal).pickAll()
  },
}

export const terminalCommands = {
  /** Records a terminal the service started, under the id it took for it (`newId`) */
  create: (terminal: Pick<TerminalEntity, 'title' | 'shell' | 'cwd' | 'cols' | 'rows'> & { id: EARS.EntityId<'Terminal'> }): EARS.EntityId => {
    return create(EARS.Entity.Terminal, terminal).id()
  },
  
  
  rename: (id: EARS.EntityId, customTitle: string): void => {
    if (!query.ids(id).exists()) {
      logger.error(`Terminal ${id} not found`)
      return
    }

    write(id).setMany({
      customTitle
    })
  },

  updateCwd: (id: EARS.EntityId, cwd: string, title?: string): void => {
    if (!query.ids(id).exists()) {
      logger.error(`Terminal ${id} not found`)
      return
    }

    const updates: any = {
      cwd
    }

    // Update title if provided (when no customTitle is set)
    if (title) {
      updates.title = title
    }

    write(id).setMany(updates)
  },
  
  
  /**
   * The terminal is gone, so its row goes to the trash — **the one way a Terminal row ends** (L3).
   *
   * It used to set `active: false` and a `closedAt` nothing ever read, leaving a row behind for every
   * terminal the user had ever opened; beside it sat an unreached `delete` that did the trashing. Nothing
   * reads a closed terminal: `restoreAll` opens what the query answers, and that is the whole of what a row
   * is for. So there is one path, and it removes the record rather than annotating it.
   */
  markClosed: (id: EARS.EntityId): void => {
    // **Already gone is the desired state, not an error.** A kill closes the row and the exit that follows
    // closes it again; so does a restore that failed after its session had already exited. The row being
    // absent is what this call is for
    if (!query.ids(id).exists()) return

    write(id).trash()
  }
}

