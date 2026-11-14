import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {FilePickerBlockState} from './threadTypes';
import './FilePickerBlock.module.css';

const styles = makeStyles('FilePickerBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/FilePickerInput.vue.
export function FilePickerBlock({state}: {state: FilePickerBlockState}) {
  const paths = pathsFor(state);
  const isResponse = Boolean(state.disabled && state.response);
  return (
    <div className={styles.root}>
      {state.disabled && paths.length ? <div className={styles.responseHeader}><Icons.Check size={16} /><span>{state.displayText || 'Selected files:'}</span></div> : null}
      {paths.map((path, index) => <PathRow disabled={Boolean(state.disabled || state.isLoading)} key={`${path}-${index}`} path={path} response={isResponse} />)}
      {!isResponse ? (
        <button className={state.disabled || state.isLoading ? styles.browseDisabled : styles.browse} disabled={state.disabled || state.isLoading} type="button">
          {state.isLoading ? <Icons.Loader2 size={16} /> : <Icons.FolderOpen size={16} />}
          <span>{state.isLoading ? 'Processing...' : browseText(state)}</span>
        </button>
      ) : null}
    </div>
  );
}

function PathRow({disabled, path, response}: {disabled?: boolean; path: string; response?: boolean}) {
  const hasExtension = /\.[^/.]+$/.test(path);
  const Icon = hasExtension ? Icons.File : Icons.Folder;
  return (
    <div className={response ? styles.pathResponse : styles.path}>
      <Icon size={16} />
      <span>{path}</span>
      {!response ? <button className={disabled ? styles.removeDisabled : styles.remove} disabled={disabled} title="Remove" type="button"><Icons.X size={16} /></button> : null}
    </div>
  );
}

function pathsFor(state: FilePickerBlockState) {
  const source = state.response ?? state.selectedPaths ?? [];
  if (Array.isArray(source)) return source;
  if (typeof source === 'object') {
    if (!source.path) return [];
    return Array.isArray(source.path) ? source.path : [source.path];
  }
  return [source];
}

function browseText(state: FilePickerBlockState) {
  const type = state.fileType === 'file' ? 'File' : state.fileType === 'directory' ? 'Directory' : 'File/Directory';
  return `Browse ${type}${state.allowMultiple ? 's' : ''}`;
}
