import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './JsonSchemaEditor.module.css';

const styles = makeStyles('JsonSchemaEditor');

type JsonSchemaEditorProps = {
  value?: unknown;
};

export function JsonSchemaEditor({value}: JsonSchemaEditorProps) {
  const {hasValue, isValid, jsonString} = formatSchemaValue(value);

  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        Define an output schema for structured output. Example:{' '}
        <code>{'{ "type": "object", "properties": { ... } }'}</code>
      </p>
      <div className={styles.editorWrap}>
        <div className={cx(styles.editor, hasValue && !isValid && styles.editorInvalid)}>
          <MonacoCodeViewer filePath="schema.json" height="100%" language="json" lineNumbers="off" value={jsonString} />
        </div>
        {hasValue ? <span className={cx(styles.status, !isValid && styles.statusInvalid)}>{isValid ? 'Valid JSON' : 'Invalid JSON'}</span> : null}
      </div>
    </div>
  );
}

function formatSchemaValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return {hasValue: false, isValid: true, jsonString: ''};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return {hasValue: true, isValid: true, jsonString: JSON.stringify(parsed, null, 2)};
    } catch {
      return {hasValue: true, isValid: false, jsonString: value};
    }
  }

  try {
    return {hasValue: true, isValid: true, jsonString: JSON.stringify(value, null, 2)};
  } catch {
    return {hasValue: true, isValid: false, jsonString: ''};
  }
}
