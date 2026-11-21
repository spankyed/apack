import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import {makeStyles} from '../primitives/makeStyles';
import './PromptTemplateViewer.module.css';

const styles = makeStyles('PromptTemplateViewer');

type PromptTemplateViewerProps = {
  value: string;
};

// Mirrors packages/renderer/src/plugins/prompts/components/PromptTemplateViewer.vue.
export function PromptTemplateViewer({value}: PromptTemplateViewerProps) {
  return (
    <div className={styles.root}>
      <MonacoCodeViewer filePath="prompt-template.js" height="100%" language="javascript" lineNumbers="on" value={value} />
    </div>
  );
}
