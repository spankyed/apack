<template>
  <div class="category-filter relative">
    <!-- Header Button -->
    <button
      @click.stop="showDropdown = !showDropdown"
      class="px-6 py-3 text-xs font-medium tracking-wider text-left uppercase text-neutral-400 hover:text-neutral-300 transition-colors flex items-center gap-2"
    >
      <span>Category</span>
      <span v-if="activeFilterCount > 0" class="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full bg-primary-600 text-white">
        {{ activeFilterCount }}
      </span>
    </button>

    <!-- Dropdown -->
    <Transition name="dropdown">
      <div
        v-if="showDropdown"
        class="absolute z-50 mt-1 min-w-[200px] p-2 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl"
      >
        <!-- "All" Option -->
        <div
          @click="selectAll"
          :class="[
            'px-3 py-2 rounded-lg border transition-all duration-200 cursor-pointer mb-2',
            activeFilterCount === 0
              ? 'bg-primary-600/20 border-primary-600 ring-2 ring-primary-600/50'
              : 'bg-neutral-700/50 border-neutral-600 hover:border-neutral-500'
          ]"
        >
          <div class="flex items-center gap-2">
            <!-- Checkbox Icon -->
            <div
              :class="[
                'flex-shrink-0 w-4 h-4 rounded-md transition-all',
                activeFilterCount === 0
                  ? 'bg-primary-600 border-2 border-primary-600'
                  : 'bg-neutral-600 border-2 border-neutral-500'
              ]"
            >
              <div
                v-if="activeFilterCount === 0"
                class="w-full h-full flex items-center justify-center"
              >
                <Check class="w-3 h-3 text-white" />
              </div>
            </div>
            <span class="text-sm font-medium text-neutral-200">All</span>
          </div>
        </div>

        <!-- Category Options -->
        <div class="space-y-1">
          <div
            v-for="category in categories"
            :key="category.name"
            @click="toggleCategory(category.name)"
            :class="[
              'px-3 py-2 rounded-lg border transition-all duration-200 cursor-pointer',
              isSelected(category.name)
                ? 'bg-primary-600/20 border-primary-600 ring-2 ring-primary-600/50'
                : 'bg-neutral-700/50 border-neutral-600 hover:border-neutral-500'
            ]"
          >
            <div class="flex items-center gap-2">
              <!-- Checkbox Icon -->
              <div
                :class="[
                  'flex-shrink-0 w-4 h-4 rounded-md transition-all',
                  isSelected(category.name)
                    ? 'bg-primary-600 border-2 border-primary-600'
                    : 'bg-neutral-600 border-2 border-neutral-500'
                ]"
              >
                <div
                  v-if="isSelected(category.name)"
                  class="w-full h-full flex items-center justify-center"
                >
                  <Check class="w-3 h-3 text-white" />
                </div>
              </div>

              <!-- Category Label with Color -->
              <span
                class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border whitespace-nowrap"
                :style="{
                  borderColor: category.color,
                  color: category.color,
                  backgroundColor: `${category.color}15`
                }"
              >
                {{ category.name }}
              </span>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="categories.length === 0" class="px-3 py-4 text-center text-sm text-neutral-500">
          No categories available
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Check } from 'lucide-vue-next'

interface Category {
  name: string
  color: string
}

interface Props {
  categories: Category[]
  selectedCategories: readonly string[]
}

interface Emits {
  (e: 'toggle-category', categoryName: string): void
  (e: 'clear-filters'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const showDropdown = ref(false)

const activeFilterCount = computed(() => props.selectedCategories.length)

const isSelected = (categoryName: string): boolean => {
  return props.selectedCategories.includes(categoryName)
}

const toggleCategory = (categoryName: string) => {
  emit('toggle-category', categoryName)
}

const selectAll = () => {
  emit('clear-filters')
  showDropdown.value = false
}

// Close dropdown when clicking outside
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (!target.closest('.category-filter')) {
    showDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
