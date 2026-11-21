import type {ActionsSurfaceState} from './actionTypes';
import {ActionDetail} from './ActionDetail';
import {ActionsList} from './ActionsList';
import './ActionsSurface.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('ActionsSurface');

type ActionsSurfaceProps = {
  state: ActionsSurfaceState;
};

export function ActionsSurface({state}: ActionsSurfaceProps) {
  let content = null;
  if (state.view === 'detail' || state.view === 'create') {
    content = <ActionDetail state={state} />;
  }
  if (state.view === 'list') {
    content = <ActionsList state={state} />;
  }
  return <div className={styles.root}>{content}</div>;
}
