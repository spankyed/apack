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
  active: boolean
  cols: number
  rows: number
  createdAt: number
  updatedAt: number
  closedAt?: number
}

export const terminalQueries = {
  byId: (id: EARS.EntityId): TerminalEntity | undefined => {
    return query.ids(id).ofType(EARS.Entity.Terminal).pickOne() ?? undefined
  },

  all: (): TerminalEntity[] => {
    return query(EARS.Entity.Terminal).pickAll()
  },

  active: (): TerminalEntity[] => {
    // A query already leaves out the trash; keep the active ones
    const all = query(EARS.Entity.Terminal).pickAll()
    return all.filter(t => t.active === true)
  },
}

export const terminalCommands = {
  /** Records a terminal the service started, under the id it took for it (`newId`) */
  create: (terminal: Pick<TerminalEntity, 'title' | 'shell' | 'cwd' | 'cols' | 'rows'> & { id: EARS.EntityId<'Terminal'> }): EARS.EntityId => {
    return create(EARS.Entity.Terminal, { ...terminal, active: true }).id()
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
  
  
  markClosed: (id: EARS.EntityId): void => {
    if (!query.ids(id).exists()) {
      logger.error(`Terminal ${id} not found`)
      return
    }
    
    const now = Date.now()
    write(id).setMany({
      active: false,
      closedAt: now
    })
  },
  
  delete: (id: EARS.EntityId): void => {
    if (!query.ids(id).exists()) {
      logger.error(`Terminal ${id} not found`)
      return
    }

    // To the trash, inactive, rather than deleted
    write(id).set('active', false).trash()
  }
}

