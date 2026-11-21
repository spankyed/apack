import {Icons} from '../primitives/Icon';
import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import {makeStyles} from '../primitives/makeStyles';
import type {ToolInputBlockState} from './threadTypes';
import './ToolInputBlock.module.css';

const styles = makeStyles('ToolInputBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/ToolInputBlock.vue.
export function ToolInputBlock({state}: {state: ToolInputBlockState}) {
  const filePath = getString(state.input.file_path) ?? getString(state.input.path);
  const fileName = filePath?.split('/').pop() ?? filePath;
  const toolName = state.toolName;
  return (
    <div className={styles.root}>
      {fileName ? (
        <div className={styles.header} title={filePath}>
          <Icons.FileEdit size={14} />
          <span>{fileName}</span>
        </div>
      ) : null}
      {toolName === 'Edit' ? <EditPreview input={state.input} /> : null}
      {toolName === 'Write' ? <CodePreview input={state.input} /> : null}
      {toolName === 'Bash' ? <BashPreview command={getString(state.input.command) ?? ''} /> : null}
      {toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'Bash' ? <JsonPreview input={state.input} /> : null}
    </div>
  );
}

function EditPreview({input}: {input: Record<string, unknown>}) {
  const filePath = getString(input.file_path) ?? getString(input.path);
  const original = getString(input.old_string) ?? '';
  const modified = getString(input.new_string) ?? '';
  return (
    <div className={styles.editorShell}>
      <MonacoCodeViewer filePath={filePath} modified={modified} original={original} />
    </div>
  );
}

function CodePreview({input}: {input: Record<string, unknown>}) {
  const filePath = getString(input.file_path) ?? getString(input.path);
  const content = getString(input.content) ?? getString(input.file_text) ?? '';
  return (
    <div className={styles.editorShell}>
      <MonacoCodeViewer filePath={filePath} value={truncateContent(content)} />
    </div>
  );
}

function BashPreview({command}: {command: string}) {
  return (
    <div className={styles.commandShell}>
      <MonacoCodeViewer height={56} language="shell" value={`$ ${command}`} />
    </div>
  );
}

function JsonPreview({input}: {input: Record<string, unknown>}) {
  const fieldCount = Object.keys(input).length;
  const value = JSON.stringify(input, null, 2);
  return (
    <details className={styles.details} open>
      <summary>View input ({fieldCount} {fieldCount === 1 ? 'field' : 'fields'})</summary>
      <div className={styles.jsonShell}>
        <MonacoCodeViewer height={Math.min(256, Math.max(96, value.split('\n').length * 20 + 24))} language="json" value={value} />
      </div>
    </details>
  );
}

function truncateContent(content: string) {
  const maxLength = 2000;
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength)}\n... (truncated)`;
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}
