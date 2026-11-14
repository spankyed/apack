import {Icons} from '../primitives/Icon';
import {ToolbarButton} from './ToolbarButton';
import './Toolbar.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('Toolbar');

export type PluginId =
  | 'threads'
  | 'notes'
  | 'code'
  | 'library'
  | 'flows'
  | 'actions'
  | 'prompts'
  | 'brain'
  | 'database'
  | 'logs'
  | 'settings';

type ToolbarProps = {
  activePlugin: PluginId;
};

const toolbarPlugins = [
  {id: 'threads', label: 'Threads', icon: Icons.Threads, isPinned: false},
  {id: 'notes', label: 'Notes', icon: Icons.NotebookText, isPinned: false},
  {id: 'code', label: 'Code', icon: Icons.Code2, isPinned: false},
  {id: 'library', label: 'Library', icon: Icons.Library, isPinned: false},
  {id: 'flows', label: 'Flows', icon: Icons.Flows, isPinned: false},
  {id: 'actions', label: 'Actions', icon: Icons.Play, isPinned: false},
  {id: 'prompts', label: 'Prompts', icon: Icons.Sparkle, isPinned: false},
  {id: 'brain', label: 'Brain', icon: Icons.Brain, isPinned: true},
  {id: 'database', label: 'Database', icon: Icons.Database, isPinned: true},
  {id: 'logs', label: 'Logs', icon: Icons.Bug, isPinned: true},
  {id: 'settings', label: 'Settings', icon: Icons.Settings, isPinned: true},
] as const;

// Mirrors packages/renderer/src/core/components/layout/toolbar.vue.
export function Toolbar({activePlugin}: ToolbarProps) {
  const pluginItems = toolbarPlugins.filter(item => !item.isPinned);
  const pinnedItems = toolbarPlugins.filter(item => item.isPinned);

  return (
    <aside className={styles.root} data-onboarding-id="toolbar">
      <div className={styles.windowControlsArea} />
      <div className={styles.scrollArea}>
        <div className={styles.buttonStack}>
          {pluginItems.map(item => (
            <ToolbarButton key={item.id} id={item.id} label={item.label} icon={item.icon} active={activePlugin === item.id} />
          ))}
        </div>
      </div>
      <div className={styles.pinnedArea}>
        {pinnedItems.map(item => (
          <ToolbarButton key={item.id} id={item.id} label={item.label} icon={item.icon} active={activePlugin === item.id} />
        ))}
      </div>
    </aside>
  );
}
