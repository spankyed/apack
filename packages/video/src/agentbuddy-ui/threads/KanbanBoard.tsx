import type {CSSProperties, ReactNode} from 'react';
import {ThreadKanbanCard} from './ThreadKanbanCard';
import {KanbanColumn} from './KanbanColumn';
import type {KanbanBoardState, KanbanCardState} from './threadTypes';
import './KanbanBoard.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('KanbanBoard');

type KanbanBoardProps = {
  children?: ReactNode;
  movingCard?: {
    card: KanbanCardState;
    style: CSSProperties;
  };
  state?: KanbanBoardState;
};

export function KanbanBoard({children, movingCard, state}: KanbanBoardProps) {
  return (
    <div className={styles.root}>
      {state ? state.columns.map(column => {
        const count = column.count ?? column.cards.length;
        return (
          <KanbanColumn count={count} key={column.title} title={column.title} tone={column.tone}>
            {column.cards.map(card => <ThreadKanbanCard key={card.title} tags={card.tags}>{card.title}</ThreadKanbanCard>)}
          </KanbanColumn>
        );
      }) : children}
      {movingCard ? (
        <div className={styles.movingCard} style={movingCard.style}>
          <ThreadKanbanCard active tags={movingCard.card.tags}>{movingCard.card.title}</ThreadKanbanCard>
        </div>
      ) : null}
    </div>
  );
}
