import type {CSSProperties} from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {AppWindowLayout} from '../agentbuddy-ui/chrome/AppWindow';

type Variant = 'landscape' | 'square';

export function useAppWindowLayout({
  animate = true,
  hasRightRail = false,
  variant = 'landscape',
}: {
  animate?: boolean;
  hasRightRail?: boolean;
  variant?: Variant;
}): AppWindowLayout {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const enter = animate ? spring({frame, fps, config: {damping: 25, stiffness: 110}}) : 1;
  const square = variant === 'square' || width === height;
  const marginX = square ? 42 : 32;
  const marginTop = square ? 54 : 32;
  const marginBottom = square ? 92 : 32;
  const showRightRail = hasRightRail && !square;

  const windowStyle: CSSProperties = {
    left: marginX,
    top: marginTop,
    width: width - marginX * 2,
    height: height - marginTop - marginBottom,
    transform: `translateY(${interpolate(enter, [0, 1], [16, 0])}px) scale(${interpolate(enter, [0, 1], [.986, 1])})`,
  };

  return {
    gridStyle: {
      gridTemplateColumns: showRightRail ? '72px minmax(0, 1fr) 368px' : '72px minmax(0, 1fr)',
    },
    showRightRail,
    windowStyle,
  };
}
