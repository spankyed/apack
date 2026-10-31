<template>
  <div class="flex flex-col h-full bg-neutral-900">
    <!-- Header -->
    <NameSaveHeader
      label="Title"
      :isEditing="isViewMode"
      :isValid="isValid"
      :hideSave="isViewMode"
      @back="actor.send({ type: isViewMode ? 'VIEW_LIST' : 'CANCEL_CREATE' })"
      @save="actor.send({ type: 'CREATE_THREAD' })"
    >
      <template #actions>
        <Button
          v-if="isViewMode"
          @click="actor.send({ type: 'OPEN_THREAD_CHAT', threadId })"
          variant="ghost"
          class="shrink-0"
        >
          <MessageSquare :size="14" />
          <span>Chat</span>
        </Button>
      </template>
      <input
        :value="topic"
        @input="e => updateField('topic', (e.target as HTMLInputElement).value)"
        type="text"
        placeholder="Enter thread topic"
        data-onboarding-id="thread-topic-input"
        class="flex-1 min-w-0 px-4 py-2 text-sm font-medium transition-colors border rounded-md bg-neutral-800 border-neutral-700 text-neutral-100 focus:outline-none focus:border-blue-500"
      />
      <select
        :disabled="!isViewMode"
        :value="statusValue"
        @input="e => updateField('status', (e.target as HTMLSelectElement).value ?? '')"
        :class="[
          'px-3 py-2 text-sm font-medium transition-colors border rounded-md shrink-0 bg-neutral-800 border-neutral-700',
          isViewMode
            ? 'text-neutral-100 hover:border-neutral-600 focus:outline-none focus:border-blue-500'
            : 'text-neutral-300 opacity-50 cursor-not-allowed'
        ]"
      >
        <option
          v-for="statusOption in (settings?.statuses || [])"
          :key="statusOption.label"
          :value="statusOption.label"
        >
          {{ statusOption.label }}
        </option>
        <option v-if="!settings?.statuses?.length" value="Backlog">Backlog</option>
      </select>
    </NameSaveHeader>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto custom-scrollbar">
      <div class="max-w-4xl p-4 mx-auto">
        <div class="space-y-4">
          <!-- Instructions -->
          <div data-onboarding-id="thread-instructions-input">
            <label class="block mb-2 text-xs font-medium tracking-wider uppercase text-neutral-400">Instructions</label>
            <div class="border rounded-md border-neutral-700 p-3 pr-6 pl-1">
              <TiptapEditor
                mode="editor"
                show-gutter
                :model-value="instructions"
                :entity-id="threadId || mediaEntityId"
                placeholder="Enter instructions for the agent"
                @update:model-value="v => updateField('instructions', v)"
              />
            </div>
          </div>

          <!-- Tags -->
          <CollapsibleSection :default-open="false" button-class="py-3">
            <template #label>
              <div class="flex items-center gap-2">
                <span>Tags</span>
                <div v-if="tags && tags.length > 0" class="flex items-center gap-1">
                  <span class="text-neutral-500 mr-1">•</span>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="tag in tags.slice(0, 5)"
                      :key="tag"
                      :style="getTagStyles(tag)"
                      class="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-md truncate"
                    >
                      {{ tag }}
                    </span>
                    <span v-if="tags.length > 5" class="px-2 py-0.5 text-xs text-neutral-400">
                      +{{ tags.length - 5 }} more
                    </span>
                  </div>
                </div>
              </div>
            </template>
            <TagInput
              data-onboarding-id="thread-tags-section"
              :modelValue="tags || []"
              :available-tags="availableTags"
              @update:modelValue="(newTags) => updateField('tags', newTags)"
              class="w-full"
            />
          </CollapsibleSection>
        </div>

        <!-- Messages Section (view only) -->
        <div v-if="isViewMode" ref="messagesSection" class="border-t border-neutral-800">
          <CollapsibleSection :default-open="false" button-class="py-3" @toggle="onMessagesToggle">
            <template #label>
              Messages ({{ messages.length }})
            </template>
            <div v-if="messages.length > 0">
              <MessageList :is-messages-open="true" :messages="messages" />
            </div>
            <div v-else class="text-sm text-neutral-500 italic">
              No messages yet
            </div>
          </CollapsibleSection>
        </div>

        <!-- Linked Threads Section -->
        <div ref="linkedThreadsSection" class="border-t border-neutral-800">
          <CollapsibleSection :default-open="false" button-class="py-3" @toggle="onLinkedThreadsToggle">
            <template #label>
              Linked Threads ({{ linkedThreads.length }})
            </template>
            <template #header-actions>
              <button
                data-onboarding-id="thread-linked-section"
                type="button"
                @click.stop="linkThreadInput?.toggleInput()"
                class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                <Link :size="14" />
                Link Thread
              </button>
              <button
                v-if="isViewMode"
                @click.stop="actor.send({ type: 'SHOW_CREATE_FORM_AS_CHILD', parentThreadId: threadId })"
                type="button"
                class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors rounded-md text-neutral-300 bg-neutral-800 hover:bg-neutral-700 hover:text-neutral-100"
              >
                <Plus :size="14" />
                Create Child
              </button>
            </template>
            <ThreadLinkInput
              ref="linkThreadInput"
              :lite="!isViewMode"
              v-model="linkedThreads"
              :available-threads="threadsList"
              :available-tags="availableTags"
              :settings="settings"
              :refusal="isViewMode ? linkRefusal : null"
              @chat-click="(id) => actor.send({ type: 'OPEN_THREAD_CHAT', threadId: id })"
              @select="(id) => actor.send({ type: 'SELECT_THREAD', id })"
              @status-change="(id, status) => actor.send({ type: 'UPDATE_THREAD_STATUS', id, status })"
              @update:modelValue="(links) => updateField('linkedThreads', links)"
              @set-parent="(childIds, parentId) => actor.send({ type: 'SET_THREAD_PARENT', childIds, parentId })"
            />
          </CollapsibleSection>
        </div>

        <!-- Metadata Section (view only) -->
        <div v-if="isViewMode" class="border-t border-neutral-800">
          <CollapsibleSection :default-open="false" button-class="py-3">
            <template #label>Metadata</template>
            <div class="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-neutral-500">
              <span>ID <span class="font-mono text-neutral-400">{{ threadId }}</span></span>
              <span>Short Code <span class="text-neutral-400">{{ shortCode || '—' }}</span></span>
              <span>Created <span class="text-neutral-400">{{ formatDate(timestamp) }}</span></span>
              <span>Last Activity <span class="text-neutral-400">{{ formatDate(lastMessageTimestamp || timestamp) }}</span></span>
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { ref, computed, nextTick } from 'vue'
import { Plus, MessageSquare, Link } from 'lucide-vue-next'
import Button from '@apackdev/ui/design/button'
import { useSelector } from '@xstate/vue'
import { threadsFromStore, type ThreadsState } from '#features/threads/fe/state.ts'
import type { ThreadEditFields } from '#generated/types.ts'
import type { Ref } from 'vue'
import NameSaveHeader from '@apackdev/ui/design/NameSaveHeader'
import MessageList from './components/message-list.vue'
import TagInput from '@apackdev/ui/design/tag-input'
import ThreadLinkInput from '#features/threads/fe/canvas/components/link-thread-input.vue'
import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'

const actor: ThreadsState = useSurface();
const mediaEntityId = crypto.randomUUID();

// Mode derivation from state machine
const state = useSelector(actor, (s) => s);
const isViewMode = computed(() => state.value.matches('view'));
const mode = computed<'view' | 'create'>(() => isViewMode.value ? 'view' : 'create');

// Unified context selectors
const contextSlice = computed(() =>
  isViewMode.value ? state.value.context.view : state.value.context.create
);
const topic = computed(() => contextSlice.value.topic || '');
const instructions = computed(() => contextSlice.value.instructions || '');
const tags = computed(() => contextSlice.value.tags || []);
const linkedThreads = computed(() => contextSlice.value.linkedThreads || []);
const linkRefusal = useSelector(actor, (state) => state.context.linkRefusal);

// Shared selectors
const availableTags = useSelector(actor, (state) => state.context.availableTags);
const threadMap = useSelector(actor, (state) => state.context.threadMap);
const threadIdsAll = useSelector(actor, (state) => state.context.threadIds);
const threadsList = computed(() => threadsFromStore(threadMap.value, threadIdsAll.value));
const settings = useSelector(actor, (state) => state.context.settings);

// View-only selectors
const threadId = useSelector(actor, (state) => state.context.view.id);
const messages = useSelector(actor, (state) => state.context.view.messages || []);
const status = useSelector(actor, (state) => state.context.view.status || 'Backlog');
const shortCode = useSelector(actor, (state) => state.context.view.shortCode);
const timestamp = useSelector(actor, (state) => state.context.view.timestamp);
const lastMessageTimestamp = useSelector(actor, (state) => state.context.view.lastMessageTimestamp);

const statusValue = computed(() =>
  isViewMode.value ? status.value : (settings.value?.statuses?.[0]?.label || 'Backlog')
);

const isValid = computed(() => topic.value.trim() !== '');

const updateField = (key: keyof ThreadEditFields, value: ThreadEditFields[keyof ThreadEditFields]) => {
  actor.send({ type: 'UPDATE_THREAD_FIELD', key, value, state: mode.value });
};

// Section scroll handling
const messagesSection: Ref<HTMLDivElement | null> = ref(null);
const linkedThreadsSection: Ref<HTMLDivElement | null> = ref(null);
const linkThreadInput = ref<InstanceType<typeof ThreadLinkInput> | null>(null);

const onMessagesToggle = (isOpen: boolean) => {
  if (isOpen && messagesSection.value) {
    nextTick(() => {
      messagesSection.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
};

const onLinkedThreadsToggle = (isOpen: boolean) => {
  if (isOpen && linkedThreadsSection.value) {
    nextTick(() => {
      linkedThreadsSection.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
};

const formatDate = (ts?: number) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
};

const getTagStyles = (tagName: string) => {
  const color = availableTags.value?.find(t => t.name === tagName)?.color || '#A855F7';
  return {
    backgroundColor: `${color}1A`,
    color,
    border: `1px solid ${color}33`
  };
};
</script>
