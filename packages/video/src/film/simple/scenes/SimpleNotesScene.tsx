import type {ReactNode} from 'react';
import {AppWindow} from '../../../agentbuddy-ui/chrome/AppWindow';
import {NotesLayout} from '../../../agentbuddy-ui/notes/NotesLayout';
import {NotesHomeSurface} from '../../../agentbuddy-ui/notes/NotesHomeSurface';
import {NotesRightRail} from '../../../agentbuddy-ui/notes/NotesRightRail';
import {ReferencePill} from '../../../agentbuddy-ui/chat/ReferencePill';
import {TextCaret} from '../../../agentbuddy-ui/primitives/TextCaret';
import {notesEditorViewForFrame, notesHomeViewForFrame, notesEditorChromeTargets, notesEditorInteractions, notesHomeInteractions, notesTaskPanelTargets, type NotesEditorLineView, type NotesEditorTargetId, type NotesHomeTargetId} from '../../state/notes';
import {Cursor} from '../../overlays/Cursor';
import type {CursorPath, TargetRect} from '../../interaction/cursorTargets';
import {useAppWindowLayout} from '../../appWindowLayout';
import {makeStyles} from '../../../agentbuddy-ui/primitives/makeStyles';
import {useVideoConfig} from 'remotion';
import {notesHomeNewNoteButtonTarget} from '../../shots/notesGeometry';
import '../../shots/NotesShot.module.css';

const styles = makeStyles('NotesShot');
const notesHomeDuration = 156;

// One long notes-chapter scene with no fades: clicking New Note swaps the
// home surface for the editor instantly, clicking notes in the right rail
// swaps the open note instantly, and the tasklist panel is simply part of
// the tasklist note's layout — exactly how the app behaves.
export function SimpleNotesScene({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  if (frame < notesHomeDuration) {
    return <SimpleNotesHome frame={frame} variant={variant} />;
  }
  return <SimpleNotesEditor frame={frame - notesHomeDuration} variant={variant} />;
}

function SimpleNotesHome({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const home = notesHomeViewForFrame(frame);
  const {height, width} = useVideoConfig();
  const layout = useAppWindowLayout({animate: false, variant});
  const cursor = notesHomeCursorForFrame(frame, layout, width, height);

  return (
    <div className={styles.root}>
      <AppWindow
        activePlugin="notes"
        breadcrumbs={['Notes']}
        layout={layout}
        mainBackground="rgb(23 23 23)"
        surfaceBackground="rgb(23 23 23)"
      >
        <NotesHomeSurface
          favorites={home.favorites}
          greeting={home.greeting}
          newNotePressed={home.newNotePressed}
          recent={home.recent}
          searchQuery={home.searchQuery}
          searchResults={home.searchResults}
          showFavorites={home.showFavorites}
          showRecent={home.showRecent}
          showSearch={home.showSearch}
          style={{background: 'transparent'}}
        />
      </AppWindow>
      {cursor ? <Cursor frame={frame} {...cursor} /> : null}
    </div>
  );
}

function SimpleNotesEditor({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = notesEditorViewForFrame(frame);
  const taskListVisible = frame >= 76;
  const {height, width} = useVideoConfig();
  const layout = useAppWindowLayout({animate: false, hasRightRail: true, variant});
  const cursor = notesEditorCursorForFrame(frame, notesWindowBox(layout, width, height), width, height, layout.showRightRail);
  const renderLine = (line: NotesEditorLineView) => (
    <NoteLine frame={frame} line={line} />
  );
  const visibleLine = (line: NotesEditorLineView) => line.text.length > 0 || Boolean(line.caretVisible);

  return (
    <div className={styles.root}>
      <AppWindow
        activePlugin="notes"
        breadcrumbs={view.breadcrumbs}
        composer={false}
        layout={layout}
        rightRail={<NotesRightRail state={view.rightRail} />}
      >
        <NotesLayout
          showTaskList={taskListVisible}
          taskList={view.taskList}
          editor={{
            beforeLines: view.editor.beforeLines.filter(visibleLine).map(renderLine),
            afterLines: view.editor.afterLines.filter(visibleLine).map(renderLine),
            image: view.editor.image,
            title: view.editor.title,
          }}
        />
      </AppWindow>
      {cursor ? <Cursor frame={frame} {...cursor} /> : null}
    </div>
  );
}

// Both cursors are built from the shared notes interaction scripts — the same
// source the press/active states derive from.
function notesHomeCursorForFrame(
  frame: number,
  layout: ReturnType<typeof useAppWindowLayout>,
  width: number,
  height: number,
): CursorPath | null {
  return notesHomeInteractions.path(notesHomeCursorTargets(layout, width), frame, {height, width});
}

function notesEditorCursorForFrame(
  frame: number,
  windowBox: {height: number; left: number; top: number; width: number},
  width: number,
  height: number,
  showRightRail: boolean,
): CursorPath | null {
  // The right rail (and its "Tasklist" item) is hidden in the square layout —
  // the app's own responsive rule. With no rail to click, suppress the
  // rail-targeted open-tasklist move (frames < 98) instead of faking a click on
  // a missing element; the task-panel moves below still play (the panel exists).
  if (!showRightRail && frame < 98) return null;
  return notesEditorInteractions.path(notesEditorCursorTargets(windowBox, width, height), frame, undefined, 'percent');
}

function notesWindowBox(layout: ReturnType<typeof useAppWindowLayout>, width: number, height: number) {
  return {
    height: Number(layout.windowStyle.height ?? height),
    left: Number(layout.windowStyle.left ?? 0),
    top: Number(layout.windowStyle.top ?? 0),
    width: Number(layout.windowStyle.width ?? width),
  };
}

function notesHomeCursorTargets(
  layout: ReturnType<typeof useAppWindowLayout>,
  width: number,
): Record<NotesHomeTargetId, TargetRect> {
  return {
    newNoteButton: notesHomeNewNoteButtonTarget(layout, width),
  };
}

function notesEditorCursorTargets(
  windowBox: {height: number; left: number; top: number; width: number},
  width: number,
  height: number,
): Record<NotesEditorTargetId, TargetRect> {
  const {taskCheckbox, taskListCurrentRow} = notesTaskPanelTargets(windowBox, {height, width});
  const {editorBody, rightRailTasklist} = notesEditorChromeTargets(windowBox, {height, width});
  return {
    editorBody,
    rightRailTasklist,
    taskCheckbox,
    taskListCurrentRow,
  };
}

function NoteLine({frame, line}: {frame: number; line: NotesEditorLineView}) {
  if (!line.references?.length) {
    return (
      <>
        {line.text}
        <TextCaret frame={frame} visible={Boolean(line.caretVisible)} />
      </>
    );
  }

  const parts = line.references.reduce<Array<string | ReactNode>>((currentParts, reference) => {
    const nextParts: Array<string | ReactNode> = [];
    for (const part of currentParts) {
      if (typeof part !== 'string') {
        nextParts.push(part);
        continue;
      }

      const tokenIndex = part.indexOf(reference.token);
      if (tokenIndex === -1) {
        nextParts.push(part);
        continue;
      }

      nextParts.push(part.slice(0, tokenIndex));
      nextParts.push(<ReferencePill key={reference.id} label={reference.label} refType={reference.refType} />);
      nextParts.push(part.slice(tokenIndex + reference.token.length));
    }
    return nextParts;
  }, [line.text]);

  return (
    <>
      {parts}
      <TextCaret frame={frame} visible={Boolean(line.caretVisible)} />
    </>
  );
}
