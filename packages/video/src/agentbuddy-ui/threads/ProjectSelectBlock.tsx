import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ProjectSelectBlockState} from './threadTypes';
import './ProjectSelectBlock.module.css';

const styles = makeStyles('ProjectSelectBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/ProjectSelectInput.vue.
export function ProjectSelectBlock({state}: {state: ProjectSelectBlockState}) {
  const selected = state.response ? state.projects.find(project => project.directories[0] === state.response) : null;
  const projects = selected ? [selected] : state.projects;
  return (
    <div className={styles.root}>
      {state.disabled && selected ? <div className={styles.responseHeader}><Icons.Check size={16} /><span>{state.displayText || 'Selected project:'}</span></div> : null}
      {projects.map(project => (
        <button className={styles.project} key={project.name} type="button">
          <span className={styles.dot} style={{backgroundColor: project.color || '#3B82F6'}} />
          <span className={styles.text}>
            <span className={styles.name}>{project.name}</span>
            <span className={styles.path}>{project.directories[0] ?? ''}</span>
          </span>
          {!state.disabled ? <Icons.ChevronRight size={16} /> : null}
        </button>
      ))}
    </div>
  );
}
