import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {makeStyles} from '../agentbuddy-ui/primitives/makeStyles';
import {theme} from '../ui/theme';
import {captionViewForFrame, ease, mix, shotContentFrame, shotOverlap, shots, type FilmShot} from './state/timeline';
import {ChatShot} from './shots/ChatShot';
import {BoardShot} from './shots/BoardShot';
import {CalendarShot} from './shots/CalendarShot';
import {ChapterCard} from './shots/ChapterCard';
import {CodeShot} from './shots/CodeShot';
import {FinalShot} from './shots/FinalShot';
import {NotesShot} from './shots/NotesShot';
import {MontageShot} from './shots/MontageShot';
import {WorkflowShot} from './shots/WorkflowShot';
import {SurfaceFrame} from './SurfaceFrame';
import './AgentBuddyFilm.module.css';

const styles = makeStyles('AgentBuddyFilm');

type Variant = 'landscape' | 'square';

export const AgentBuddyFilm = () => <Film variant="landscape" />;
export const AgentBuddyFilmSquare = () => <Film variant="square" />;

function Film({variant}: {variant: Variant}) {
  let cursor = 0;

  return (
    <AbsoluteFill className={styles.root} style={{
      '--film-blue': theme.blue,
      '--film-font': theme.font,
      '--film-teal': theme.teal,
      '--film-text': theme.text,
    } as CSSProperties}>
      <div className={styles.background} />
      {shots.map(shot => {
        const start = cursor;
        cursor += shot.duration;
        const overlap = shotOverlap(shot);
        return (
          <Sequence key={shot.id} from={start - overlap} durationInFrames={shot.duration + overlap}>
            <ShotLayer overlap={overlap} shot={shot}>
              <SurfaceFrame>
                <ShotContent overlap={overlap} shot={shot} variant={variant} />
              </SurfaceFrame>
            </ShotLayer>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function ShotContent({overlap, shot, variant}: {overlap: number; shot: FilmShot; variant: Variant}) {
  const local = useCurrentFrame();
  const presented = Math.max(0, local - overlap);
  return (
    <>
      <ShotSurface frame={shotContentFrame(shot.id, presented)} shot={shot} variant={variant} />
      <Caption frame={presented} shot={shot} variant={variant} />
    </>
  );
}

function ShotLayer({children, overlap, shot}: {children: ReactNode; overlap: number; shot: FilmShot}) {
  const local = useCurrentFrame();
  const presented = local - overlap;
  const enterMode = shot.transition?.enter ?? 'cut';
  const exitMode = shot.transition?.exit ?? 'hold';
  const enter = enterFor({enterMode, local, overlap, shot});
  const exit = shot.chapter || exitMode === 'hold' ? 0 : ease(presented, shot.duration - 4, shot.duration);
  const opacity = Math.min(enter, 1 - exit);
  const float = !shot.chapter && enterMode === 'float';
  const scale = float ? mix(0.992, 1, enter) - exit * 0.006 : 1 - exit * 0.006;
  const y = float ? mix(10, 0, enter) - exit * 6 : -exit * 6;

  return (
    <div
      className={styles.shotLayer}
      style={{
        opacity,
        transform: `translateY(${y}px) scale(${scale})`,
      }}
    >
      {children}
    </div>
  );
}

function enterFor({enterMode, local, overlap, shot}: {enterMode: 'cut' | 'dissolve' | 'float'; local: number; overlap: number; shot: FilmShot}) {
  if (shot.chapter || enterMode === 'cut') return 1;
  if (enterMode === 'dissolve') return ease(local, 0, overlap);
  return ease(local - overlap, 0, 18);
}

function ShotSurface({frame, shot, variant}: {frame: number; shot: FilmShot; variant: Variant}) {
  const id = shot.id;
  if (shot.chapter) {
    return <ChapterCard duration={shot.duration} eyebrow={shot.chapter.eyebrow} frame={frame} subtitle={shot.chapter.subtitle} title={shot.chapter.title} variant={variant} />;
  }
  if (id === 'notes') return <NotesShot frame={frame} variant={variant} />;
  if (id === 'chat') return <ChatShot frame={frame} variant={variant} />;
  if (id === 'board') return <BoardShot frame={frame} variant={variant} />;
  if (id === 'code') return <CodeShot frame={frame} variant={variant} />;
  if (id === 'workflow') return <WorkflowShot frame={frame} variant={variant} />;
  if (id === 'calendar') return <CalendarShot frame={frame} variant={variant} />;
  if (id === 'montage') return <MontageShot frame={frame} variant={variant} />;
  return <FinalShot frame={frame} variant={variant} />;
}

function Caption({frame, shot, variant}: {frame: number; shot: FilmShot; variant: Variant}) {
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
