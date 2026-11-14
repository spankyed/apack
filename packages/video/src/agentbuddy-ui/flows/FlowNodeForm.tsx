import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import type {FlowNodeFormFieldState, FlowNodeFormSectionState, FlowNodeFormState} from './flowTypes';
import './FlowNodeForm.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('FlowNodeForm');

const actionIcon = {
  code: Icons.Code,
  external: Icons.ExternalLink,
  plus: Icons.Plus,
  trash: Icons.Trash2,
};

// Mirrors packages/renderer/src/plugins/flows/canvas/components/NodeForm.vue
// plus the BaseForm node-specific form shell.
export function FlowNodeForm({state}: {state: FlowNodeFormState}) {
  return (
    <>
      <div className={styles.overlay} />
      <aside className={styles.panel} data-onboarding-id="flow-node-form">
        <header className={styles.header}>
          <h2 className={styles.title}>{state.nodeKind}</h2>
          <div className={styles.actions}>
            {state.canAddNextStep ? (
              <button className={styles.nextButton} type="button">
                <Icons.ArrowRight size={14} />
                <span>Next step</span>
              </button>
            ) : null}
            <button aria-label="Close form" className={styles.closeButton} type="button">
              <Icons.X size={18} />
            </button>
          </div>
        </header>
        <div className={styles.body}>
          <div className={styles.stack}>
            <Field field={{label: 'Label', required: false, value: state.nodeLabel}} />
            {state.sections.map(section => <Section key={section.title} section={section} />)}
          </div>
        </div>
      </aside>
    </>
  );
}

function Section({section}: {section: FlowNodeFormSectionState}) {
  const ActionIcon = section.action?.icon ? actionIcon[section.action.icon] : undefined;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{section.title}</h3>
        {section.action ? (
          <button className={styles.sectionAction} type="button">
            {ActionIcon ? <ActionIcon size={12} /> : null}
            <span>{section.action.label}</span>
          </button>
        ) : null}
      </div>
      {section.fields?.map(field => <Field field={field} key={field.label} />)}
      {section.items?.map(item => (
        <div className={cx(styles.card, item.tone === 'warning' && styles.cardWarning)} key={item.label}>
          <div className={styles.cardHeader}>
            {item.badge ? <span className={styles.badge}>{item.badge}</span> : null}
            <span className={styles.cardTitle}>{item.label}</span>
          </div>
          {item.description ? <p className={styles.description}>{item.description}</p> : null}
          {item.fields?.map(field => <Field field={field} key={field.label} />)}
        </div>
      ))}
    </section>
  );
}

function Field({field}: {field: FlowNodeFormFieldState}) {
  const type = field.type ?? 'input';
  return (
    <label className={styles.field}>
      <span className={styles.labelRow}>
        <span className={styles.label}>
          {field.label}
          {field.required ? <span className={styles.required}> *</span> : null}
        </span>
      </span>
      {type === 'select' ? <div className={styles.select}>{field.value}</div> : null}
      {type === 'segmented' ? (
        <div className={styles.segmented}>
          {(field.options ?? []).map(option => (
            <span className={cx(styles.segment, option.selected && styles.segmentActive)} key={option.label}>{option.label}</span>
          ))}
        </div>
      ) : null}
      {type === 'checkbox' ? (
        <span className={styles.checkboxField}>
          <span className={cx(styles.checkbox, field.checked && styles.checkboxChecked)}>{field.checked ? <Icons.Check size={10} /> : null}</span>
          <span>{field.value ?? field.label}</span>
        </span>
      ) : null}
      {type === 'textarea' ? <div className={styles.textarea}>{field.value}</div> : null}
      {type === 'code' ? (
        <div className={styles.code}>
          <MonacoCodeViewer filePath={field.filePath} height={field.height ?? 160} language={field.language} value={field.value ?? ''} />
        </div>
      ) : null}
      {type === 'input' ? <div className={styles.input}>{field.value}</div> : null}
      {field.description ? <span className={styles.description}>{field.description}</span> : null}
    </label>
  );
}
