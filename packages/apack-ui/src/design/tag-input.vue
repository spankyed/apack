<script setup lang="ts">
import { ComboboxAnchor, ComboboxContent, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxItemIndicator, ComboboxPortal, ComboboxRoot, ComboboxTrigger, ComboboxViewport, TagsInputInput, TagsInputItem, TagsInputItemDelete, TagsInputItemText, TagsInputRoot, useFilter } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { X, ChevronDown } from 'lucide-vue-next'

const isOpen = ref(false)

interface TagOption {
  name: string;
  color?: string;
}

const props = defineProps<{
  modelValue: string[];  // Tag names
  availableTags: readonly TagOption[];
}>()
const emit = defineEmits<(e: 'update:modelValue', value: string[]) => void>()

const { startsWith } = useFilter({ sensitivity: 'base' })
const query = ref('')
// Convert between tag names and display objects
const displayTags = computed(() => 
  props.modelValue.map(tagName => {
    const tag = props.availableTags.find(t => t.name === tagName);
    return {
      name: tagName,
      color: tag?.color
    };
  })
)

const values = computed({
  get: () => displayTags.value,
  set: (val) => emit('update:modelValue', val.map(v => v.name))
})

watch(values, () => {
  query.value = ''
}, { deep: true })

const filteredOptions = computed(() =>
  props.availableTags
    .filter(option =>
      startsWith(option.name, query.value) && !props.modelValue.includes(option.name))
)
</script>

<template>
  <ComboboxRoot
    multiple
    ignore-filter
    class="relative w-full"
    v-model="values"
    :open="isOpen"
    @update:open="isOpen = $event"
    :allow-create="false"
  >
    <ComboboxAnchor class="w-full">
      <ComboboxTrigger as-child>
        <div class="inline-flex items-center justify-between rounded-md data-[open=true]:rounded-b-none px-3 py-2 text-sm leading-none gap-2 bg-neutral-800 border border-neutral-700 text-neutral-200 data-[placeholder]:text-neutral-600 outline-none w-full hover:border-neutral-600 focus-within:border-neutral-600 transition-all duration-200" :data-open="isOpen">
          <TagsInputRoot
            delimiter=""
            class="flex flex-wrap items-center gap-2"
          >
            <TagsInputItem
              v-for="item in values"
              :key="item.name"
              :value="item"
              class="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-md border transition-colors"
              :style="{
                backgroundColor: `${item.color || '#A855F7'}20`,
                color: item.color || '#A855F7',
                borderColor: `${item.color || '#A855F7'}33`
              }"
            >
              <TagsInputItemText class="text-xs">
                {{ item.name }}
              </TagsInputItemText>
              <TagsInputItemDelete
                @click.stop="values = values.filter((v) => v.name !== item.name)"
              >
                <X :size="14" class="hover:opacity-70" />
              </TagsInputItemDelete>
            </TagsInputItem>

            <ComboboxInput
              v-model="query"
              as-child
            >
              <TagsInputInput
                placeholder="Search tags..."
                class="focus:outline-none flex-1 !bg-transparent placeholder:text-neutral-600 px-1 py-0.5 text-sm"
                @keydown.enter.prevent
              />
            </ComboboxInput>
          </TagsInputRoot>

          <ChevronDown
            :size="16"
            class="text-neutral-500 transition-transform data-[state=open]:rotate-180" :data-state="isOpen ? 'open' : 'closed'"
          />
        </div>
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent 
        v-if="filteredOptions.length" 
        position="popper"
        side="bottom"
        align="start"
        :side-offset="4"
        class="z-50 min-w-[200px] max-w-[400px] bg-neutral-800 border border-neutral-700 overflow-hidden rounded-md shadow-lg"
      >
      <ComboboxViewport class="p-2">
        <ComboboxGroup>
          <ComboboxItem
            v-for="option in filteredOptions"
            :key="option.name"
            class="text-sm leading-none text-neutral-200 rounded flex items-center px-3 py-2 relative select-none data-[disabled]:text-neutral-600 data-[disabled]:pointer-events-none data-[highlighted]:outline-none data-[highlighted]:bg-neutral-700 data-[highlighted]:text-neutral-100 hover:bg-neutral-700 transition-colors cursor-pointer"
            :value="option"
          >
            <ComboboxItemIndicator
              class="absolute left-2 inline-flex items-center justify-center opacity-0 data-[state=checked]:opacity-100"
            >
              <div class="w-1.5 h-1.5 rounded-full bg-purple-400" />
            </ComboboxItemIndicator>
            <span class="ml-5">
              {{ option.name }}
            </span>
          </ComboboxItem>
        </ComboboxGroup>
      </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>