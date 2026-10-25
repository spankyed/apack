<template>
  <div class="flex flex-col h-full bg-neutral-900">
    <!-- Header -->
    <NameSaveHeader label="Name" :isEditing="isEditMode" :isValid="isValid" @back="emit('CANCEL_EDIT')" @save="handleSave">
      <!-- Edit mode: input with shortCode badge -->
      <div
        v-if="isEditMode"
        class="flex items-center flex-1 min-w-0 rounded-md border border-neutral-700 bg-neutral-800 transition-colors focus-within:border-blue-500"
      >
        <input
          v-model="formData.name"
          type="text"
          class="flex-1 min-w-0 px-4 py-2 text-sm font-medium bg-transparent text-neutral-100 focus:outline-none"
          placeholder="Enter document name"
        />
        <span
          v-if="!isSymlink"
          class="px-3 py-1 mr-2 font-mono text-xs font-medium rounded cursor-pointer transition-colors bg-neutral-700/50"
          :class="copied ? 'text-green-400' : 'text-blue-400 hover:text-blue-300'"
          title="Click to copy"
          @click="copyShortCode"
        >{{ props.document!.shortCode }}</span>
      </div>
      <!-- Create mode: bare input -->
      <input
        v-else
        v-model="formData.name"
        type="text"
        data-onboarding-id="library-document-name-input"
        class="flex-1 min-w-0 px-4 py-2 text-sm font-medium transition-colors border rounded-md bg-neutral-800 border-neutral-700 text-neutral-100 focus:outline-none focus:border-blue-500"
        placeholder="Enter document name"
      />
    </NameSaveHeader>

    <!-- Form Content -->
    <div class="flex-1 overflow-y-auto">
      <div class="p-4">
        <form @submit.prevent="handleSave" class="space-y-6">
          <!-- Content Sections -->
          <div class="space-y-4" :data-onboarding-id="!isEditMode ? 'library-content-sections' : undefined">
            <ContentSectionEditor
              v-for="(section, index) in formData.content"
              :key="index"
              :ref="el => setSectionRef(el, index)"
              :section="section"
              :show-remove="formData.content.length > 1"
              :file-name="formData.name"
              :is-symlink="isSymlink"
              :entity-id="document?.id || mediaEntityId"
              @update="updateContentSection(index, $event)"
              @remove="removeContentSection(index)"
              @type-changed="handleTypeChanged(index)"
            />
          </div>
          <button
            v-if="!isSymlink"
            type="button"
            @click="addContentSection"
            class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors border rounded-md bg-neutral-800 border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
          >
            <Plus class="w-4 h-4" />
            Add Section
          </button>

          <!-- Tags Section -->
          <div v-if="!isSymlink" class="pt-6 border-t border-neutral-800">
            <button
              type="button"
              @click="tagsExpanded = !tagsExpanded"
              class="flex items-center gap-2 mb-4 text-xs font-medium tracking-wider uppercase text-neutral-400 hover:text-neutral-300 transition-colors"
            >
              <ChevronRight class="w-4 h-4 transition-transform" :class="{ 'rotate-90': tagsExpanded }" />
              Tags
              <span v-if="formData.tags.length > 0 && !tagsExpanded" class="ml-2 text-neutral-500">
                ({{ formData.tags.length }})
              </span>
            </button>
            <div v-if="tagsExpanded" class="space-y-3">
              <TagInput
                :modelValue="formData.tags"
                @update:modelValue="updateTags"
                :availableTags="availableTags"
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">

import { ref, computed, reactive, watch, onMounted, nextTick } from 'vue'
import { ChevronRight, Plus } from 'lucide-vue-next'
import NameSaveHeader from '@apackdev/ui/design/NameSaveHeader'
import ContentSectionEditor from './content-sections/ContentSectionEditor.vue'
import TagInput from '@apackdev/ui/design/tag-input'
import { useSettings } from '#generated/settings-fe.ts'
import type { DocumentDTO } from '#generated/types.ts'
import type { ContentSection } from '#features/library/be/types.ts'

const props = defineProps<{
  selectedCollectionId?: string
  document?: DocumentDTO
}>()

const emit = defineEmits<{
  SAVE_DOCUMENT: [{ name: string; content: ContentSection[]; tags: string[]; collectionId?: string }]
  CANCEL_EDIT: []
}>()

const isEditMode = computed(() => !!props.document)
const isSymlink = computed(() => props.document?.id?.startsWith('symlink:') ?? false)
const mediaEntityId = crypto.randomUUID()

const settings = useSettings('library')

const formData = reactive({
  name: '',
  content: [{ type: 'markdown', text: '' }] as ContentSection[],
  tags: [] as string[],
  collectionId: props.selectedCollectionId,
})

// Edit mode: hydrate from document
onMounted(() => {
  if (props.document) {
    formData.name = props.document.name
    formData.content = props.document.content ? [...props.document.content] : []
    formData.tags = props.document.tags ? [...props.document.tags] : []
  }
})

// Create mode: track collectionId changes
watch(() => props.selectedCollectionId, (newValue) => {
  if (!isEditMode.value) formData.collectionId = newValue
})

const copied = ref(false)
const tagsExpanded = ref(false)
const sectionRefs = ref<(InstanceType<typeof ContentSectionEditor> | null)[]>([])

const isValid = computed(() => {
  return formData.name.trim() !== '' && formData.content.length > 0
})

const availableTags = computed(() => {
  return settings.value.value?.tags || []
})

function updateTags(newTags: string[]) {
  formData.tags = newTags
}

function addContentSection() {
  formData.content.push({ type: 'markdown', text: '' } as ContentSection)
}

function updateContentSection(index: number, section: ContentSection) {
  formData.content[index] = section
}

function removeContentSection(index: number) {
  formData.content.splice(index, 1)
}

function handleSave() {
  emit('SAVE_DOCUMENT', {
    name: formData.name,
    content: formData.content,
    tags: formData.tags,
    collectionId: isEditMode.value ? props.document!.collectionId : formData.collectionId,
  })
}

function copyShortCode() {
  const code = props.document!.shortCode
  if (!code) return
  navigator.clipboard.writeText(code)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

function setSectionRef(el: any, index: number) {
  if (el) {
    sectionRefs.value[index] = el
  }
}

async function handleTypeChanged(index: number) {
  await nextTick()
  sectionRefs.value[index]?.scrollIntoView()
}
</script>
