import {useCurrentFrame} from 'remotion';
import {ThreadsHeader} from '../../agentbuddy-ui/threads/ThreadsHeader';
import {ThreadsBoardSurface} from '../../agentbuddy-ui/threads/ThreadsBoardSurface';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {BoardShot} from '../../film/shots/BoardShot';
import {boardShotState, threadsHeaderArchiveState, threadsHeaderFilterState, threadsHeaderSearchState} from '../../film/state/board';
import {DemoBoardArea, DemoHeaderArea} from '../DemoLayout';

export const ThreadsHeaderDemo = () => (
  <SurfaceFrame>
    <DemoHeaderArea>
      <ThreadsHeader state={boardShotState.header} />
    </DemoHeaderArea>
  </SurfaceFrame>
);

export const ThreadsHeaderSearchDemo = () => (
  <SurfaceFrame>
    <DemoHeaderArea>
      <ThreadsHeader state={threadsHeaderSearchState} />
    </DemoHeaderArea>
  </SurfaceFrame>
);

export const ThreadsHeaderFilterDemo = () => (
  <SurfaceFrame>
    <DemoHeaderArea>
      <ThreadsHeader state={threadsHeaderFilterState} />
    </DemoHeaderArea>
  </SurfaceFrame>
);

export const ThreadsHeaderArchiveDemo = () => (
  <SurfaceFrame>
    <DemoHeaderArea>
      <ThreadsHeader state={threadsHeaderArchiveState} />
    </DemoHeaderArea>
  </SurfaceFrame>
);

export const KanbanComponentsDemo = () => (
  <SurfaceFrame>
    <DemoBoardArea>
      <ThreadsBoardSurface board={boardShotState.board} header={boardShotState.header} />
    </DemoBoardArea>
  </SurfaceFrame>
);

export const BoardSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return (
    <SurfaceFrame>
      <BoardShot frame={frame} />
    </SurfaceFrame>
  );
};
