import {ActionFunctionEditor} from './ActionFunctionEditor';
import {ActionParametersEditor} from './ActionParametersEditor';
import type {ActionDetailState} from './actionTypes';
import {CollapsibleSection} from './CollapsibleSection';
import {NameSaveHeader} from './NameSaveHeader';
import {JsonSchemaEditor} from '../design/JsonSchemaEditor';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './ActionDetail.module.css';

const styles = makeStyles('ActionDetail');

type ActionDetailProps = {
  state: ActionDetailState;
};

export function ActionDetail({state}: ActionDetailProps) {
  const isEditing = Boolean(state.action);
  const isValid = state.formData.label.trim() !== '' && state.formData.actionFn.trim() !== '';

  return (
    <div className={styles.root}>
      <NameSaveHeader isEditing={isEditing} isValid={isValid}>
        <input className={styles.nameInput} data-onboarding-id="action-label-input" readOnly type="text" value={state.formData.label} />
        <select className={styles.categorySelect} value={state.formData.category ?? ''}>
          <option value="">No Category</option>
          {state.categories.map(category => (
            <option key={category.name} value={category.name}>{category.name}</option>
          ))}
        </select>
      </NameSaveHeader>

      <div className={styles.contentScroll}>
        <div className={styles.content}>
          <div className={styles.sectionFirst}>
            <CollapsibleSection label="Input Parameters" open={state.parametersExpanded ?? true}>
              <ActionParametersEditor parameters={state.formData.input} />
            </CollapsibleSection>
          </div>

          <div className={styles.section}>
            <div className={styles.functionLabelRow}>
              <label>
                Function Template<span>*</span>
              </label>
              {state.action ? (
                <button className={styles.openEditorButton} type="button">
                  <Icons.ExternalLink size={12} />
                  Open in editor
                </button>
              ) : null}
            </div>
            <p className={styles.servicesInfo} data-onboarding-id="action-services-info">
              An async JavaScript function body that receives `params` object and `services` (logger, database, LLM, http) object.
            </p>
            <ActionFunctionEditor value={state.formData.actionFn} />
          </div>

          <div className={styles.section}>
            <CollapsibleSection label="Output Schema (Optional)" open={state.outputExpanded ?? Boolean(state.formData.output)}>
              <JsonSchemaEditor value={state.formData.output} />
            </CollapsibleSection>
          </div>

          <div className={styles.section}>
            <CollapsibleSection label="Description" open={false}>
              <textarea className={styles.descriptionBox} data-onboarding-id="action-description-input" readOnly rows={3} value={state.formData.description ?? ''} />
            </CollapsibleSection>
          </div>

          <div className={styles.section}>
            <CollapsibleSection label="Metadata" open={state.metadataExpanded ?? true}>
              <div className={styles.metadata}>
                <span>ID <span>{state.action?.id ?? 'N/A'}</span></span>
                <span>Created <span>{formatDate(state.action?.createdAt)}</span></span>
                <span>Updated <span>{formatDate(state.action?.updatedAt)}</span></span>
              </div>
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDate(timestamp?: number) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleString();
}
