import {Icons} from '../primitives/Icon';
import {MonacoCodeViewer} from './MonacoCodeViewer';
import type {TerminalPanelState} from './codeTypes';
import {makeStyles} from '../primitives/makeStyles';
import './CodeTerminalSurface.module.css';

const styles = makeStyles('CodeTerminalSurface');

export function CodeTerminalSurface({state}: {state: TerminalPanelState}) {
  const activeTerminal = state.terminals.find(terminal => terminal.id === state.activeTerminalId) ?? state.terminals[0];
  return (
    <section className={styles.root}>
      <div className={styles.tabs}>
        <div className={styles.tab}>
          <Icons.Terminal size={13} />
          <span>{activeTerminal?.title || activeTerminal?.shell || 'Terminal'}</span>
        </div>
      </div>
      <div className={styles.body}>
        <MonacoCodeViewer height="100%" language="shell" value={state.output ?? ''} />
      </div>
    </section>
  );
}
