<template>
  <div class="flex items-center gap-2 px-3 py-1.5 bg-neutral-900 border-b border-neutral-800">
    <!-- Back -->
    <button
      class="p-1.5 rounded-md transition-colors"
      :class="canGoBack ? 'text-neutral-300 hover:bg-neutral-800' : 'text-neutral-600 cursor-default'"
      :disabled="!canGoBack"
      @click="emit('back')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>

    <!-- Forward -->
    <button
      class="p-1.5 rounded-md transition-colors"
      :class="canGoForward ? 'text-neutral-300 hover:bg-neutral-800' : 'text-neutral-600 cursor-default'"
      :disabled="!canGoForward"
      @click="emit('forward')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>

    <!-- Reload / Stop -->
    <button
      class="p-1.5 rounded-md text-neutral-300 hover:bg-neutral-800 transition-colors"
      @click="props.isLoading ? emit('stop') : emit('reload')"
    >
      <svg v-if="props.isLoading" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
    </button>

    <!-- Address bar -->
    <form class="flex-1 relative" @submit.prevent="onSubmit">
      <input
        ref="addressInput"
        type="text"
        @input="onInput"
        @focus="isFocused = true; emit('focus')"
        @blur="handleBlur"
        @keydown="onKeydown"
        @auxclick.prevent="onMiddleClick"
        class="w-full px-3 py-1.5 text-sm bg-neutral-800 border border-neutral-700 rounded-lg outline-none text-neutral-200 placeholder-neutral-500 focus:border-neutral-500 transition-colors"
        placeholder="Enter URL or search..."
      />

      <BrowserAutocomplete
        v-if="props.suggestions.length > 0 && isFocused"
        :suggestions="props.suggestions"
        :selectedIndex="props.selectedSuggestionIndex"
        @select="onSuggestionClick"
        @hover="emit('autocomplete:select', $event)"
      />
    </form>

    <!-- Bookmark star -->
    <button
      class="p-1.5 rounded-md transition-colors"
      :class="props.isBookmarked ? 'text-yellow-400' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'"
      :title="props.isBookmarked ? 'Remove bookmark' : 'Bookmark this page'"
      @click="emit('toggle-bookmark')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" :fill="props.isBookmarked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    </button>

    <!-- Bookmarks dropdown trigger -->
    <div class="relative">
      <button
        class="p-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
        title="All bookmarks"
        @click="showBookmarkDropdown = !showBookmarkDropdown"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </button>
      <BrowserBookmarkDropdown
        v-if="showBookmarkDropdown"
        :bookmarks="props.bookmarks"
        @navigate="showBookmarkDropdown = false; emit('bookmark-navigate', $event)"
        @remove="emit('bookmark-remove', $event)"
        @close="showBookmarkDropdown = false"
      />
    </div>

    <!-- DevTools -->
    <button
      class="p-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
      title="Toggle DevTools"
      @click="emit('toggle-devtools')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import type { AutocompleteSuggestion, Bookmark } from '../state.ts';
import BrowserAutocomplete from './BrowserAutocomplete.vue';
import BrowserBookmarkDropdown from './BrowserBookmarkDropdown.vue';

const addressInput = ref<HTMLInputElement | null>(null);
const isFocused = ref(false);
const showBookmarkDropdown = ref(false);
// Track whether we're programmatically setting the input value to avoid emitting
let suppressInput = false;

const props = defineProps<{
  addressBarValue: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  suggestions: readonly AutocompleteSuggestion[];
  selectedSuggestionIndex: number;
  inlineCompletion: string | null;
  isBookmarked: boolean;
  bookmarks: readonly Bookmark[];
}>();

const emit = defineEmits<{
  back: [];
  forward: [];
  reload: [];
  stop: [];
  navigate: [url: string];
  'open-in-new-tab': [url: string];
  'update:addressBarValue': [value: string];
  focus: [];
  blur: [];
  'toggle-devtools': [];
  'autocomplete:select': [index: number];
  'autocomplete:dismiss': [];
  'autocomplete:accept-inline': [];
  'toggle-bookmark': [];
  'bookmark-navigate': [url: string];
  'bookmark-remove': [url: string];
}>();

// Sync input value from props + inline completion
watch(
  () => [props.addressBarValue, props.inlineCompletion] as const,
  ([value, completion]) => {
    if (!addressInput.value) return;
    const el = addressInput.value;

    if (completion && isFocused.value) {
      const full = value + completion;
      if (el.value !== full) {
        suppressInput = true;
        el.value = full;
        suppressInput = false;
      }
      nextTick(() => {
        el.setSelectionRange(value.length, full.length);
      });
    } else {
      if (el.value !== value) {
        suppressInput = true;
        el.value = value;
        suppressInput = false;
      }
    }
  },
);

function handleBlur() {
  // Delay blur to allow @mousedown.prevent on the autocomplete dropdown to cancel it.
  // Without the delay, isFocused goes false → dropdown unmounts → click never fires.
  setTimeout(() => {
    isFocused.value = false;
    emit('blur');
  }, 150);
}

function onInput(e: Event) {
  if (suppressInput) return;
  const value = (e.target as HTMLInputElement).value;
  emit('update:addressBarValue', value);
}

function onSubmit() {
  const value = props.addressBarValue.trim();
  if (value) {
    emit('navigate', value);
    // Blur the input after navigation
    addressInput.value?.blur();
  }
}

function onSuggestionClick(index: number) {
  const suggestion = props.suggestions[index];
  if (suggestion) {
    emit('navigate', suggestion.url);
    addressInput.value?.blur();
  }
}

function onKeydown(e: KeyboardEvent) {
  const hasSuggestions = props.suggestions.length > 0;

  switch (e.key) {
    case 'ArrowDown':
      if (hasSuggestions) {
        e.preventDefault();
        const next = Math.min(props.selectedSuggestionIndex + 1, props.suggestions.length - 1);
        emit('autocomplete:select', next);
      }
      break;

    case 'ArrowUp':
      if (hasSuggestions) {
        e.preventDefault();
        const prev = props.selectedSuggestionIndex <= 0 ? -1 : props.selectedSuggestionIndex - 1;
        emit('autocomplete:select', prev);
      }
      break;

    case 'Escape':
      if (hasSuggestions) {
        e.preventDefault();
        e.stopPropagation();
        emit('autocomplete:dismiss');
      } else {
        (e.target as HTMLInputElement).blur();
      }
      break;

    case 'ArrowRight':
    case 'End':
      if (props.inlineCompletion) {
        // Only accept if cursor is at the end of the user's input
        const el = e.target as HTMLInputElement;
        if (el.selectionStart === props.addressBarValue.length) {
          e.preventDefault();
          emit('autocomplete:accept-inline');
        }
      }
      break;

    case 'Tab':
      if (props.inlineCompletion) {
        e.preventDefault();
        emit('autocomplete:accept-inline');
      }
      break;

    case 'Backspace':
    case 'Delete':
      if (props.inlineCompletion) {
        e.preventDefault();
        emit('autocomplete:dismiss');
      }
      break;
  }
}

function onMiddleClick(e: MouseEvent) {
  if (e.button !== 1) return;
  const value = (e.target as HTMLInputElement).value.trim();
  if (value) {
    emit('open-in-new-tab', value);
  }
}

function focusAddressBar() {
  addressInput.value?.focus();
  addressInput.value?.select();
}

defineExpose({ focusAddressBar });
</script>
