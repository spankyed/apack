import {useCurrentFrame} from 'remotion';
import {NotesRightRail} from '../../agentbuddy-ui/notes/NotesRightRail';
import {TaskListPanel} from '../../agentbuddy-ui/notes/TaskListPanel';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {NotesShot} from '../../film/shots/NotesShot';
import {
  notesRightRailMenuState,
  notesRightRailSearchState,
  notesRightRailState,
  notesRightRailTrashActionsState,
  notesRightRailTrashState,
  notesTaskListRowMenuState,
  notesTaskListMenuState,
  notesTaskListState,
} from '../../film/state/notes';
import {DemoPanelSlot} from '../DemoLayout';

export const TaskListPanelDemo = () => (
  <SurfaceFrame>
    <DemoPanelSlot>
      <TaskListPanel
        activeId={notesTaskListState.activeId}
        items={notesTaskListState.items}
        showCompleted={notesTaskListState.showCompleted}
        title={notesTaskListState.title}
      />
    </DemoPanelSlot>
  </SurfaceFrame>
);

export const TaskListPanelMenuDemo = () => (
  <SurfaceFrame>
    <DemoPanelSlot>
      <TaskListPanel
        activeId={notesTaskListMenuState.activeId}
        headerMenuOpen={notesTaskListMenuState.headerMenuOpen}
        items={notesTaskListMenuState.items}
        showCompleted={notesTaskListMenuState.showCompleted}
        title={notesTaskListMenuState.title}
      />
    </DemoPanelSlot>
  </SurfaceFrame>
);

export const TaskListPanelRowMenuDemo = () => (
  <SurfaceFrame>
    <DemoPanelSlot>
      <TaskListPanel
        activeId={notesTaskListRowMenuState.activeId}
        items={notesTaskListRowMenuState.items}
        showCompleted={notesTaskListRowMenuState.showCompleted}
        title={notesTaskListRowMenuState.title}
      />
    </DemoPanelSlot>
  </SurfaceFrame>
);

export const NotesRightRailDemo = () => (
  <SurfaceFrame>
    <DemoPanelSlot side="right" width={368}>
      <NotesRightRail state={notesRightRailState} />
    </DemoPanelSlot>
  </SurfaceFrame>
);

export const NotesRightRailSearchDemo = () => (
  <SurfaceFrame>
    <DemoPanelSlot side="right" width={368}>
      <NotesRightRail state={notesRightRailSearchState} />
    </DemoPanelSlot>
  </SurfaceFrame>
);

export const NotesRightRailMenuDemo = () => (
  <SurfaceFrame>
    <DemoPanelSlot side="right" width={368}>
      <NotesRightRail state={notesRightRailMenuState} />
    </DemoPanelSlot>
  </SurfaceFrame>
);

export const NotesRightRailTrashDemo = () => (
  <SurfaceFrame>
    <DemoPanelSlot side="right" width={368}>
      <NotesRightRail state={notesRightRailTrashState} />
    </DemoPanelSlot>
  </SurfaceFrame>
);

export const NotesRightRailTrashActionsDemo = () => (
  <SurfaceFrame>
    <DemoPanelSlot side="right" width={368}>
      <NotesRightRail state={notesRightRailTrashActionsState} />
    </DemoPanelSlot>
  </SurfaceFrame>
);

export const NotesSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return (
    <SurfaceFrame>
      <NotesShot frame={frame} />
    </SurfaceFrame>
  );
};
