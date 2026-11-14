import type {ActionsSurfaceState} from './actionTypes';
import {ActionDetail} from './ActionDetail';
import {ActionsList} from './ActionsList';

type ActionsSurfaceProps = {
  state: ActionsSurfaceState;
};

export function ActionsSurface({state}: ActionsSurfaceProps) {
  if (state.view === 'detail' || state.view === 'create') {
    return <ActionDetail state={state} />;
  }
  if (state.view === 'list') {
    return <ActionsList state={state} />;
  }
  return null;
}
