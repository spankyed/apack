import type {ReferenceCategory, ReferenceRefType} from './chatTypes';
import {referenceSvgElementsFor} from './referenceConfig';
import {cx} from '../primitives/classNames';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('ChatComposer');

export function ReferencePill({
  label,
  refType,
  selected,
}: {
  label: string;
  refType: ReferenceRefType;
  selected?: boolean;
}) {
  const content = (
    <>
      <span className={cx(styles.referencePillIcon, 'reference-pill-icon')}>
        <ReferenceIconSvg refType={refType} size={14} />
      </span>
      <span className={cx(styles.referencePillLabel, 'reference-pill-label')}>{label}</span>
    </>
  );

  const className = cx(styles.referencePill, 'reference-pill', selected && 'ProseMirror-selectednode');
  return (
    <span className={className} contentEditable={false} data-ref-type={refType}>
      {content}
    </span>
  );
}

export function ReferenceIcon({className, tone = 'pill', refType}: {className?: string; tone?: 'pill' | 'suggestion'; refType: ReferenceCategory | ReferenceRefType}) {
  const iconClassName = tone === 'suggestion' ? cx(styles.referenceSuggestionIcon, className) : className;
  const size = tone === 'suggestion' ? 16 : 14;
  return <ReferenceIconSvg className={iconClassName} refType={refType} size={size} />;
}

function ReferenceIconSvg({className, refType, size}: {className?: string; refType: ReferenceCategory | ReferenceRefType; size: number}) {
  const elements = referenceSvgElementsFor(refType);
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width={size}
    >
      {elements.map(([tag, attrs], index) => {
        if (tag === 'rect') return <rect key={index} {...attrs} />;
        if (tag === 'circle') return <circle key={index} {...attrs} />;
        return <path key={index} {...attrs} />;
      })}
    </svg>
  );
}
