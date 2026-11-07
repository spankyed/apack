<template>
  <form class="space-y-4" @submit.prevent="submit">
    <template v-if="disabled">
      <p class="text-sm text-neutral-400">{{ response?.validationFailed ? 'Response needs correction' : response?.cancelled || response?.buttonId === 'cancel' ? 'Cancelled' : response?.buttonId === 'decline' ? 'Declined' : 'Response submitted' }}</p>
      <dl v-if="response?.buttonId === 'accept' && response.content" class="space-y-2 text-sm">
        <div v-for="field in form.fields.filter(item => Object.hasOwn(response!.content!, item.name))" :key="field.name">
          <dt class="text-neutral-400">{{ field.title }}</dt><dd class="whitespace-pre-wrap text-neutral-200">{{ display(field) }}</dd>
        </div>
      </dl>
    </template>
    <template v-else>
      <div v-for="field in form.fields" :key="field.name" class="space-y-1">
        <label :id="ids[field.name]+'-label'" :for="ids[field.name]" class="block text-sm text-neutral-200">{{ field.title }}{{ field.required ? ' *' : '' }}</label>
        <p v-if="field.description" class="text-xs text-neutral-400">{{ field.description }}</p>
        <fieldset v-if="field.type === 'array'" :id="ids[field.name]" :aria-labelledby="ids[field.name]+'-label'" class="space-y-1">
          <label v-for="(option, index) in field.options" :key="index" class="flex gap-2 text-sm text-neutral-200">
            <input type="checkbox" :checked="selected(field.name, option.value)" @change="toggle(field.name, option.value)" />{{ option.label }}
          </label>
        </fieldset>
        <select v-else-if="field.options || field.type === 'boolean'" :id="ids[field.name]" :value="values[field.name] === undefined ? '' : String(values[field.name])" class="w-full rounded bg-neutral-800 px-3 py-2 text-neutral-200" @change="select(field, ($event.target as HTMLSelectElement).value)">
          <option value="">Select…</option>
          <template v-if="field.type === 'boolean'"><option value="true">Yes</option><option value="false">No</option></template>
          <option v-for="(option,index) in field.options" :key="index" :value="option.value">{{ option.label }}</option>
        </select>
        <input v-else :id="ids[field.name]" :type="field.type === 'number' || field.type === 'integer' ? 'number' : field.format === 'date' ? 'date' : 'text'" :step="field.type === 'integer' ? 1 : 'any'" :value="values[field.name] ?? ''" :placeholder="field.format === 'date-time' ? '2026-10-16T14:30:00Z' : ''" class="w-full rounded bg-neutral-800 px-3 py-2 text-neutral-200" @input="input(field, $event.target as HTMLInputElement)" />
        <p v-if="errorFor(field.name)" role="alert" class="text-sm text-red-400">{{ errorFor(field.name) }}</p>
      </div>
      <p v-for="error in generalErrors" :key="error" role="alert" class="text-sm text-red-400">{{ error }}</p>
      <div class="flex gap-2">
        <button type="submit" class="rounded bg-primary-600 px-3 py-2 text-white">Submit</button>
        <button type="button" class="rounded bg-neutral-700 px-3 py-2 text-neutral-200" @click="emit('submit', { buttonId: 'decline' })">Decline</button>
        <button type="button" class="rounded bg-neutral-700 px-3 py-2 text-neutral-200" @click="emit('submit', { buttonId: 'cancel' })">Cancel</button>
      </div>
    </template>
  </form>
</template>
<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { validateMcpElicitationForm, type ClaudeMcpForm, type ClaudeMcpFormField, type ClaudeMcpFormValue } from '#features/code/common/mcp-elicitation-form.ts';
const props = defineProps<{ form: ClaudeMcpForm; initialValues?: Record<string, unknown>; errors?: Record<string,string>; disabled?: boolean; response?: { buttonId?: string; cancelled?: boolean; validationFailed?: boolean; content?: Record<string,unknown> } }>();
const emit = defineEmits<{ (event: 'submit', response: { buttonId: 'accept' | 'decline' | 'cancel'; content?: Record<string,ClaudeMcpFormValue> }): void }>();
const values = ref<Record<string,unknown>>(Object.fromEntries(props.form.fields.map(field => [field.name, Object.hasOwn(props.initialValues ?? {},field.name) ? props.initialValues![field.name] : field.default])));
const baseId=useId(), ids=Object.fromEntries(props.form.fields.map((field,index)=>[field.name,`${baseId}-${index}`]));
const attempted=ref(false), edited=ref(false);
const shownErrors=computed(()=>attempted.value?validateMcpElicitationForm(props.form,values.value).errors:edited.value?{}:props.errors??{});
const generalErrors=computed(()=>Object.entries(shownErrors.value).filter(([name])=>!props.form.fields.some(field=>field.name===name)).map(([name,message])=>`${name?name+': ':''}${message}`));
function display(field:ClaudeMcpFormField){const value=props.response?.content?.[field.name];const label=(item:unknown)=>field.options?.find(option=>option.value===item)?.label??String(item);return Array.isArray(value)?value.map(label).join(', '):typeof value==='boolean'?value?'Yes':'No':label(value)}
function errorFor(name:string){return Object.hasOwn(shownErrors.value,name)?shownErrors.value[name]:undefined}
function set(name:string,value:unknown){values.value={...values.value,[name]:value};edited.value=true}
function selected(name:string,value:string){return Array.isArray(values.value[name]) && (values.value[name] as unknown[]).includes(value)}
function toggle(name:string,value:string){const prior=Array.isArray(values.value[name])?values.value[name] as string[]:[];set(name,prior.includes(value)?prior.filter(item=>item!==value):[...prior,value])}
function select(field:ClaudeMcpFormField,value:string){set(field.name,value===''?undefined:field.type==='boolean'?value==='true':value)}
function input(field:ClaudeMcpFormField,target:HTMLInputElement){set(field.name,target.value===''?undefined:field.type==='number'||field.type==='integer'?target.valueAsNumber:target.value)}
function submit(){if(props.disabled)return;attempted.value=true;const result=validateMcpElicitationForm(props.form,values.value);if(result.valid)emit('submit',{buttonId:'accept',content:result.content})}
</script>
