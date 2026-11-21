import type {CSSProperties} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {makeStyles} from '../agentbuddy-ui/primitives/makeStyles';
import {theme} from '../ui/theme';
import {captionViewForFrame, filmProgressForFrame, shotAtFrame, shots, type FilmShot, type ShotId} from './state/timeline';
import {ChatShot} from './shots/ChatShot';
import {BoardShot} from './shots/BoardShot';
import {CodeShot} from './shots/CodeShot';
import {FinalShot} from './shots/FinalShot';
import {NotesShot} from './shots/NotesShot';
import {WorkflowShot} from './shots/WorkflowShot';
import {SurfaceFrame} from './SurfaceFrame';
import './AgentBuddyFilm.module.css';

const styles = makeStyles('AgentBuddyFilm');

type Variant = 'landscape' | 'square';

export const AgentBuddyFilm = () => <Film variant="landscape" />;
export const AgentBuddyFilmSquare = () => <Film variant="square" />;

function Film({variant}: {variant: Variant}) {
  const frame = useCurrentFrame();
  let cursor = 0;
  const progress = filmProgressForFrame(frame);
  const activeShot = shotAtFrame(frame);

  return (
    <AbsoluteFill className={styles.root} style={{
      '--film-blue': theme.blue,
      '--film-font': theme.font,
      '--film-progress': progress,
      '--film-teal': theme.teal,
      '--film-text': theme.text,
    } as CSSProperties}>
      <div className={styles.background} />
      {shots.map(shot => {
        const start = cursor;
        cursor += shot.duration;
        return (
          <Sequence key={shot.id} from={start} durationInFrames={shot.duration}>
            <SurfaceFrame>
              <ShotSurface id={shot.id} variant={variant} />
              <Caption shot={shot} variant={variant} />
            </SurfaceFrame>
          </Sequence>
        );
      })}
      {activeShot?.id === 'final' ? null : (
        <div className={styles.progress}>
          <div className={styles.progressFill} />
        </div>
      )}
    </AbsoluteFill>
  );
}

function ShotSurface({id, variant}: {id: ShotId; variant: Variant}) {
  const frame = useCurrentFrame();
  if (id === 'notes') return <NotesShot frame={frame} variant={variant} />;
  if (id === 'chat') return <ChatShot frame={frame} variant={variant} />;
  if (id === 'board') return <BoardShot frame={frame} variant={variant} />;
  if (id === 'code') return <CodeShot frame={frame} variant={variant} />;
  if (id === 'workflow') return <WorkflowShot frame={frame} variant={variant} />;
  return <FinalShot frame={frame} variant={variant} />;
}

function Caption({shot, variant}: {shot: FilmShot; variant: Variant}) {
  const frame = useCurrentFrame();
  const view = captionViewForFrame(shot, frame);
  if (!view) return null;
  const className = captionClassName({alignRight: view.alignRight, variant});
  return (
    <div
      className={className}
      style={{
        '--caption-opacity': view.opacity,
        '--caption-y': `${view.y}px`,
      } as CSSProperties}
    >
      {view.title}
    </div>
  );
}

function captionClassName({alignRight, variant}: {alignRight: boolean; variant: Variant}) {
  if (variant === 'square') return alignRight ? styles.captionSquareRight : styles.captionSquare;
  return alignRight ? styles.captionRight : styles.caption;
}
