import type {ReactNode} from 'react';
import {makeStyles} from '../primitives/makeStyles';
import {TerminalPanelSection} from './TerminalPanelSection';
import type {TerminalPanelState} from './codeTypes';
import './CodeFeaturePanel.module.css';

const styles = makeStyles('CodeFeaturePanel');

type CodeFeaturePanelProps = {
  children: ReactNode;
  terminal: TerminalPanelState;
};

// Mirrors packages/renderer/src/plugins/code/features/panel.vue:
// selected panel content above, terminal section always visible at the bottom.
export function CodeFeaturePanel({children, terminal}: CodeFeaturePanelProps) {
  return (
    <div className={styles.root}>
      <div className={styles.content}>{children}</div>
      <TerminalPanelSection state={terminal} />
    </div>
  );
}
