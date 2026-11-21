import type {ReactNode} from 'react';
import {makeStyles} from '../primitives/makeStyles';
import {NoteEditor} from './NoteEditor';
import {TaskListPanel} from './TaskListPanel';
import type {NoteTreeNodeState} from './noteTypes';
import './NotesLayout.module.css';

const styles = makeStyles('NotesLayout');

type NotesLayoutProps = {
  editor: {
    afterLines: ReactNode[];
    beforeLines: ReactNode[];
    title: {
      icon: string;
      text: string;
    };
  };
  taskList: {
    activeId?: string | null;
    items: NoteTreeNodeState[];
    showCompleted?: boolean;
    title: {
      icon: string;
      text: string;
    };
  };
};

// Mirrors the notes plugin main panel: task list on the left, note editor on
// the right. Film-specific note text is passed in from film/state via shots.
export function NotesLayout({editor, taskList}: NotesLayoutProps) {
  return (
    <div className={styles.root}>
      <TaskListPanel activeId={taskList.activeId} items={taskList.items} showCompleted={taskList.showCompleted} title={taskList.title} />
      <NoteEditor afterLines={editor.afterLines} beforeLines={editor.beforeLines} title={editor.title} />
    </div>
  );
}
