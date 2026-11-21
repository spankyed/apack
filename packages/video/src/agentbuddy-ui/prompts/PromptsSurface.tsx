import {PromptDetail} from './PromptDetail';
import {PromptsList} from './PromptsList';
import type {PromptsSurfaceState} from './promptTypes';
import './PromptsSurface.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('PromptsSurface');

type PromptsSurfaceProps = {
  state: PromptsSurfaceState;
};

export function PromptsSurface({state}: PromptsSurfaceProps) {
  let content = null;
  if (state.view === 'detail' || state.view === 'create') {
    content = <PromptDetail state={state} />;
  }
  if (state.view === 'list') {
    content = <PromptsList state={state} />;
  }
  return <div className={styles.root}>{content}</div>;
}
