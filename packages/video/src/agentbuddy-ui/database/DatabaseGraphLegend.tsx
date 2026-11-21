import {makeStyles} from '../primitives/makeStyles';
import './DatabaseGraphLegend.module.css';

const styles = makeStyles('DatabaseGraphLegend');

export const databaseGraphEntityColors: Record<string, string> = {
  Agent: '#3B82F6',
  Brain: '#8B5CF6',
  Message: '#10B981',
  Thread: '#F59E0B',
  Tag: '#EF4444',
  Relation: '#6B7280',
  Artifact: '#14B8A6',
  Flow: '#EC4899',
  Node: '#6366F1',
};

export function DatabaseGraphLegend({colors = databaseGraphEntityColors}: {colors?: Record<string, string>}) {
  return (
    <div className={styles.root}>
      <div className={styles.scroll}>
        <div className={styles.items}>
          {Object.entries(colors).map(([type, color]) => (
            <div className={styles.item} key={type}>
              <div className={styles.swatch} style={{backgroundColor: color}} />
              <span>{type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
