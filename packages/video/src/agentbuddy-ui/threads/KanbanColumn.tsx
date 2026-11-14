import type {ReactNode} from 'react';
import {makeStyles} from '../primitives/makeStyles';
import './KanbanColumn.module.css';

const styles = makeStyles('KanbanColumn');

// Mirrors one status column from packages/renderer/src/plugins/threads/canvas/kanban.vue.
export function KanbanColumn({children, count, tone = 'neutral', title}: {children?: ReactNode; count: number; title: string; tone?: 'neutral' | 'blue' | 'emerald'}) {
  return (
    <section className={styles.root}>
      <header className={styles.header} data-tone={tone}>
        <span>{title}</span>
        <small>({count})</small>
      </header>
      <div className={styles.list}>
        {children}
        <div className={styles.afterSpacer} />
      </div>
    </section>
  );
}
