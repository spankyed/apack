import {ease, mix} from './timeline';

export type FinalShotView = {
  brand: string;
  tagline: string;
  taglineStyle: {
    opacity: number;
  };
  titleStyle: {
    opacity: number;
    transform: string;
  };
};

export const finalShotState = {
  brand: 'AgentBuddy',
  tagline: 'The AI operating system for modern work.',
  motion: {
    title: {from: 24, to: 70, yFrom: 20, yTo: 0},
    tagline: {from: 52, to: 94},
  },
};

export function finalViewForFrame(frame: number) {
  const titleProgress = ease(frame, finalShotState.motion.title.from, finalShotState.motion.title.to);
  return {
    titleStyle: {
      opacity: titleProgress,
      transform: `translateY(${mix(finalShotState.motion.title.yFrom, finalShotState.motion.title.yTo, titleProgress)}px)`,
    },
    taglineStyle: {
      opacity: ease(frame, finalShotState.motion.tagline.from, finalShotState.motion.tagline.to),
    },
  };
}

export function finalShotViewForFrame(frame: number): FinalShotView {
  const view = finalViewForFrame(frame);
  return {
    brand: finalShotState.brand,
    tagline: finalShotState.tagline,
    taglineStyle: view.taglineStyle,
    titleStyle: view.titleStyle,
  };
}
