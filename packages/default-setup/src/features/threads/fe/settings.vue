<template>
  <div class="max-w-3xl">
    <!-- Chat (agent) Sections -->
    <div class="mb-8">
      <!-- Conversation -->
      <CollapsibleSection label="Conversation" :default-open="true" class="mb-8">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label for="skip-revert-confirm" class="text-sm font-medium text-neutral-200">
              Skip revert confirmation
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Revert messages without showing a confirmation dialog
            </p>
          </div>
          <input
            id="skip-revert-confirm"
            v-model="skipRevertConfirm"
            type="checkbox"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
            @change="saveSkipRevertConfirm"
          />
        </div>

        <div class="flex items-center justify-between mt-4">
          <div class="flex-1">
            <label for="skip-archive-confirm" class="text-sm font-medium text-neutral-200">
              Skip archive confirmation
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Archive threads without showing a confirmation dialog
            </p>
          </div>
          <input
            id="skip-archive-confirm"
            v-model="skipArchiveConfirm"
            type="checkbox"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
            @change="saveSkipArchiveConfirm"
          />
        </div>

        <div class="flex items-center justify-between mt-4">
          <div class="flex-1">
            <label for="quick-prompt-number-key-inserts" class="text-sm font-medium text-neutral-200">
              Insert quick prompt on number key
            </label>
            <p class="mt-1 text-xs text-neutral-600">
              Pressing a number key inserts the prompt into the chat instead of copying to clipboard
            </p>
          </div>
          <input
            id="quick-prompt-number-key-inserts"
            v-model="quickPromptNumberKeyInserts"
            type="checkbox"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
            @change="saveQuickPromptNumberKeyInserts"
          />
        </div>
      </CollapsibleSection>

      <!-- Chat Modes -->
      <CollapsibleSection label="Chat Modes" :default-open="true" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Configure different conversation modes for the AI agent
        </p>
        <p v-if="modesValidationMessage" class="text-sm text-red-400 mb-4">
          {{ modesValidationMessage }}
        </p>
        <div class="space-y-4">
          <div
            v-for="(mode, index) in modes"
            :key="mode.id"
            class="group"
          >
            <div class="flex items-center gap-3">
              <input
                v-model="mode.name"
                type="text"
                placeholder="Mode name"
                class="w-32 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
                @input="debouncedSaveModes"
              />
              <input
                v-model="mode.description"
                type="text"
                placeholder="Description of this mode"
                class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
                @input="debouncedSaveModes"
              />
              <button
                @click="toggleMode(index)"
                class="px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg transition-all"
                :class="mode.disabled ? 'text-neutral-600 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-200'"
                :title="mode.disabled ? 'Enable mode' : 'Disable mode'"
              >
                <EyeOff v-if="mode.disabled" class="w-4 h-4" />
                <Eye v-else class="w-4 h-4" />
              </button>
              <button
                @click="removeMode(index)"
                class="px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-400 hover:text-red-400 hover:border-red-500/50 transition-all"
                :disabled="modes.length <= 1"
                title="Remove mode"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
          </div>

          <button
            @click="addMode"
            class="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/50 transition-all flex items-center gap-1.5"
          >
            <Plus class="w-3.5 h-3.5" />
            Add Mode
          </button>
        </div>
      </CollapsibleSection>

      <!-- Mode Phases -->
      <CollapsibleSection label="Mode Phases" :default-open="true" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Configure phases for modes that support multiple work phases
        </p>

        <div class="mb-4">
          <label class="block text-sm text-neutral-400 mb-2">Select mode to configure phases:</label>
          <select
            v-model="selectedModeName"
            class="w-full px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
          >
            <option
              v-for="mode in modes.filter(m => !m.hidden)"
              :key="mode.id"
              :value="mode.name"
            >
              {{ mode.name }}
            </option>
          </select>
        </div>

        <div v-if="selectedMode">
          <div v-if="(selectedMode.phases || []).length > 0" class="space-y-3 mb-4">
            <div
              v-for="(phase, index) in (selectedMode.phases || [])"
              :key="phase.id"
              class="border rounded-md bg-neutral-800/50 border-neutral-700"
            >
              <div class="flex items-center gap-2 p-2">
                <ColorPicker
                  v-model="phase.color"
                  allow-clear
                  @change="saveModes"
                />
                <input
                  v-model="phase.name"
                  type="text"
                  placeholder="Phase name"
                  class="w-32 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
                  @input="debouncedSaveModes"
                />
                <input
                  v-model="phase.description"
                  type="text"
                  placeholder="Description of this phase"
                  class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
                  @input="debouncedSaveModes"
                />
                <button
                  @click="removePhase(index)"
                  class="p-1 rounded-md hover:bg-neutral-700 hover:text-red-400 transition-all text-neutral-400"
                  title="Remove phase"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <button
            @click="addPhase"
            class="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-2 border-dashed rounded-md border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300"
          >
            <Plus class="w-3.5 h-3.5" />
            Add Phase
          </button>
        </div>
      </CollapsibleSection>

      <!-- Default Mode -->
      <CollapsibleSection label="Default Mode" :default-open="true" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Mode and phase applied when starting a new thread or launching the app.
        </p>
        <div class="flex items-end gap-3">
          <div class="flex-1">
            <label class="block text-sm text-neutral-400 mb-2">Mode</label>
            <select
              v-model="defaultMode"
              class="w-full px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
              @change="onDefaultModeChange"
            >
              <option value="">(None)</option>
              <option
                v-for="mode in selectableDefaultModes"
                :key="mode.id"
                :value="mode.name"
              >
                {{ mode.name }}
              </option>
            </select>
          </div>
          <div v-if="defaultModePhases.length > 0" class="flex-1">
            <label class="block text-sm text-neutral-400 mb-2">Phase</label>
            <select
              v-model="defaultPhase"
              class="w-full px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
              @change="saveDefaultPhase"
            >
              <option value="">(Use first phase)</option>
              <option
                v-for="phase in defaultModePhases"
                :key="phase.id"
                :value="phase.name"
              >
                {{ phase.name }}
              </option>
            </select>
          </div>
        </div>
      </CollapsibleSection>

      <!-- Quick Prompts -->
      <CollapsibleSection label="Quick Prompts" :default-open="true" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Short reusable prompts that can be quickly inserted into the chat input
        </p>
        <div class="space-y-3">
          <div
            v-for="(prompt, index) in quickPrompts"
            :key="prompt.id"
            class="flex items-start gap-3"
          >
            <textarea
              v-auto-resize
              v-model="prompt.text"
              rows="1"
              placeholder="Prompt text"
              class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all resize-none overflow-y-hidden"
              style="max-height: calc(1.5em * 5 + 16px)"
              @input="autoResize($event); debouncedSaveQuickPrompts()"
            />
            <button
              @click="removeQuickPrompt(index)"
              class="px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-400 hover:text-red-400 hover:border-red-500/50 transition-all"
              title="Remove prompt"
            >
              <X class="w-4 h-4" />
            </button>
          </div>

          <button
            @click="addQuickPrompt"
            class="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/50 transition-all flex items-center gap-1.5"
          >
            <Plus class="w-3.5 h-3.5" />
            Add Prompt
          </button>
        </div>
      </CollapsibleSection>

      <!-- Agent Hotkeys -->
      <CollapsibleSection label="Agent Hotkeys" :default-open="true" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Keyboard shortcuts available when the agent surface is active
        </p>
        <div class="space-y-6">
          <div class="group">
            <KeyboardShortcutInput
              v-model="hotkeys.textToSpeech"
              id="text-to-speech"
              label="Text to Speech"
              container-class="flex-1"
              :show-reset-button="true"
              @change="saveHotkey('textToSpeech')"
            />
            <p class="mt-1.5 text-xs text-neutral-600">
              Convert agent responses to speech (currently a stub feature)
            </p>
          </div>

          <div class="group">
            <KeyboardShortcutInput
              v-model="hotkeys.switchMode"
              id="switch-mode"
              label="Switch Mode"
              container-class="flex-1"
              :show-reset-button="true"
              @change="saveHotkey('switchMode')"
            />
            <p class="mt-1.5 text-xs text-neutral-600">
              Cycle through available chat modes
            </p>
          </div>
        </div>
      </CollapsibleSection>
    </div>

    <!-- Status Management Section -->
    <CollapsibleSection label="Thread Statuses" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Manage the status options available for threads
      </p>
      <div class="space-y-3">
        <div
          v-for="(status, index) in statuses"
          :key="`status-${index}`"
          class="group flex items-center gap-3"
        >
          <ColorPicker
            v-model="status.color"
            @change="saveStatuses"
          />

          <!-- Status Label -->
          <input
            v-model="status.label"
            type="text"
            placeholder="Status label"
            class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
            @input="debouncedSave"
          />

          <!-- Remove Button -->
          <button
            @click="removeStatus(index)"
            class="px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-400 hover:text-red-400 hover:border-red-500/50 transition-all"
            :disabled="statuses.length <= 1"
            title="Remove status"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Add Status Button -->
        <button
          @click="addStatus"
          class="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/50 transition-all flex items-center gap-1.5"
        >
          <Plus class="w-3.5 h-3.5" />
          Add Status
        </button>
      </div>
    </CollapsibleSection>

    <!-- Tags Management Section -->
    <CollapsibleSection label="Thread Tags" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Manage the tags available for organizing threads
      </p>
      <div class="space-y-3"  data-onboarding-id="settings-thread-tags">
        <div
          v-for="(tag, index) in tags"
          :key="`tag-${index}`"
          class="group flex items-center gap-3"
        >
          <ColorPicker
            v-model="tag.color"
            @change="saveTags"
          />

          <!-- Tag Name -->
          <input
            v-model="tag.name"
            type="text"
            placeholder="Tag name"
            class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
            @input="debouncedSaveTags"
          />

          <!-- Remove Button -->
          <button
            @click="removeTag(index)"
            class="px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-400 hover:text-red-400 hover:border-red-500/50 transition-all"
            :disabled="tags.length <= 1"
            title="Remove tag"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Add Tag Button -->
        <button
          @click="addTag"
          class="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/50 transition-all flex items-center gap-1.5"
        >
          <Plus class="w-3.5 h-3.5" />
          Add Tag
        </button>
      </div>
    </CollapsibleSection>

    <!-- Chat State Indicators Section -->
    <CollapsibleSection label="Chat State Indicators" :default-open="false" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Customize the colors and labels for chat activity states
      </p>
      <TooltipProvider :delay-duration="400">
      <div class="space-y-3">
        <div
          v-for="(cs, index) in chatStateConfigs"
          :key="cs.id"
          class="group flex items-center gap-3"
        >
          <ColorPicker
            v-model="cs.color"
            @change="saveChatStates"
          />

          <!-- Label -->
          <input
            v-model="cs.label"
            type="text"
            class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
            @input="debouncedSaveChatStates"
          />

          <!-- Busy toggle (radio-style: only one active) -->
          <TooltipRoot>
            <TooltipTrigger as-child>
              <button
                @click="setChatStateBusy(index)"
                class="px-3 py-2 rounded-lg border transition-all text-xs"
                :class="cs.busy
                  ? 'border-purple-500/50 bg-purple-500/10 text-purple-300'
                  : 'border-neutral-700/50 bg-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600'"
              >
                ✦
              </button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent
                side="top"
                :side-offset="6"
                class="max-w-xs px-3 py-2 text-xs text-neutral-200 bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl z-[100]"
              >
                Marks this as the active "busy" state. While a chat is in this state it shows the animated indicator and the Pause button appears (press Esc to pause).
              </TooltipContent>
            </TooltipPortal>
          </TooltipRoot>

          <!-- State ID badge (read-only) -->
          <span class="text-xs text-neutral-600 w-16 text-right font-mono">{{ cs.id }}</span>
        </div>
      </div>
      </TooltipProvider>
    </CollapsibleSection>

    <!-- Display Options Section -->
    <div class="border-t border-neutral-800 pt-8">
      <CollapsibleSection label="Display Options" :default-open="true" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Configure how threads are displayed in the list
        </p>
        <div class="space-y-4">
          <div class="flex items-start gap-3">
            <input
              id="show-root-threads"
              v-model="showOnlyRootThreads"
              type="checkbox"
              class="mt-1 w-4 h-4 bg-neutral-800 border border-neutral-700 rounded text-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 focus:ring-offset-neutral-900"
              @change="saveDisplayOptions"
            />
            <div class="flex-1">
              <label for="show-root-threads" class="block text-sm font-medium text-neutral-200 cursor-pointer">
                Show only root threads
              </label>
              <p class="mt-1 text-xs text-neutral-500">
                When enabled, only threads without parent threads will be shown in the main list. Child threads will still be accessible from their parent threads.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <input
              id="click-to-chat"
              v-model="clickToChat"
              type="checkbox"
              class="mt-1 w-4 h-4 bg-neutral-800 border border-neutral-700 rounded text-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 focus:ring-offset-neutral-900"
              @change="saveClickToChat"
            />
            <div class="flex-1">
              <label for="click-to-chat" class="block text-sm font-medium text-neutral-200 cursor-pointer">
                Click to open chat
              </label>
              <p class="mt-1 text-xs text-neutral-500">
                When enabled, clicking a thread row opens the chat view instead of the detail view.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <input
              id="recent-threads-limit"
              v-model.number="recentThreadsLimit"
              type="number"
              min="1"
              max="50"
              class="mt-1 w-16 px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-sm text-neutral-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              @input="debouncedSaveRecentThreadsLimit"
            />
            <div class="flex-1">
              <label for="recent-threads-limit" class="block text-sm font-medium text-neutral-200 cursor-pointer">
                Recent threads shown
              </label>
              <p class="mt-1 text-xs text-neutral-500">
                How many recent threads appear in the quick-pick list above the chat input. Scrolls past the visible area when the list is long.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <select
              id="recent-threads-sort"
              v-model="recentThreadsSortOrder"
              class="mt-1 w-36 px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-sm text-neutral-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              @change="saveRecentThreadsSortOrder"
            >
              <option value="created">Recently created</option>
              <option value="visited">Recently visited</option>
              <option value="message">Recent message</option>
            </select>
            <div class="flex-1">
              <label for="recent-threads-sort" class="block text-sm font-medium text-neutral-200 cursor-pointer">
                Recent threads sort order
              </label>
              <p class="mt-1 text-xs text-neutral-500">
                How to sort the recent threads list: by creation time, last visited, or most recent message.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <input
              id="recording-limit"
              v-model.number="recordingLimitMinutes"
              type="number"
              min="0.5"
              max="30"
              step="0.5"
              class="mt-1 w-16 px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-sm text-neutral-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              @input="debouncedSaveRecordingLimit"
            />
            <div class="flex-1">
              <label for="recording-limit" class="block text-sm font-medium text-neutral-200 cursor-pointer">
                Voice input limit (minutes)
              </label>
              <p class="mt-1 text-xs text-neutral-500">
                Maximum duration for a single voice input session. Recording auto-stops when the limit is reached.
              </p>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>

    <!-- Import Threads Section -->
    <div class="border-t border-neutral-800 pt-8">
      <CollapsibleSection label="Import Threads" :default-open="true" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Import threads from an export folder
        </p>

        <div class="space-y-4">
          <button
            @click="selectAndImportThreads"
            :disabled="isImporting"
            class="px-4 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-300 text-sm font-medium hover:bg-neutral-700 hover:border-neutral-600 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload class="w-4 h-4" />
            {{ isImporting ? 'Importing...' : 'Select Export Folder...' }}
          </button>

          <!-- Success message -->
          <div v-if="threads.data.threadsImport.status === 'success'" class="p-4 bg-emerald-900/20 border border-emerald-700/50 rounded-lg">
            <div class="flex items-start gap-3">
              <CheckCircle class="w-5 h-5 text-emerald-500 mt-0.5" />
              <div class="flex-1">
                <h4 class="text-sm font-medium text-emerald-400 mb-1">
                  Successfully imported {{ threads.data.threadsImport.importedCount }} thread{{ threads.data.threadsImport.importedCount !== 1 ? 's' : '' }}
                </h4>
                <ul v-if="threads.data.threadsImport.errors.length" class="text-sm text-neutral-400 list-disc list-inside">
                  <li v-for="(error, idx) in threads.data.threadsImport.errors" :key="idx">{{ error }}</li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Error message -->
          <div v-if="threads.data.threadsImport.status === 'error'" class="p-4 bg-red-900/20 border border-red-700/50 rounded-lg">
            <div class="flex items-start gap-3">
              <XCircle class="w-5 h-5 text-red-500 mt-0.5" />
              <div class="flex-1">
                <h4 class="text-sm font-medium text-red-400 mb-1">
                  Import failed
                </h4>
                <ul class="text-sm text-neutral-400 list-disc list-inside">
                  <li v-for="(error, idx) in threads.data.threadsImport.errors" :key="idx">{{ error }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>

    <!-- Export Threads Section -->
    <div class="border-t border-neutral-800 pt-8">
      <CollapsibleSection label="Export Threads" :default-open="false" class="mb-8">
        <p class="text-sm text-neutral-500 mb-4">
          Export all threads with messages and relations to a JSON file
        </p>

        <div class="space-y-4">
          <!-- Directory picker row -->
          <div class="flex items-center gap-2">
            <input
              type="text"
              :value="exportDirectory"
              readonly
              placeholder="Select output directory..."
              class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white text-sm focus:outline-none cursor-default placeholder-neutral-500"
            />
            <button
              @click="selectExportDirectory"
              class="px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-300 text-sm hover:bg-neutral-700 hover:border-neutral-600 hover:text-white transition-all flex items-center gap-1.5"
            >
              <FolderOpen class="w-4 h-4" />
              Browse
            </button>
          </div>

          <!-- Export button -->
          <button
            @click="exportThreadsToFile"
            :disabled="isExporting || !exportDirectory"
            class="px-4 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-300 text-sm font-medium hover:bg-neutral-700 hover:border-neutral-600 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download class="w-4 h-4" />
            {{ isExporting ? 'Exporting...' : 'Export' }}
          </button>

          <!-- Success message -->
          <div v-if="threads.data.threadsExport.status === 'success'" class="p-4 bg-emerald-900/20 border border-emerald-700/50 rounded-lg">
            <div class="flex items-start gap-3">
              <CheckCircle class="w-5 h-5 text-emerald-500 mt-0.5" />
              <div class="flex-1">
                <h4 class="text-sm font-medium text-emerald-400 mb-1">
                  Successfully exported {{ threads.data.threadsExport.threadCount }} thread{{ threads.data.threadsExport.threadCount !== 1 ? 's' : '' }}
                </h4>
                <p class="text-sm text-neutral-400">{{ threads.data.threadsExport.filePath }}</p>
              </div>
            </div>
          </div>

          <!-- Error message -->
          <div v-if="threads.data.threadsExport.status === 'error'" class="p-4 bg-red-900/20 border border-red-700/50 rounded-lg">
            <div class="flex items-start gap-3">
              <XCircle class="w-5 h-5 text-red-500 mt-0.5" />
              <div class="flex-1">
                <h4 class="text-sm font-medium text-red-400 mb-1">
                  Export failed
                </h4>
                <ul class="text-sm text-neutral-400 list-disc list-inside">
                  <li v-for="(error, idx) in threads.data.threadsExport.errors" :key="idx">{{ error }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>

    <!-- Save status will be managed by parent -->
  </div>
</template>

<script setup lang="ts">
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent } from 'reka-ui'
import { Plus, X, Upload, Download, FolderOpen, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-vue-next'
import { useSettingsDraft, useState, useSurface } from '@apackdev/sdk/fe'
import type { SettingUpdate, SettingsOf } from '#generated/settings-fe.ts'

import { ref, computed, nextTick, type Directive } from 'vue'

import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'
import KeyboardShortcutInput from '@apackdev/ui/components/KeyboardShortcutInput'
import ColorPicker, { DEFAULT_COLORS } from '@apackdev/ui/design/ColorPicker'

import { useDebounce } from '@apackdev/ui/composables/useDebounce'
import type { ThreadsState } from './state.ts'
import type { ThreadStatusOption, ThreadTagOption, AgentPhase } from '#generated/types.ts'

interface Props {
  settings?: SettingsOf<'threads'>
}

const props = withDefaults(defineProps<Props>(), {
  settings: undefined
})

const emit = defineEmits<{
  'update-setting': [SettingUpdate<'threads'>]
}>()

const statuses = useSettingsDraft(() => props.settings?.statuses ?? [])
const tags = useSettingsDraft(() => props.settings?.tags ?? [])
const chatStateConfigs = useSettingsDraft(() => props.settings?.chatStates ?? [])
const skipArchiveConfirm = useSettingsDraft(() => props.settings?.skipArchiveConfirm ?? false)
const showOnlyRootThreads = useSettingsDraft(() => props.settings?.showOnlyRootThreads ?? false)
const clickToChat = useSettingsDraft(() => props.settings?.clickToChat ?? true)
const recentThreadsLimit = useSettingsDraft(() => props.settings?.recentThreadsLimit ?? 7)
const recentThreadsSortOrder = useSettingsDraft(() => props.settings?.recentThreadsSortOrder ?? 'visited')
const recordingLimitMinutes = useSettingsDraft(() => props.settings?.recordingLimitMinutes ?? 3)

// ---- Chat (agent) settings ----
const skipRevertConfirm = useSettingsDraft(() => props.settings?.chat.skipRevertConfirm ?? false)
const quickPromptNumberKeyInserts = useSettingsDraft(() => props.settings?.chat.quickPromptNumberKeyInserts ?? true)
const modes = useSettingsDraft(() => props.settings?.chat.modes ?? [])
const selectedModeName = ref<string>(modes.value.find(m => !m.hidden)?.name || '')
const selectedMode = computed(() => modes.value.find(m => m.name === selectedModeName.value))
const quickPrompts = useSettingsDraft(() => props.settings?.chat.quickPrompts ?? [])
const hotkeys = useSettingsDraft(() => props.settings?.chat.hotkeys ?? {})
const defaultMode = useSettingsDraft(() => props.settings?.chat.defaultMode ?? '')
const defaultPhase = useSettingsDraft(() => props.settings?.chat.defaultPhase ?? '')
const modesValidationMessage = ref('')

const selectableDefaultModes = computed(() =>
  modes.value.filter(m => !m.hidden && !m.disabled)
)

const defaultModePhases = computed(() => {
  const mode = modes.value.find(m => m.name === defaultMode.value)
  return mode?.phases ?? []
})

// Save functions
const saveStatuses = () => {
  emit('update-setting', {
    path: ['statuses'],
    value: statuses.value
  })
}

const saveTags = () => {
  emit('update-setting', {
    path: ['tags'],
    value: tags.value
  })
}

const saveChatStates = () => {
  emit('update-setting', {
    path: ['chatStates'],
    value: chatStateConfigs.value
  })
}

const setChatStateBusy = (index: number) => {
  chatStateConfigs.value.forEach((cs, i) => { cs.busy = i === index })
  saveChatStates()
}

const saveDisplayOptions = () => {
  emit('update-setting', {
    path: ['showOnlyRootThreads'],
    value: showOnlyRootThreads.value
  })
}

const saveClickToChat = () => {
  emit('update-setting', {
    path: ['clickToChat'],
    value: clickToChat.value
  })
}

const saveRecentThreadsLimit = () => {
  const clamped = Math.min(50, Math.max(1, Math.floor(recentThreadsLimit.value || 7)))
  if (clamped !== recentThreadsLimit.value) {
    recentThreadsLimit.value = clamped
  }
  emit('update-setting', {
    path: ['recentThreadsLimit'],
    value: clamped
  })
}

const saveRecentThreadsSortOrder = () => {
  emit('update-setting', {
    path: ['recentThreadsSortOrder'],
    value: recentThreadsSortOrder.value
  })
}

const saveRecordingLimit = () => {
  const raw = Number(recordingLimitMinutes.value)
  const clamped = Math.min(30, Math.max(0.5, Number.isFinite(raw) && raw > 0 ? raw : 3))
  if (clamped !== recordingLimitMinutes.value) {
    recordingLimitMinutes.value = clamped
  }
  emit('update-setting', {
    path: ['recordingLimitMinutes'],
    value: clamped
  })
}

const saveSkipArchiveConfirm = () => {
  emit('update-setting', { path: ['skipArchiveConfirm'], value: skipArchiveConfirm.value })
}

// ---- Chat (agent) save helpers ----
const saveSkipRevertConfirm = () => {
  emit('update-setting', { path: ['chat', 'skipRevertConfirm'], value: skipRevertConfirm.value })
}

const saveQuickPromptNumberKeyInserts = () => {
  emit('update-setting', { path: ['chat', 'quickPromptNumberKeyInserts'], value: quickPromptNumberKeyInserts.value })
}

const duplicateName = (names: string[]) => {
  const seen = new Set<string>()
  return names.find(name => {
    if (seen.has(name)) return true
    seen.add(name)
    return false
  })
}

const validateModeNames = () => {
  const duplicateMode = duplicateName(modes.value.map(mode => mode.name.trim()).filter(Boolean))
  if (duplicateMode) return `Duplicate mode name: ${duplicateMode}`

  for (const mode of modes.value) {
    const duplicatePhase = duplicateName((mode.phases || []).map(phase => phase.name.trim()).filter(Boolean))
    if (duplicatePhase) return `Duplicate phase name in ${mode.name || 'unnamed mode'}: ${duplicatePhase}`
  }

  return ''
}

const saveModes = () => {
  modesValidationMessage.value = validateModeNames()
  if (modesValidationMessage.value) return

  emit('update-setting', { path: ['chat', 'modes'], value: modes.value })
}

const saveQuickPrompts = () => {
  emit('update-setting', { path: ['chat', 'quickPrompts'], value: quickPrompts.value })
}

const saveHotkey = (key: string) => {
  emit('update-setting', { path: ['chat', 'hotkeys', key], value: hotkeys.value[key] ?? null })
}

const saveDefaultMode = () => {
  emit('update-setting', { path: ['chat', 'defaultMode'], value: defaultMode.value })
}

const saveDefaultPhase = () => {
  emit('update-setting', { path: ['chat', 'defaultPhase'], value: defaultPhase.value })
}

const onDefaultModeChange = () => {
  // Clear phase if it doesn't belong to the newly-selected mode
  const phases = defaultModePhases.value
  if (defaultPhase.value && !phases.some(p => p.name === defaultPhase.value)) {
    defaultPhase.value = ''
    saveDefaultPhase()
  }
  saveDefaultMode()
}

// Use the debounce composable for text input
const { debounced: debouncedSave } = useDebounce(() => {
  saveStatuses()
}, 500)

const { debounced: debouncedSaveTags } = useDebounce(() => {
  saveTags()
}, 500)

const { debounced: debouncedSaveChatStates } = useDebounce(() => {
  saveChatStates()
}, 500)

const { debounced: debouncedSaveModes } = useDebounce(() => {
  saveModes()
}, 500)

const { debounced: debouncedSaveQuickPrompts } = useDebounce(() => {
  saveQuickPrompts()
}, 500)

const { debounced: debouncedSaveRecentThreadsLimit } = useDebounce(() => {
  saveRecentThreadsLimit()
}, 500)

const { debounced: debouncedSaveRecordingLimit } = useDebounce(() => {
  saveRecordingLimit()
}, 500)

// Mode management
const addMode = () => {
  modes.value.push({ id: `mode_${Date.now()}`, name: '', description: '' })
  saveModes()
}

const toggleMode = (index: number) => {
  modes.value[index].disabled = !modes.value[index].disabled
  debouncedSaveModes()
}

const removeMode = (index: number) => {
  if (modes.value.length <= 1) return
  const removed = modes.value[index]
  modes.value.splice(index, 1)
  if (removed.name === selectedModeName.value) {
    selectedModeName.value = modes.value.find(m => !m.hidden)?.name || ''
  }
  saveModes()
}

// Phase management
const addPhase = () => {
  if (!selectedMode.value) return
  const newPhase: AgentPhase = { id: `phase_${Date.now()}`, name: '', description: '' }
  if (!selectedMode.value.phases) selectedMode.value.phases = []
  selectedMode.value.phases.push(newPhase)
  saveModes()
}

const removePhase = (index: number) => {
  if (!selectedMode.value?.phases) return
  selectedMode.value.phases.splice(index, 1)
  saveModes()
}

// Quick-prompt management
const addQuickPrompt = () => {
  quickPrompts.value.push({ id: `qp_${Date.now()}`, text: '' })
  saveQuickPrompts()
}

const removeQuickPrompt = (index: number) => {
  quickPrompts.value.splice(index, 1)
  saveQuickPrompts()
}

// Auto-resize directive for quick-prompt textareas
const resizeTextarea = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
  const maxHeight = parseFloat(getComputedStyle(el).maxHeight)
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

const autoResize = (event: Event) => {
  resizeTextarea(event.target as HTMLTextAreaElement)
}

const vAutoResize: Directive<HTMLTextAreaElement> = {
  mounted(el) { nextTick(() => resizeTextarea(el)) },
}

// Status management
const addStatus = () => {
  const newStatus: ThreadStatusOption = {
    label: `New Status ${Date.now()}`,
    color: DEFAULT_COLORS[statuses.value.length % DEFAULT_COLORS.length]
  }
  statuses.value.push(newStatus)
  saveStatuses()
}

const removeStatus = (index: number) => {
  if (statuses.value.length > 1) {
    statuses.value.splice(index, 1)
    saveStatuses()
  }
}

// Tag management
const addTag = () => {
  const newTag: ThreadTagOption = {
    name: `New Tag ${Date.now()}`,
    color: DEFAULT_COLORS[tags.value.length % DEFAULT_COLORS.length]
  }
  tags.value.push(newTag)
  saveTags()
}

const removeTag = (index: number) => {
  if (tags.value.length > 1) {
    tags.value.splice(index, 1)
    saveTags()
  }
}

// Get threads actor for import/export state
const threadsActor: ThreadsState = useSurface()
const { state: threads, send } = useState(threadsActor)

// Import state
const isImporting = computed(() => threads.value.data.threadsImport.status === 'importing')

// Export state
const exportDirectory = ref<string>('')
const isExporting = computed(() => threads.value.data.threadsExport.status === 'exporting')

// Import - directory picker and send to state machine
const selectAndImportThreads = async () => {
  send({ type: 'THREADS.RESET_IMPORT_STATUS' })

  const directory = await window.electronAPI?.fileUtils.selectPath({
    type: 'directory'
  })

  if (!directory || Array.isArray(directory)) return

  send({
    type: 'THREADS.IMPORT',
    directory,
  })
}

// Export
const selectExportDirectory = async () => {
  const dir = await window.electronAPI?.fileUtils.selectPath({ type: 'directory' })
  if (dir && typeof dir === 'string') exportDirectory.value = dir
}

const exportThreadsToFile = () => {
  if (!exportDirectory.value) return
  send({ type: 'THREADS.RESET_EXPORT_STATUS' })
  send({ type: 'THREADS.EXPORT', directory: exportDirectory.value })
}
</script>
