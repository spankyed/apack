import type {CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import type {ChatComposerState} from './chatTypes';
import {Icons} from '../primitives/Icon';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('ChatComposer');

type NewThreadMenuState = NonNullable<NonNullable<ChatComposerState['bottomTabs']>['newThreadMenu']>;
const rendererSubmenuWidth = 200;
const rendererSubmenuSideOffset = 4;
const rendererProjectTriggerOffset = 0;
const rendererChildTriggerOffset = 45;

/*
 * Mirrors the New thread context menu in packages/renderer/src/plugins/threads/chat/recent-threads.vue.
 * Fixed-positioned menus are portaled to body, matching Reka's ContextMenuPortal.
 */
export function NewThreadContextMenu({menu}: {menu: NewThreadMenuState}) {
  const popup = (
    <>
      <div className={styles.newThreadContextMenu} style={newThreadMenuStyle(menu.popupPosition)}>
        <div className={styles.newThreadContextMenuSub} data-open={menu.openSubmenu === 'project' ? 'true' : undefined}>
          <Icons.FolderOpen size={16} />
          <span>In Project</span>
          <Icons.ChevronRight className={styles.newThreadContextChevron} size={12} />
        </div>
        <div className={styles.newThreadContextSeparator} />
        <div className={styles.newThreadContextMenuSub} data-open={menu.openSubmenu === 'child' ? 'true' : undefined}>
          <Icons.GitBranchPlus size={16} />
          <span>As Child of</span>
          <Icons.ChevronRight className={styles.newThreadContextChevron} size={12} />
        </div>
      </div>
      {menu.openSubmenu === 'project' ? <ProjectSubmenu position={menu.popupPosition} projects={menu.projects} /> : null}
      {menu.openSubmenu === 'child' ? <ChildThreadSubmenu position={menu.popupPosition} threads={menu.threads} /> : null}
    </>
  );

  if (typeof document !== 'undefined') {
    return createPortal(popup, document.body);
  }

  return popup;
}

function newThreadMenuStyle(position: NewThreadMenuState['popupPosition']): CSSProperties {
  const left = position?.left ?? 0;
  const top = position?.top;
  const bottom = position?.bottom ?? 0;
  return top == null
    ? {
        bottom: `${bottom}px`,
        left: `${left}px`,
        position: 'fixed',
        right: 'auto',
      }
    : {
        left: `${left}px`,
        position: 'fixed',
        right: 'auto',
        top: `${top}px`,
      };
}

function newThreadSubmenuStyle(position: NewThreadMenuState['popupPosition'], trigger: 'child' | 'project'): CSSProperties {
  const triggerOffset = trigger === 'project' ? rendererProjectTriggerOffset : rendererChildTriggerOffset;
  const base = {
    left: `${(position?.left ?? 0) - rendererSubmenuWidth - rendererSubmenuSideOffset}px`,
    minWidth: `${rendererSubmenuWidth}px`,
    position: 'fixed' as const,
    right: 'auto',
  };

  if (position?.top != null) {
    return {
      ...base,
      top: `${position.top + triggerOffset}px`,
    };
  }

  return {
    ...base,
    bottom: `${position?.bottom ?? 0}px`,
  };
}

function ProjectSubmenu({position, projects}: {position: NewThreadMenuState['popupPosition']; projects: NewThreadMenuState['projects']}) {
  return (
    <div className={styles.newThreadContextSubmenu} style={newThreadSubmenuStyle(position, 'project')}>
      <div className={styles.newThreadContextMutedItem}>No project (ask me)</div>
      {projects.map(project => (
        <div key={project.name}>
          <div className={styles.newThreadContextSeparator} />
          <div className={styles.newThreadContextProjectHeader}>
            <span className={styles.newThreadContextProjectDot} style={{backgroundColor: project.color}} />
            <span className={styles.newThreadContextProjectName}>{project.name}</span>
          </div>
          {project.directories.map(directory => (
            <div className={styles.newThreadContextSubItem} key={directory}>
              <span>{directoryName(directory)}</span>
            </div>
          ))}
        </div>
      ))}
      {projects.length === 0 ? <div className={styles.newThreadContextEmpty}>No projects configured</div> : null}
    </div>
  );
}

function ChildThreadSubmenu({position, threads}: {position: NewThreadMenuState['popupPosition']; threads: NewThreadMenuState['threads']}) {
  return (
    <div className={styles.newThreadContextSubmenu} style={newThreadSubmenuStyle(position, 'child')}>
      {threads.map(thread => (
        <div className={styles.newThreadContextChildItem} key={thread.id}>
          <div className={styles.newThreadContextChildBody}>
            <small>{thread.shortCode}</small>
            <span>{thread.topic || 'Untitled'}</span>
          </div>
        </div>
      ))}
      {threads.length === 0 ? <div className={styles.newThreadContextChildEmpty}>No threads available</div> : null}
    </div>
  );
}

function directoryName(directory: string) {
  return directory.split('/').filter(Boolean).pop() || directory;
}
