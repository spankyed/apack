import {Icons} from '../../primitives/Icon';
import type {SettingsProject} from '../settingsTypes';
import './CodeDirectorySelect.module.css';
import {makeStyles} from '../../primitives/makeStyles';

const styles = makeStyles('CodeDirectorySelect');

type CodeDirectorySelectProps = {
  disabled?: boolean;
  open?: boolean;
  projects?: SettingsProject[];
  value?: string | null;
};

export function CodeDirectorySelect({disabled = false, open = false, projects = [], value}: CodeDirectorySelectProps) {
  const selectedDirectory = projects.flatMap(project => project.directories).find(directory => directory.path === value);
  const selectedLabel = value == null ? 'Use last opened directory' : selectedDirectory?.name ?? value;

  return (
    <div className={styles.root}>
      <button className={styles.trigger} disabled={disabled} type="button">
        <span className={styles.selectedLabel}>{selectedLabel}</span>
        <Icons.ChevronDown className={styles.chevron} data-open={open} size={16} />
      </button>
      {open ? (
        <div className={styles.dropdown}>
          <div className={styles.option} data-active={value == null} data-hovered={value == null}>
            Use last opened directory
          </div>
          {projects.length > 0 ? <div className={styles.separator} /> : null}
          {projects.map((project, projectIndex) => (
            <div key={`${project.name}-${projectIndex}`}>
              <div className={styles.projectHeader}>
                <span className={styles.projectDot} style={{backgroundColor: project.color}} />
                {project.name || `Project ${projectIndex + 1}`}
              </div>
              {project.directories.map((directory, directoryIndex) => (
                <div className={styles.directoryOption} data-active={value === directory.path} key={`${directory.path}-${directoryIndex}`}>
                  <div className={styles.directoryMain}>
                    <span className={styles.projectDot} style={{backgroundColor: project.color || 'red'}} />
                    <span className={styles.folderName}>{directory.name}</span>
                    <span className={styles.fullPath}>{directory.displayPath}</span>
                  </div>
                  <span className={styles.projectName}>
                    {project.name}{project.directories.length > 1 ? ` (${directoryIndex + 1})` : ''}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
