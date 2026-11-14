import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {NotesLayout} from '../../agentbuddy-ui/notes/NotesLayout';
import {NotesRightRail} from '../../agentbuddy-ui/notes/NotesRightRail';
import {notesShotViewForFrame} from '../state/notes';
import {Caret} from './Caret';
import {useAppWindowLayout} from '../appWindowLayout';

export function NotesShot({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = notesShotViewForFrame(frame);
  const layout = useAppWindowLayout({hasRightRail: true, variant});
  const renderLine = (line: {caretVisible?: boolean; text: string}) => (
    <>
      {line.text}
      <Caret frame={frame} visible={Boolean(line.caretVisible)} />
    </>
  );

  return (
    <AppWindow
      activePlugin="notes"
      breadcrumbs={view.breadcrumbs}
      composer={view.composer}
      layout={layout}
      rightRail={<NotesRightRail state={view.rightRail} />}
    >
      <NotesLayout
        taskList={view.taskList}
        editor={{
          beforeLines: view.editor.beforeLines.map(renderLine),
          afterLines: view.editor.afterLines.map(renderLine),
          title: view.editor.title,
        }}
      />
    </AppWindow>
  );
}
