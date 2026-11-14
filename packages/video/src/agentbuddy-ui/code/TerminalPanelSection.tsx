import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {TerminalPanelState} from './codeTypes';
import {MonacoCodeViewer} from './MonacoCodeViewer';
import './TerminalPanelSection.module.css';

const styles = makeStyles('TerminalPanelSection');

// Mirrors packages/renderer/src/plugins/code/features/terminal/PanelTerminalSection.vue collapsed state.
export function TerminalPanelSection({state}: {state: TerminalPanelState}) {
  const isExpanded = Boolean(state.expanded);
  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div className={styles.title}>
          {isExpanded ? <Icons.ChevronDown size={13} /> : <Icons.ChevronRight size={13} />}
          <span>TERMINAL</span>
        </div>
        <div className={styles.actions}>
          <button className={styles.iconButton} title="Run Script" type="button">
            <Icons.Play size={14} />
          </button>
          <button className={styles.iconButton} disabled={!state.activeTerminalId} title="Stop (Ctrl+C)" type="button">
            <Icons.Square className={!state.activeTerminalId ? styles.disabledIcon : undefined} size={12} />
          </button>
          <button className={styles.iconButton} title="New Terminal" type="button">
            <Icons.Plus size={14} />
          </button>
          <button className={styles.iconButton} title="Terminal actions" type="button">
            <Icons.MoreHorizontal size={14} />
          </button>
        </div>
      </header>
      {isExpanded ? (
        <div className={styles.expanded}>
          <div className={styles.terminalBody}>
            {state.activeTerminalId ? (
              <MonacoCodeViewer height="100%" language="shell" value={state.output ?? ''} />
            ) : (
              <span>No terminal selected</span>
            )}
          </div>
          {state.terminals.length ? (
            <div className={styles.terminalList}>
              {state.terminals.map(terminal => (
                <div className={terminal.id === state.activeTerminalId ? styles.activeTerminal : styles.terminalRow} key={terminal.id}>
                  <Icons.Terminal size={12} />
                  <span>{terminal.title || terminal.shell}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
