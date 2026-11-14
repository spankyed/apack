import {Icons} from '../../primitives/Icon';
import type {SettingsProject} from '../settingsTypes';
import './SettingsCommon.module.css';
import './ProjectsSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const common = makeStyles('SettingsCommon');
const styles = makeStyles('ProjectsSettings');

export function ProjectsSettings({projects}: {projects: SettingsProject[]}) {
  return (
    <div className={common.panel}>
      <p className={`${common.description} ${styles.description}`}>Manage your projects. Each project can contain multiple directories.</p>
      <div className={styles.list}>
        {projects.map(project => (
          <article className={styles.project} key={project.name}>
            <header className={styles.projectHeader}>
              <span className={styles.swatch} style={{background: project.color}} />
              <input className={styles.name} readOnly value={project.name} />
              <button className={styles.dirButton} type="button"><Icons.Plus size={12} />Add Directory</button>
              <button className={styles.removeProjectButton} type="button"><Icons.X size={14} /></button>
            </header>
            <div className={styles.dirs}>
              {project.directories.map((dir, index) => (
                <span
                  className={styles.dir}
                  data-primary={index === 0}
                  key={dir.path}
                  style={index === 0 ? {borderLeftColor: project.color} : undefined}
                >
                  <span>{dir.displayPath}</span>
                  <button className={styles.removeDirButton} data-disabled={project.directories.length === 1} type="button"><Icons.X size={12} /></button>
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
      <button className={styles.addProjectButton} type="button"><Icons.Plus size={14} />Add Project</button>
    </div>
  );
}
