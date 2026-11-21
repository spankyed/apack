import type {CSSProperties} from 'react';
import {KanbanBoard} from './KanbanBoard';
import {ThreadsHeader} from './ThreadsHeader';
import type {KanbanBoardState, KanbanCardState, ThreadsHeaderState} from './threadTypes';
import './ThreadsBoardSurface.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('ThreadsBoardSurface');

type ThreadsBoardSurfaceProps = {
  board: KanbanBoardState;
  header: ThreadsHeaderState;
  movingCard?: {
    card: KanbanCardState;
    style: CSSProperties;
  };
};

// Reusable board surface matching the renderer's threads canvas header + kanban stack.
export function ThreadsBoardSurface({board, header, movingCard}: ThreadsBoardSurfaceProps) {
  return (
    <div className={styles.root}>
      <ThreadsHeader state={header} />
      <KanbanBoard state={board} movingCard={movingCard} />
    </div>
  );
}
