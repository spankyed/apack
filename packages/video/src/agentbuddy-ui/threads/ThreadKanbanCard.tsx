import type {ReactNode} from 'react';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './ThreadKanbanCard.module.css';

const styles = makeStyles('ThreadKanbanCard');

// Mirrors the thread card article in packages/renderer/src/plugins/threads/canvas/kanban.vue.
export function ThreadKanbanCard({active, children, tags = []}: {active?: boolean; children: ReactNode; tags?: string[]}) {
  return (
    <article className={active ? styles.activeRoot : styles.root}>
      <div className={styles.top}>
        <p><span>{children}</span></p>
        <Icons.SquarePen className={styles.editIcon} size={14} />
      </div>
      {tags.length > 0 ? <div className={styles.tags}>{tags.map(tag => <span key={tag}>{tag}</span>)}</div> : null}
    </article>
  );
}
