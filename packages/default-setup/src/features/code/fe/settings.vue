<template>
  <div class="max-w-3xl">
    <!-- Default Base Directory Section -->
    <CollapsibleSection label="Default Base Directory" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Configure which project directory the code editor opens to on startup
      </p>
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium text-neutral-200">
            Default Base Directory
          </label>
          <button
            @click="goToProjects"
            class="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Go to Projects →
          </button>
        </div>
        <DirectorySelect
          v-model="defaultBaseDirectory"
          :projects="projects"
          :disabled="getAllProjects().length === 0"
          @update:modelValue="saveDefaultDirectory"
        />
        <p class="text-xs text-neutral-600">
          {{ getAllProjects().length === 0
            ? 'Add projects in Settings → General → Projects to set a default directory'
            : 'If set, the code editor will always open to this project on startup'
          }}
        </p>
      </div>
    </CollapsibleSection>

    <!-- Editor Settings Section -->
    <div class="border-t border-neutral-800 pt-8">
      <CollapsibleSection label="Editor Settings" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Configure editor behavior and preferences
      </p>
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="enable-preview" class="text-sm font-medium text-neutral-200">
              Enable preview tabs
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Single-clicking a file opens it as a preview. Preview tabs are replaced when opening another file. Double-click or edit to keep.
            </p>
          </div>
          <input
            id="enable-preview"
            v-model="enablePreview"
            type="checkbox"
            @change="saveEnablePreviewSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>

        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="md-editor-default" class="text-sm font-medium text-neutral-200">
              Use rich text editor for Markdown files
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Open .md files in the Tiptap rich text editor by default instead of the Monaco code editor
            </p>
          </div>
          <input
            id="md-editor-default"
            v-model="mdEditorDefault"
            type="checkbox"
            @change="saveMdEditorDefaultSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>
      </div>
    </CollapsibleSection>
    </div>

    <!-- Git Settings Section -->
    <div class="border-t border-neutral-800 pt-8">
    <CollapsibleSection label="Git Settings" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Configure git remote sync behavior
      </p>
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="auto-fetch-remote" class="text-sm font-medium text-neutral-200">
              Auto-fetch remote
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Periodically fetch from the remote to detect new commits available to pull
            </p>
          </div>
          <input
            id="auto-fetch-remote"
            v-model="autoFetchRemote"
            type="checkbox"
            @change="saveAutoFetchRemoteSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>
        <div v-if="autoFetchRemote" class="flex items-center justify-between">
          <div class="flex-1">
            <label for="auto-fetch-interval" class="text-sm font-medium text-neutral-200">
              Fetch interval (seconds)
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              How often to check the remote for new commits (minimum 60 seconds)
            </p>
          </div>
          <input
            id="auto-fetch-interval"
            v-model.number="autoFetchIntervalSeconds"
            type="number"
            min="60"
            @change="saveAutoFetchIntervalSetting"
            class="w-20 px-2 py-1 text-sm bg-neutral-800 border border-neutral-600 rounded text-neutral-200 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>
    </CollapsibleSection>
    </div>

    <!-- Commit Panel Section -->
    <div class="border-t border-neutral-800 pt-8">
    <CollapsibleSection label="Commit Panel" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Choose which sections to show in the commit panel
      </p>
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="show-commits" class="text-sm font-medium text-neutral-200">
              Show commits
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Show the commit log section in the commit panel
            </p>
          </div>
          <input
            id="show-commits"
            v-model="showCommits"
            type="checkbox"
            @change="saveShowCommitsSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>

        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="show-stashes" class="text-sm font-medium text-neutral-200">
              Show stashes
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Show the stashes section in the commit panel
            </p>
          </div>
          <input
            id="show-stashes"
            v-model="showStashes"
            type="checkbox"
            @change="saveShowStashesSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>

        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="show-worktrees" class="text-sm font-medium text-neutral-200">
              Show worktrees
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Show the worktrees section in the commit panel
            </p>
          </div>
          <input
            id="show-worktrees"
            v-model="showWorktrees"
            type="checkbox"
            @change="saveShowWorktreesSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>
      </div>
    </CollapsibleSection>
    </div>

    <!-- Terminal Settings Section -->
    <div class="border-t border-neutral-800 pt-8">
      <CollapsibleSection label="Terminal Settings" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Configure terminal behavior and preferences
      </p>
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="restore-terminals" class="text-sm font-medium text-neutral-200">
              Restore terminals on startup
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Automatically restore previously opened terminals when the application starts, each with the
              screen it had. What a terminal prints is kept in a file only you can read until it is closed
            </p>
          </div>
          <input
            id="restore-terminals"
            v-model="restoreTerminals"
            type="checkbox"
            @change="saveTerminalSettings"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>

        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="enable-shell-integration" class="text-sm font-medium text-neutral-200">
              Enable shell integration
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Track directory changes automatically (displays a brief setup command on terminal startup)
            </p>
          </div>
          <input
            id="enable-shell-integration"
            v-model="enableShellIntegration"
            type="checkbox"
            @change="saveShellIntegrationSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>

        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="confirm-terminal-close" class="text-sm font-medium text-neutral-200">
              Confirm before closing terminals
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Show a confirmation prompt when closing terminal tabs
            </p>
          </div>
          <input
            id="confirm-terminal-close"
            v-model="confirmTerminalClose"
            type="checkbox"
            @change="saveConfirmTerminalCloseSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>

        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="close-terminal-on-tab-close" class="text-sm font-medium text-neutral-200">
              Close terminal process when tab is closed
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Terminate the terminal process when closing a terminal tab
            </p>
          </div>
          <input
            id="close-terminal-on-tab-close"
            v-model="closeTerminalOnTabClose"
            type="checkbox"
            @change="saveCloseTerminalOnTabCloseSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>

        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="max-terminals" class="text-sm font-medium text-neutral-200">
              Maximum terminals
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Maximum number of terminals that can be open at once
            </p>
          </div>
          <div class="flex items-center gap-2">
            <input
              v-if="maxTerminals > 0"
              id="max-terminals"
              v-model.number="maxTerminals"
              type="number"
              min="1"
              max="100"
              @change="saveMaxTerminalsSetting"
              class="w-20 px-2 py-1 text-sm text-neutral-200 bg-neutral-800 border border-neutral-600 rounded focus:ring-blue-500 focus:ring-2 focus:outline-none"
            />
            <span v-else class="text-xs text-neutral-500">No limit</span>
            <input
              id="limit-terminals"
              type="checkbox"
              :checked="maxTerminals > 0"
              @change="toggleTerminalLimit"
              class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
              title="Toggle terminal limit"
            />
          </div>
        </div>
      </div>
    </CollapsibleSection>
    </div>

    <!-- Terminal Scripts Section -->
    <div class="border-t border-neutral-800 pt-8">
      <CollapsibleSection label="Terminal Scripts" :default-open="true" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Saved commands that can be run in new terminals via the ▶ button in the terminal header
        </p>
        <div class="space-y-3">
          <!-- Existing scripts -->
          <div
            v-for="(script, index) in localScripts"
            :key="script.id"
            class="flex items-center gap-2"
          >
            <input
              v-model="localScripts[index].label"
              placeholder="Label"
              @blur="saveScripts"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
              class="w-32 px-2 py-1 text-sm bg-neutral-800 border border-neutral-600 rounded text-neutral-200 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              v-model="localScripts[index].command"
              placeholder="Command"
              @blur="saveScripts"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
              class="flex-1 px-2 py-1 text-sm bg-neutral-800 border border-neutral-600 rounded text-neutral-200 font-mono focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              @click="deleteScript(index)"
              class="p-1 text-neutral-500 hover:text-red-400 transition-colors flex-shrink-0"
              title="Remove script"
            >
              <X :size="16" />
            </button>
          </div>

          <!-- Add new script -->
          <div class="flex items-center gap-2">
            <input
              v-model="newScriptLabel"
              placeholder="Label"
              @keydown.enter="addScript"
              class="w-32 px-2 py-1 text-sm bg-neutral-800 border border-neutral-700 rounded text-neutral-200 placeholder-neutral-600 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              v-model="newScriptCommand"
              placeholder="Command"
              @keydown.enter="addScript"
              class="flex-1 px-2 py-1 text-sm bg-neutral-800 border border-neutral-700 rounded text-neutral-200 placeholder-neutral-600 font-mono focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              @click="addScript"
              :disabled="!newScriptLabel.trim() || !newScriptCommand.trim()"
              class="p-1 transition-colors flex-shrink-0"
              :class="newScriptLabel.trim() && newScriptCommand.trim() ? 'text-neutral-400 hover:text-white' : 'text-neutral-700 cursor-not-allowed'"
              title="Add script"
            >
              <Plus :size="16" />
            </button>
          </div>

          <p v-if="localScripts.length === 0" class="text-xs text-neutral-600">
            No scripts saved. Add one above.
          </p>
        </div>
      </CollapsibleSection>
    </div>

    <!-- Code Hotkeys Section -->
    <div class="border-t border-neutral-800 pt-8">
      <CollapsibleSection label="Code Hotkeys" :default-open="true" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Keyboard shortcuts available when the code surface is active
        </p>
        <div class="space-y-6">
          <div class="group">
            <KeyboardShortcutInput
              v-model="hotkeys.openTerminal"
              id="open-terminal"
              label="Open Terminal"
              @change="saveHotkey('openTerminal')"
              container-class="flex-1"
              :show-reset-button="true"
            />
            <p class="mt-1.5 text-xs text-neutral-600">
              Open a new terminal in the current working directory
            </p>
          </div>

          <div class="group">
            <KeyboardShortcutInput
              v-model="hotkeys.openTerminalTab"
              id="open-terminal-tab"
              label="Open Terminal Tab"
              @change="saveHotkey('openTerminalTab')"
              container-class="flex-1"
              :show-reset-button="true"
            />
            <p class="mt-1.5 text-xs text-neutral-600">
              Open a new terminal as an editor tab
            </p>
          </div>

          <div class="group">
            <KeyboardShortcutInput
              v-model="hotkeys.focusSearch"
              id="focus-search"
              label="Focus Search"
              @change="saveHotkey('focusSearch')"
              container-class="flex-1"
              :show-reset-button="true"
            />
            <p class="mt-1.5 text-xs text-neutral-600">
              Open the search panel and focus the search input
            </p>
          </div>

          <div class="group">
            <div class="flex gap-4">
              <KeyboardShortcutInput
                v-model="hotkeys.navigatePrevPanel"
                id="navigate-prev-panel"
                label="Previous Panel"
                @change="saveHotkey('navigatePrevPanel')"
                container-class="flex-1"
                :show-reset-button="true"
              />

              <KeyboardShortcutInput
                v-model="hotkeys.navigateNextPanel"
                id="navigate-next-panel"
                label="Next Panel"
                @change="saveHotkey('navigateNextPanel')"
                container-class="flex-1"
                :show-reset-button="true"
              />
            </div>

            <p class="mt-2 text-xs text-neutral-600">
              Navigate between panels in the code view
            </p>
          </div>
        </div>
      </CollapsibleSection>
    </div>

    <!-- Save status will be managed by parent -->
  </div>
</template>

<script setup lang="ts">
import { X, Plus } from 'lucide-vue-next'
import { ref, computed } from 'vue'
import type { SettingUpdate, SettingsOf } from '#generated/settings-fe.ts'
import KeyboardShortcutInput from '@apackdev/ui/components/KeyboardShortcutInput'
import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'
import DirectorySelect from '@apackdev/ui/design/DirectorySelect'

import { useSettingsDraft, untypedOpenSurface } from '@apackdev/sdk/fe'
import { resolveName } from '@apackdev/sdk/ids'

const HOST_SETTINGS = resolveName('settings', 'host')
import { useAppSettings } from '#generated/settings-fe.ts'

interface Project {
  name: string
  directories: string[]  // First directory is primary
  color: string
}

interface Props {
  settings?: SettingsOf<'code'>
}

const props = withDefaults(defineProps<Props>(), {
  settings: undefined
})

const emit = defineEmits<{
  'update-setting': [SettingUpdate<'code'>]
}>()

const hotkeys = useSettingsDraft(() => props.settings?.hotkeys ?? {})

const restoreTerminals = useSettingsDraft(() => props.settings?.restoreTerminals ?? true)
const enableShellIntegration = useSettingsDraft(() => props.settings?.enableShellIntegration ?? false)
const confirmTerminalClose = useSettingsDraft(() => props.settings?.confirmTerminalClose ?? true)
const closeTerminalOnTabClose = useSettingsDraft(() => props.settings?.closeTerminalOnTabClose ?? true)
const maxTerminals = useSettingsDraft(() => props.settings?.maxTerminals ?? 25)
const enablePreview = useSettingsDraft(() => props.settings?.enablePreview ?? true)
const mdEditorDefault = useSettingsDraft(() => props.settings?.mdEditorDefault ?? true)
const defaultBaseDirectory = useSettingsDraft(() => props.settings?.defaultBaseDirectory || null)
const autoFetchRemote = useSettingsDraft(() => props.settings?.autoFetchRemote ?? false)
const autoFetchIntervalSeconds = useSettingsDraft(() => props.settings?.autoFetchIntervalSeconds ?? 180)
const showStashes = useSettingsDraft(() => props.settings?.showStashes ?? true)
const showCommits = useSettingsDraft(() => props.settings?.showCommits ?? true)
const showWorktrees = useSettingsDraft(() => props.settings?.showWorktrees ?? false)

// Terminal scripts
const localScripts = useSettingsDraft(() => props.settings?.terminalScripts ?? [])
const newScriptLabel = ref('')
const newScriptCommand = ref('')

// Get projects from general settings
const { value: general } = useAppSettings()
const storedProjects = computed(() => general.value?.projects ?? [])
const projects = computed(() => (storedProjects.value ?? []) as Project[])

// Helper functions
const getAllProjects = (): Project[] => {
  return projects.value
}

// Save functions
const saveHotkey = (key: string) => {
  emit('update-setting', { path: ['hotkeys', key], value: hotkeys.value[key] ?? null })
}

const saveTerminalSettings = () => {
  emit('update-setting', {
    path: ['restoreTerminals'],
    value: restoreTerminals.value
  })
}

const saveShellIntegrationSetting = () => {
  emit('update-setting', {
    path: ['enableShellIntegration'],
    value: enableShellIntegration.value
  })
}

const saveConfirmTerminalCloseSetting = () => {
  emit('update-setting', {
    path: ['confirmTerminalClose'],
    value: confirmTerminalClose.value
  })
}

const saveCloseTerminalOnTabCloseSetting = () => {
  emit('update-setting', {
    path: ['closeTerminalOnTabClose'],
    value: closeTerminalOnTabClose.value
  })
}

const saveMaxTerminalsSetting = () => {
  const clamped = Math.max(1, Math.min(100, maxTerminals.value))
  maxTerminals.value = clamped
  emit('update-setting', {
    path: ['maxTerminals'],
    value: clamped
  })
}

const toggleTerminalLimit = () => {
  maxTerminals.value = maxTerminals.value > 0 ? 0 : 25
  emit('update-setting', {
    path: ['maxTerminals'],
    value: maxTerminals.value
  })
}

const saveEnablePreviewSetting = () => {
  emit('update-setting', {
    path: ['enablePreview'],
    value: enablePreview.value
  })
}

const saveMdEditorDefaultSetting = () => {
  emit('update-setting', {
    path: ['mdEditorDefault'],
    value: mdEditorDefault.value
  })
}

const saveAutoFetchRemoteSetting = () => {
  emit('update-setting', {
    path: ['autoFetchRemote'],
    value: autoFetchRemote.value
  })
}

const saveAutoFetchIntervalSetting = () => {
  const value = Math.max(60, autoFetchIntervalSeconds.value || 180)
  autoFetchIntervalSeconds.value = value
  emit('update-setting', {
    path: ['autoFetchIntervalSeconds'],
    value
  })
}

const saveShowStashesSetting = () => {
  emit('update-setting', {
    path: ['showStashes'],
    value: showStashes.value
  })
}

const saveShowCommitsSetting = () => {
  emit('update-setting', {
    path: ['showCommits'],
    value: showCommits.value
  })
}

const saveShowWorktreesSetting = () => {
  emit('update-setting', {
    path: ['showWorktrees'],
    value: showWorktrees.value
  })
}

const saveDefaultDirectory = () => {
  emit('update-setting', {
    path: ['defaultBaseDirectory'],
    value: defaultBaseDirectory.value
  })
}

const saveScripts = () => {
  emit('update-setting', {
    path: ['terminalScripts'],
    value: [...localScripts.value]
  })
}

const addScript = () => {
  const label = newScriptLabel.value.trim()
  const command = newScriptCommand.value.trim()
  if (!label || !command) return
  localScripts.value.push({ id: `ts_${Date.now()}`, label, command })
  newScriptLabel.value = ''
  newScriptCommand.value = ''
  saveScripts()
}

const deleteScript = (index: number) => {
  localScripts.value.splice(index, 1)
  saveScripts()
}

const goToProjects = () => {
  untypedOpenSurface(HOST_SETTINGS, [
    { type: 'TAB.SELECT', tab: 'general' },
    { type: 'GENERAL_NAV.SELECT', item: 'projects' }
  ])
}
</script>
