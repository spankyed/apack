import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {KanbanBoardState, KanbanCardState} from './threadTypes';
import './ThreadListView.module.css';

const styles = makeStyles('ThreadListView');

type ThreadListViewProps = {
  board: KanbanBoardState;
};

export function ThreadListView({board}: ThreadListViewProps) {
  const rows = board.columns.flatMap(column => column.cards.map(card => ({card, status: column.title})));

  return (
    <div className={styles.root}>
      <div className={styles.table}>
        <div className={styles.headerRow}>
          <span>Thread</span>
          <span>Status</span>
          <span>Tags</span>
          <span>Updated</span>
        </div>
        {rows.map(({card, status}, index) => (
          <ThreadRow card={card} index={index} key={`${status}-${card.title}`} status={status} />
        ))}
      </div>
    </div>
  );
}

function ThreadRow({card, index, status}: {card: KanbanCardState; index: number; status: string}) {
  return (
    <div className={styles.row}>
      <div className={styles.titleCell}>
        <Icons.MessageSquare size={15} />
        <span>{card.title}</span>
      </div>
      <span className={styles.status}>{status}</span>
      <div className={styles.tags}>
        {card.tags?.map(tag => <span key={tag}>{tag}</span>)}
      </div>
      <span className={styles.updated}>{card.updatedAt ?? (index === 0 ? 'just now' : `${index + 2}m ago`)}</span>
    </div>
  );
}
