import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import {makeStyles} from '../primitives/makeStyles';
import './ActionFunctionEditor.module.css';

const styles = makeStyles('ActionsFunctionEditor');

type ActionFunctionEditorProps = {
  value: string;
};

const placeholder = `// Example action function
const { param1, param2 } = params;

// Use available services
await services.logger.info('Starting action', { param1, param2 });

try {
  // Your action logic here
  const result = await services.database.query(
    'SELECT * FROM users WHERE id = ?',
    [param1]
  );
  
  // Send email notification
  await services.email.send(
    param2,
    'Action completed',
    'Your action has been processed successfully.'
  );
  
  return {
    success: true,
    data: result.rows
  };
} catch (error) {
  await services.logger.error('Action failed', error);
  throw error;
}`;

export function ActionFunctionEditor({value}: ActionFunctionEditorProps) {
  return (
    <div className={styles.root} data-onboarding-id="action-function-editor">
      <MonacoCodeViewer filePath="action-template.ts" fontSize={14} height="100%" language="typescript" lineNumbers="on" placeholder={placeholder} value={value} wordWrap="on" />
    </div>
  );
}
