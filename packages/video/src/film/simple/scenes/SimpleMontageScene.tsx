import {useVideoConfig} from 'remotion';
import {AppWindow} from '../../../agentbuddy-ui/chrome/AppWindow';
import {DatabaseSurface} from '../../../agentbuddy-ui/database/DatabaseSurface';
import {LogsSurface} from '../../../agentbuddy-ui/logs/LogsSurface';
import {ThreadConversation} from '../../../agentbuddy-ui/threads/ThreadConversation';
import {montageShotViewForFrame} from '../../state/montage';
import {useAppWindowLayout} from '../../appWindowLayout';
import {Cursor} from '../../overlays/Cursor';
import {cursorTimeline, viewportPoint} from '../../interaction/cursorTargets';
import type {CursorPath, TargetRect} from '../../interaction/cursorTargets';
import {makeStyles} from '../../../agentbuddy-ui/primitives/makeStyles';
import '../../shots/MontageShot.module.css';

const styles = makeStyles('MontageShot');

// Epilogue scene: hop through more plugins the way a user would — by
// clicking their toolbar icons. Each surface switch is an instant in-app
// plugin change (no dissolves), and the database queries run off real
// clicks on the Execute button.
export function SimpleMontageScene({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const layout = useAppWindowLayout({animate: false, variant});
  const {height, width} = useVideoConfig();
  const view = montageShotViewForFrame(frame);
  const cursor = montageCursorForFrame(frame, layout, width, height);

  return (
    <div className={styles.segment}>
      <div className={styles.layer}>
        <AppWindow activePlugin={view.activePlugin} breadcrumbs={view.breadcrumbs} composer={view.composer} layout={layout}>
          <MontageSurface view={view} />
        </AppWindow>
      </div>
      {cursor ? <Cursor frame={frame} {...cursor} /> : null}
    </div>
  );
}

function MontageSurface({view}: {view: ReturnType<typeof montageShotViewForFrame>}) {
  if (view.surface === 'conversation') {
    return (
      <ThreadConversation
        assistant={{markdown: view.conversation.assistantMarkdown}}
        createdAt={view.conversation.createdAt}
        messageStyles={view.conversation.messageStyles}
        topInset={view.conversation.topInset}
        userMessage={view.conversation.userMessage}
      />
    );
  }

  if (view.surface === 'logs') {
    return <LogsSurface state={view.logs} />;
  }

  if (view.surface === 'browser') {
    return null;
  }

  return <DatabaseSurface state={view.database} />;
}

function montageCursorForFrame(
  frame: number,
  layout: ReturnType<typeof useAppWindowLayout>,
  width: number,
  height: number,
): CursorPath | null {
  const targets = montageCursorTargets(layout, width, height);

  return cursorTimeline(targets, [
    // Click the Logs toolbar icon; the logs surface lands 4 frames later.
    {
      end: 60,
      from: viewportPoint(width, height, 0.5, 0.42),
      holdUntilNext: false,
      start: 40,
      to: 'logsIcon',
    },
    // Click the Database toolbar icon.
    {
      end: 132,
      from: viewportPoint(width, height, 0.45, 0.4),
      holdUntilNext: false,
      start: 112,
      to: 'databaseIcon',
    },
    // Run the first query: Execute pressed at 146-148 in the surface state.
    {
      end: 146,
      from: 'databaseIcon',
      start: 136,
      to: 'executeButton',
    },
    // Click into the query editor; the second query is pasted in at 196.
    {
      end: 188,
      from: 'executeButton',
      start: 176,
      to: 'queryEditor',
    },
    // Run the second query: Execute pressed at 200-202.
    {
      end: 200,
      from: 'queryEditor',
      start: 192,
      to: 'executeButton',
    },
  ], frame);
}

// Pinned toolbar buttons are anchored to the window's bottom edge (40px
// buttons, 24px gaps, 24px area padding): settings, logs, database, brain
// bottom-up. The database surface targets mirror the rendered layout.
function montageCursorTargets(
  layout: ReturnType<typeof useAppWindowLayout>,
  width: number,
  height: number,
): Record<string, TargetRect> {
  const windowLeft = Number(layout.windowStyle.left ?? 0);
  const windowTop = Number(layout.windowStyle.top ?? 0);
  const windowWidth = Number(layout.windowStyle.width ?? width);
  const windowHeight = Number(layout.windowStyle.height ?? height);
  const windowBottom = windowTop + windowHeight;
  const windowRight = windowLeft + windowWidth;
  const iconLeft = windowLeft + 36 - 20;
  // Database surface sits inside the window after the 72px icon sidebar; its
  // Execute button is right-aligned in the query toolbar and the query editor
  // input is indented from the surface left — anchor both to the window box so
  // they track the surface in both the landscape and square variants.
  const surfaceLeft = windowLeft + 72;

  return {
    databaseIcon: {height: 40, left: iconLeft, top: windowBottom - 172 - 20, width: 40},
    executeButton: {height: 28, left: windowRight - 122, top: windowTop + 55, width: 104},
    logsIcon: {height: 40, left: iconLeft, top: windowBottom - 108 - 20, width: 40},
    queryEditor: {height: 81, left: surfaceLeft + 328, top: windowTop + 112, width: 403},
  };
}
