import {ease, mix} from './timeline';

export type FinalShotView = {
  subtitle: string;
  subtitleStyle: {
    opacity: number;
  };
  title: string;
  titleStyle: {
    opacity: number;
    transform: string;
  };
};

export const finalShotState = {
  subtitle: 'to put the full power of AI into the hands of the people',
  title: 'AgentBuddy is a revolution',
  motion: {
    subtitle: {from: 34, to: 72},
    title: {from: -8, to: 46, yFrom: 20, yTo: 0},
  },
};

export function finalViewForFrame(frame: number) {
  const titleProgress = ease(frame, finalShotState.motion.title.from, finalShotState.motion.title.to);
  return {
    titleStyle: {
      opacity: titleProgress,
      transform: `translateY(${mix(finalShotState.motion.title.yFrom, finalShotState.motion.title.yTo, titleProgress)}px)`,
    },
    subtitleStyle: {
      opacity: ease(frame, finalShotState.motion.subtitle.from, finalShotState.motion.subtitle.to),
    },
  };
}

export function finalShotViewForFrame(frame: number): FinalShotView {
  const view = finalViewForFrame(frame);
  return {
    subtitle: finalShotState.subtitle,
    subtitleStyle: view.subtitleStyle,
    title: finalShotState.title,
    titleStyle: view.titleStyle,
  };
}
