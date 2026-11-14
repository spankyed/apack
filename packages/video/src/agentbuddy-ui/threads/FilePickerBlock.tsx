import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {FilePickerBlockState} from './threadTypes';
import './FilePickerBlock.module.css';

const styles = makeStyles('FilePickerBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/FilePickerInput.vue.
export function FilePickerBlock({state}: {state: FilePickerBlockState}) {
  const paths = pathsFor(state);
  return (
    <div className={styles.root}>
      {state.disabled && paths.length ? <div className={styles.responseHeader}><Icons.Check size={16} /><span>{state.displayText || 'Selected files:'}</span></div> : null}
      {paths.map(path => <PathRow key={path} path={path} />)}
      {!state.disabled ? (
        <button className={styles.browse} type="button">
          <Icons.FolderOpen size={16} />
          <span>{browseText(state)}</span>
        </button>
      ) : null}
    </div>
  );
}

function PathRow({path}: {path: string}) {
  const hasExtension = /\.[^/.]+$/.test(path);
  const Icon = hasExtension ? Icons.File : Icons.FolderOpen;
  return <div className={styles.path}><Icon size={16} /><span>{path}</span></div>;
}

function pathsFor(state: FilePickerBlockState) {
  const source = state.response ?? state.selectedPaths ?? [];
  if (Array.isArray(source)) return source;
  return [source];
}

function browseText(state: FilePickerBlockState) {
  const type = state.fileType === 'file' ? 'File' : state.fileType === 'directory' ? 'Directory' : 'File/Directory';
  return `Browse ${type}${state.allowMultiple ? 's' : ''}`;
}
