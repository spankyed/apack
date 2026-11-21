import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import {makeStyles} from '../primitives/makeStyles';
import './PromptTemplateEditor.module.css';

const styles = makeStyles('PromptTemplateEditor');

type PromptTemplateEditorProps = {
  value: string;
};

export function PromptTemplateEditor({value}: PromptTemplateEditorProps) {
  return (
    <div className={styles.root} data-onboarding-id="prompt-template-editor">
      <MonacoCodeViewer filePath="prompt-template.ts" height="100%" language="typescript" lineNumbers="off" value={value} />
    </div>
  );
}
