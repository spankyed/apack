import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ProjectSelectBlockState} from './threadTypes';
import './ProjectSelectBlock.module.css';

const styles = makeStyles('ProjectSelectBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/ProjectSelectInput.vue.
export function ProjectSelectBlock({state}: {state: ProjectSelectBlockState}) {
  const selectedDir = selectedDirectory(state.response);
  const selected = selectedDir ? state.projects.find(project => project.directories[0] === selectedDir) : null;

  if (!state.disabled && state.projects.length === 0) {
    return <div className={styles.empty}>No projects configured</div>;
  }

  if (state.disabled && state.response) {
    return (
      <div className={styles.root}>
        <div className={styles.responseHeader}><Icons.Check size={16} /><span>{state.displayText || 'Selected project:'}</span></div>
        <div className={styles.responseProject}>
          {selected?.color ? <span className={styles.dot} style={{backgroundColor: selected.color}} /> : null}
          <span className={styles.responseName}>{selected?.name || selectedDir}</span>
          <span className={styles.responsePath}>{selected?.directories[0] ?? ''}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {state.projects.map(project => (
        <button className={state.disabled ? styles.projectDisabled : styles.project} disabled={state.disabled} key={project.name} type="button">
          <span className={styles.dot} style={{backgroundColor: project.color || '#3B82F6'}} />
          <span className={styles.text}>
            <span className={styles.name}>{project.name}</span>
            <span className={styles.path}>{project.directories[0] ?? ''}</span>
          </span>
          <Icons.ChevronRight size={16} />
        </button>
      ))}
    </div>
  );
}

function selectedDirectory(response: ProjectSelectBlockState['response']) {
  if (!response) return '';
  return typeof response === 'string' ? response : response.path ?? '';
}
