import type {ComponentType} from 'react';
import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {NoteTreeNodeState} from './noteTypes';
import './NoteTreeItem.module.css';

const styles = makeStyles('NoteTreeItem');

type NoteTreeItemProps = {
  activeId: string;
  depth?: number;
  node: NoteTreeNodeState;
  taskMode?: boolean;
};

// Mirrors packages/renderer/src/plugins/notes/components/NoteTreeItem.vue.
export function NoteTreeItem({activeId, depth = 0, node, taskMode}: NoteTreeItemProps) {
  const isActive = node.id === activeId;
  const completed = Boolean(node.completed);
  const isTask = node.noteType === 'task';
  const children = node.children ?? [];
  const menuOpen = Boolean(node.rowMenuOpen);
  return (
    <div>
      <div
        className={cx(styles.row, isActive && styles.active, menuOpen && styles.menuOpenRow, taskMode && completed && styles.completed, node.muted && styles.muted)}
        style={{paddingLeft: depth * 8 + 8}}
      >
        <button className={styles.iconButton} type="button">
          {children.length > 0 ? <Icons.ChevronRight className={styles.chevronExpanded} size={16} /> : <NoteGlyph node={node} />}
        </button>
        <span className={cx(styles.title, completed && styles.titleCompleted)}>{node.title || 'Untitled'}</span>
        {taskMode && isTask ? (
          <>
            <RowActions menuOpen={menuOpen} node={node} taskMode />
            <TaskCheckbox completed={completed} />
          </>
        ) : (
          <RowActions menuOpen={menuOpen} node={node} taskMode={taskMode} />
        )}
      </div>
      {children.map(child => <NoteTreeItem key={child.id} activeId={activeId} depth={depth + 1} node={child} taskMode={taskMode} />)}
    </div>
  );
}

function NoteGlyph({node}: {node: NoteTreeNodeState}) {
  if (node.icon) return <span className={styles.emoji}>{node.icon}</span>;
  if (node.noteType === 'tasklist') return <Icons.ListChecks className={styles.neutralIcon} size={16} />;
  if (node.noteType === 'task') return <Icons.CircleCheck className={styles.neutralIcon} size={16} />;
  return <Icons.Notes className={styles.neutralIcon} size={16} />;
}

function RowActions({menuOpen, node, taskMode}: {menuOpen: boolean; node: NoteTreeNodeState; taskMode?: boolean}) {
  const isTaskRelated = node.noteType === 'tasklist' || node.noteType === 'task';
  return (
    <div className={cx(styles.actionPill, menuOpen && styles.actionPillVisible)}>
      <button className={menuOpen ? styles.actionButtonActive : undefined} type="button"><Icons.MoreHorizontal size={13} /></button>
      <button type="button"><Icons.Plus size={13} /></button>
      {menuOpen ? <RowMenu isTaskRelated={isTaskRelated} node={node} taskMode={taskMode} /> : null}
    </div>
  );
}

function RowMenu({isTaskRelated, node, taskMode}: {isTaskRelated: boolean; node: NoteTreeNodeState; taskMode?: boolean}) {
  const menuItems: Array<{danger?: boolean; icon: ComponentType<{className?: string; size?: number}>; iconAccent?: boolean; label: string}> = [];
  if (isTaskRelated) menuItems.push({icon: Icons.FilePlus, label: 'Add Document'});
  if (!isTaskRelated) menuItems.push({icon: Icons.ClipboardList, label: 'Add Tasklist'});
  if (taskMode && node.hasCompletedChildren) {
    menuItems.push({
      icon: node.hidingCompletedChildren ? Icons.Eye : Icons.EyeOff,
      label: node.hidingCompletedChildren ? 'Show Completed' : 'Hide Completed',
    });
  }
  menuItems.push({
    icon: Icons.Star,
    iconAccent: node.favorite,
    label: node.favorite ? 'Remove from Favorites' : 'Add to Favorites',
  });
  menuItems.push({icon: Icons.Copy, label: 'Copy Id'});
  menuItems.push({danger: true, icon: Icons.Trash2, label: 'Delete'});

  return (
    <div className={styles.menu}>
      {menuItems.map(item => {
        const Icon = item.icon;
        return (
          <button className={cx(item.danger && styles.menuItemDanger)} key={item.label} type="button">
            <Icon className={cx(styles.menuIcon, item.iconAccent && styles.menuIconAccent, item.danger && styles.menuIconDanger)} size={14} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TaskCheckbox({completed}: {completed: boolean}) {
  return (
    <button className={cx(styles.checkbox, completed && styles.checkboxChecked)} type="button">
      {completed ? <Icons.Check size={10} /> : null}
    </button>
  );
}
