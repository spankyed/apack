import type {ReactNode} from 'react';
import type {CSSProperties} from 'react';
import {makeStyles} from '../primitives/makeStyles';
import {NoteEditor} from './NoteEditor';
import type {NoteImageBlockState} from './NoteImageBlock';
import {TaskListPanel} from './TaskListPanel';
import type {NoteTreeNodeState} from './noteTypes';
import './NotesLayout.module.css';

const styles = makeStyles('NotesLayout');

type NotesLayoutProps = {
  editor: {
    afterLines: ReactNode[];
    beforeLines: ReactNode[];
    image?: NoteImageBlockState;
    title: {
      icon: string;
      text: string;
    };
  };
  editorStyle?: CSSProperties;
  showTaskList?: boolean;
  taskListStyle?: CSSProperties;
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
export function NotesLayout({editor, editorStyle, showTaskList = true, taskList, taskListStyle}: NotesLayoutProps) {
  return (
    <div className={styles.root}>
      {showTaskList ? (
        <div className={styles.taskListWrap} style={taskListStyle}>
          <TaskListPanel activeId={taskList.activeId} items={taskList.items} showCompleted={taskList.showCompleted} title={taskList.title} />
        </div>
      ) : null}
      <NoteEditor afterLines={editor.afterLines} beforeLines={editor.beforeLines} image={editor.image} style={editorStyle} title={editor.title} />
    </div>
  );
}
