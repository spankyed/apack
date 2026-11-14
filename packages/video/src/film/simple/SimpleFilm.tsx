import type {CSSProperties} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {makeStyles} from '../../agentbuddy-ui/primitives/makeStyles';
import {theme} from '../../ui/theme';
import {ChapterCard} from '../shots/ChapterCard';
import {FinalShot} from '../shots/FinalShot';
import {SurfaceFrame} from '../SurfaceFrame';
import {SimpleCalendarScene} from './scenes/SimpleCalendarScene';
import {SimpleCodeScene} from './scenes/SimpleCodeScene';
import {SimpleMontageScene} from './scenes/SimpleMontageScene';
import {SimpleNotesScene} from './scenes/SimpleNotesScene';
import {SimpleThreadsScene} from './scenes/SimpleThreadsScene';
import {SimpleWorkflowScene} from './scenes/SimpleWorkflowScene';
import {simpleSceneFrame, simpleScenes, type SimpleScene} from './timeline';
import '../AgentBuddyFilm.module.css';

const styles = makeStyles('AgentBuddyFilm');

type Variant = 'landscape' | 'square';

export const AgentBuddyFilmSimple = () => <SimpleFilm variant="landscape" />;
export const AgentBuddyFilmSimpleSquare = () => <SimpleFilm variant="square" />;

// Hard cuts only: every content scene shows the entire app UI in a steady
// frame, separated by banner cards. No dissolves, floats, or chrome reveals.
function SimpleFilm({variant}: {variant: Variant}) {
  let cursor = 0;

  return (
    <AbsoluteFill className={styles.root} style={{
      '--film-blue': theme.blue,
      '--film-font': theme.font,
      '--film-teal': theme.teal,
      '--film-text': theme.text,
    } as CSSProperties}>
      <div className={styles.background} />
      {simpleScenes.map(scene => {
        const start = cursor;
        cursor += scene.duration;
        return (
          <Sequence key={scene.id} from={start} durationInFrames={scene.duration}>
            <SurfaceFrame>
              <SceneSurface scene={scene} variant={variant} />
            </SurfaceFrame>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function SceneSurface({scene, variant}: {scene: SimpleScene; variant: Variant}) {
  const local = useCurrentFrame();
  const frame = simpleSceneFrame(scene.id, local);
  if (scene.card) {
    return <ChapterCard duration={scene.duration} eyebrow={scene.card.eyebrow} frame={frame} subtitle={scene.card.subtitle} title={scene.card.title} variant={variant} />;
  }
  if (scene.id === 'threads') return <SimpleThreadsScene frame={frame} variant={variant} />;
  if (scene.id === 'notes') return <SimpleNotesScene frame={frame} variant={variant} />;
  if (scene.id === 'code') return <SimpleCodeScene frame={frame} variant={variant} />;
  if (scene.id === 'workflow') return <SimpleWorkflowScene frame={frame} variant={variant} />;
  if (scene.id === 'calendar') return <SimpleCalendarScene frame={frame} variant={variant} />;
  if (scene.id === 'montage') return <SimpleMontageScene frame={frame} variant={variant} />;
  return <FinalShot frame={frame} variant={variant} />;
}
