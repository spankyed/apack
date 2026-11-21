import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './DataRenderer.module.css';

const styles = makeStyles('LogsDataRenderer');

type DataRendererProps = {
  compact?: boolean;
  data: unknown;
  depth?: number;
  hideExpand?: boolean;
};

export function DataRenderer({compact = false, data, depth = 0, hideExpand = false}: DataRendererProps) {
  return (
    <div className={styles.root}>
      {depth === 0 ? (
        <div className={styles.actions}>
          {!isPrimitive(data) && !hideExpand ? (
            <button className={compact ? styles.compactAction : styles.action} title="View in modal" type="button">
              <Icons.Maximize2 size={12} />
              {!compact ? <span>Expand</span> : null}
            </button>
          ) : null}
          <button className={compact ? styles.compactAction : styles.action} title="Copy to clipboard" type="button">
            <Icons.Copy size={12} />
            {!compact ? <span>Copy</span> : null}
          </button>
        </div>
      ) : null}
      <div className={styles.scroll}>
        <div className={styles.mono}>
          <RenderedValue data={data} depth={depth} />
        </div>
      </div>
    </div>
  );
}

function RenderedValue({data, depth}: {data: unknown; depth: number}) {
  if (isPrimitive(data)) {
    return (
      <div className={styles.primitive}>
        <span className={styles.type}>{getType(data)}</span>
        <span className={primitiveClass(data)}>{formatPrimitive(data)}</span>
      </div>
    );
  }

  if (Array.isArray(data)) {
    return (
      <div className={styles.composite}>
        <button className={styles.toggle} type="button">
          <Icons.ChevronRight className={styles.openChevron} size={10} />
          <span className={styles.arrayLabel}>Array</span>
          <span className={styles.count}>[{data.length}]</span>
        </button>
        <div className={styles.children}>
          {data.map((item, index) => (
            <div className={styles.childRow} key={index}>
              <span className={styles.index}>{index}</span>
              <RenderedValue data={item} depth={depth + 1} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isObject(data)) {
    const entries = Object.entries(data);
    return (
      <div className={styles.composite}>
        <button className={styles.toggle} type="button">
          <Icons.ChevronRight className={styles.openChevron} size={10} />
          <span className={styles.objectLabel}>Object</span>
          {entries.length > 0 ? <span className={styles.count}>({entries.length})</span> : null}
        </button>
        <div className={styles.children}>
          {entries.map(([key, value]) => (
            <div className={styles.childRow} key={key}>
              <span className={styles.key}>{key}:</span>
              <RenderedValue data={value} depth={depth + 1} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function isPrimitive(value: unknown) {
  return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getType(value: unknown) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}

function formatPrimitive(value: unknown) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

function primitiveClass(value: unknown) {
  if (value === null || value === undefined) return styles.nullish;
  if (typeof value === 'string') return styles.string;
  if (typeof value === 'number') return styles.number;
  if (typeof value === 'boolean') return styles.boolean;
  return styles.defaultValue;
}
