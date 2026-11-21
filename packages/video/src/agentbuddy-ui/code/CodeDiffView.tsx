import {Icons} from '../primitives/Icon';
import {MonacoCodeViewer} from './MonacoCodeViewer';
import './CodeDiffView.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('CodeDiffView');

type DiffLine = {
  kind: 'add' | 'remove' | 'context';
  text: string;
};

export function CodeDiffView({fileName, lineOpacities, lineStart, lines}: {fileName: string; lineOpacities?: number[]; lineStart: number; lines: DiffLine[]}) {
  const visibleLines = lines.filter((line, index) => line.kind === 'context' || (lineOpacities?.[index] ?? 1) > 0.04);
  const original = visibleLines
    .filter(line => line.kind !== 'add')
    .map(line => line.text)
    .join('\n');
  const modified = visibleLines
    .filter(line => line.kind !== 'remove')
    .map(line => line.text)
    .join('\n');
  return (
    <section className={styles.root}>
      <div className={styles.tabs}>
        <div className={styles.tab}><Icons.File size={13} /> {fileName}</div>
      </div>
      <div className={styles.editor}>
        <MonacoCodeViewer
          filePath={fileName}
          lineNumberStart={lineStart}
          lineNumbers="on"
          modified={modified}
          original={original}
        />
      </div>
    </section>
  );
}
