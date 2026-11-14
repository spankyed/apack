import type {ReactNode} from 'react';
import {theme} from '../ui/theme';

export function SurfaceFrame({children}: {children: ReactNode}) {
  return <div style={{position: 'absolute', inset: 0, background: '#07090b', fontFamily: theme.font, color: theme.text}}>{children}</div>;
}

