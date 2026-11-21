import {PromptDetail} from './PromptDetail';
import {PromptsList} from './PromptsList';
import type {PromptsSurfaceState} from './promptTypes';

type PromptsSurfaceProps = {
  state: PromptsSurfaceState;
};

export function PromptsSurface({state}: PromptsSurfaceProps) {
  if (state.view === 'detail' || state.view === 'create') {
    return <PromptDetail state={state} />;
  }
  if (state.view === 'list') {
    return <PromptsList state={state} />;
  }
  return null;
}
