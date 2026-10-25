<template>
  <div class="h-full flex flex-col bg-[#1a1a1a] relative overflow-hidden">
    <ToastNotification ref="toast" />
    <!-- Unified Header with Tabs and Action Button -->
    <div class="border-b border-neutral-800 bg-[#0d0d0d]/50">
      <div class="px-6 py-4">
        <div class="flex items-center justify-between">
          <!-- Left: Back Button -->
          <button
            @click="handleBack"
            class="group flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/50 transition-all duration-200"
          >
            <ArrowLeft class="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            <span>Back to Database</span>
          </button>

          <!-- Tabs -->
          <div class="flex items-center bg-neutral-800/50 rounded-lg p-1">
            <button
              :class="[
                'px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 flex items-center gap-2',
                activeTab === 'export'
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              ]"
              @click="activeTab = 'export'"
            >
              <HardDriveDownload class="w-4 h-4" />
              <span>Export</span>
            </button>
            <button
              :class="[
                'px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 flex items-center gap-2',
                activeTab === 'import'
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              ]"
              @click="activeTab = 'import'"
            >
              <HardDriveUpload class="w-4 h-4" />
              <span>Import</span>
            </button>
          </div>

          <!-- Right: Unified Action Button -->
          <button
            @click="handleUnifiedAction"
            :disabled="!canPerformAction || isProcessing"
            :class="[
              'relative px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 disabled:cursor-not-allowed',
              activeTab === 'export'
                ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-800 disabled:text-neutral-500 text-white'
                : 'bg-red-600 hover:bg-red-700 disabled:bg-neutral-800 disabled:text-neutral-500 text-white'
            ]"
          >
            <template v-if="isProcessing">
              <Loader2 class="w-4 h-4 animate-spin" />
              <span>{{ activeTab === 'export' ? 'Exporting...' : 'Importing...' }}</span>
            </template>
            <template v-else>
              <Download v-if="activeTab === 'export'" class="w-4 h-4" />
              <Upload v-else class="w-4 h-4" />
              <span>{{ activeTab === 'export' ? 'Export Backup' : 'Import Backup' }}</span>
            </template>
          </button>
        </div>
      </div>
    </div>

    <!-- Content Area -->
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-4xl mx-auto p-4">

        <!-- Export Tab Content -->
        <div v-if="activeTab === 'export'" class="space-y-6">

          <!-- Backup Location Section -->
          <div class="bg-neutral-900/50 rounded-xl border border-neutral-800 p-6">
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-medium text-neutral-400 mb-2">Backup Location</label>
                <div class="flex gap-2">
                  <div class="relative flex-1">
                    <Folder class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                    <input
                      v-model="exportPath"
                      type="text"
                      placeholder="/Users/spankyed/Documents/apack Backups"
                      class="w-full pl-10 pr-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
                    />
                  </div>
                  <button
                    @click="selectExportDirectory"
                    class="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg text-sm text-white transition-all duration-200 flex items-center gap-2"
                  >
                    <FolderOpen class="w-4 h-4" />
                    Browse
                  </button>
                </div>
              </div>

              <div>
                <label class="block text-xs font-medium text-neutral-400 mb-2">Backup Name <span class="text-neutral-600">(Optional)</span></label>
                <div class="relative">
                  <FileText class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                  <input
                    v-model="backupName"
                    type="text"
                    :placeholder="`backup-${new Date().toISOString().split('T')[0]}`"
                    class="w-full pl-10 pr-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Database Selection Section -->
          <div class="bg-neutral-900/50 rounded-xl border border-neutral-800 p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-medium text-white">Databases</h3>
              <div class="text-xs text-neutral-400 bg-neutral-800/50 px-3 py-1 rounded-full">
                {{ Object.values(selectedDatabases).filter(v => v).length }} selected
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <!-- Main Database Card -->
              <label class="relative cursor-pointer group">
                <input
                  type="checkbox"
                  v-model="selectedDatabases.lmdb"
                  class="peer sr-only"
                />
                <div class="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg transition-all duration-200 peer-checked:border-blue-500/50 peer-checked:bg-blue-500/5 hover:bg-neutral-800/70">
                  <div class="flex items-start gap-3">
                    <div class="relative mt-0.5">
                      <div class="w-5 h-5 rounded border-2 border-neutral-600 bg-neutral-900 transition-all peer-checked:border-blue-500 peer-checked:bg-blue-500"></div>
                      <Check v-if="selectedDatabases.lmdb" class="absolute inset-0 w-5 h-5 text-white p-0.5" />
                    </div>
                    <div class="flex-1">
                      <div class="flex items-center gap-2">
                        <Database class="w-4 h-4 text-blue-400" />
                        <span class="text-sm font-medium text-white">Main Database</span>
                      </div>
                      <p class="text-xs text-neutral-500 mt-1">Core application data (ears-db)</p>
                    </div>
                  </div>
                </div>
              </label>

              <!-- [SEARCH_INDEX_FF] Search Indices checkbox — commented out
              <label class="relative cursor-pointer group">
                <input
                  type="checkbox"
                  v-model="selectedDatabases.searchIndices"
                  class="peer sr-only"
                />
                <div class="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg transition-all duration-200 peer-checked:border-blue-500/50 peer-checked:bg-blue-500/5 hover:bg-neutral-800/70">
                  <div class="flex items-start gap-3">
                    <div class="relative mt-0.5">
                      <div class="w-5 h-5 rounded border-2 border-neutral-600 bg-neutral-900 transition-all peer-checked:border-blue-500 peer-checked:bg-blue-500"></div>
                      <Check v-if="selectedDatabases.searchIndices" class="absolute inset-0 w-5 h-5 text-white p-0.5" />
                    </div>
                    <div class="flex-1">
                      <div class="flex items-center gap-2">
                        <Search class="w-4 h-4 text-purple-400" />
                        <span class="text-sm font-medium text-white">Search Indices</span>
                      </div>
                      <p class="text-xs text-neutral-500 mt-1">Vector embeddings data</p>
                    </div>
                  </div>
                </div>
              </label>
              -->

              <!-- Run History Card -->
              <label class="relative cursor-pointer group">
                <input
                  type="checkbox"
                  v-model="selectedDatabases.runHistory"
                  class="peer sr-only"
                />
                <div class="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg transition-all duration-200 peer-checked:border-blue-500/50 peer-checked:bg-blue-500/5 hover:bg-neutral-800/70">
                  <div class="flex items-start gap-3">
                    <div class="relative mt-0.5">
                      <div class="w-5 h-5 rounded border-2 border-neutral-600 bg-neutral-900 transition-all peer-checked:border-blue-500 peer-checked:bg-blue-500"></div>
                      <Check v-if="selectedDatabases.runHistory" class="absolute inset-0 w-5 h-5 text-white p-0.5" />
                    </div>
                    <div class="flex-1">
                      <div class="flex items-center gap-2">
                        <Activity class="w-4 h-4 text-green-400" />
                        <span class="text-sm font-medium text-white">Run History</span>
                      </div>
                      <p class="text-xs text-neutral-500 mt-1">Every flow run's record (run-history)</p>
                    </div>
                  </div>
                </div>
              </label>

            </div>
          </div>

        </div>

        <!-- Import Tab Content -->
        <div v-if="activeTab === 'import'" class="space-y-6">

          <!-- Import Location Section -->
          <div class="bg-neutral-900/50 rounded-xl border border-neutral-800 p-6">
            <div class="flex gap-2">
              <div class="relative flex-1">
                <FolderOpen class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  v-model="importPath"
                  type="text"
                  placeholder="Backup directory to restore from"
                  class="w-full pl-10 pr-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
                />
              </div>
              <button
                @click="selectImportDirectory"
                class="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg text-sm text-white transition-all duration-200 flex items-center gap-2"
              >
                <FolderOpen class="w-4 h-4" />
                Browse
              </button>
            </div>
          </div>

          <!-- Backup Info Section -->
          <Transition name="slide-fade">
            <div v-if="backupInfo" class="bg-neutral-900/50 rounded-xl border border-neutral-800 p-6">
              <div :class="['grid gap-4', backupInfo.hasMedia ? 'grid-cols-4' : 'grid-cols-3']">
                <div class="bg-neutral-800/50 rounded-lg p-3">
                  <div class="flex items-center gap-2 mb-1">
                    <Calendar class="w-4 h-4 text-neutral-400" />
                    <span class="text-xs text-neutral-400">Created</span>
                  </div>
                  <p class="text-sm text-white">{{ formatDate(backupInfo.timestamp) }}</p>
                </div>

                <div class="bg-neutral-800/50 rounded-lg p-3">
                  <div class="flex items-center gap-2 mb-1">
                    <Database class="w-4 h-4 text-neutral-400" />
                    <span class="text-xs text-neutral-400">Databases</span>
                  </div>
                  <p class="text-sm text-white">{{ backupInfo.databases.length }} included</p>
                </div>

                <div class="bg-neutral-800/50 rounded-lg p-3">
                  <div class="flex items-center gap-2 mb-1">
                    <HardDrive class="w-4 h-4 text-neutral-400" />
                    <span class="text-xs text-neutral-400">Size</span>
                  </div>
                  <p class="text-sm text-white">{{ formatSize(backupInfo.size) }}</p>
                </div>

                <div v-if="backupInfo.hasMedia" class="bg-neutral-800/50 rounded-lg p-3">
                  <div class="flex items-center gap-2 mb-1">
                    <ImageIcon class="w-4 h-4 text-neutral-400" />
                    <span class="text-xs text-neutral-400">Media</span>
                  </div>
                  <p class="text-sm text-white">Included</p>
                </div>
              </div>
            </div>
          </Transition>

          <!-- Warning Section -->
          <div class="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
            <div class="flex items-center gap-3">
              <AlertTriangle class="w-5 h-5 text-amber-500 flex-shrink-0" />
              <p class="text-sm text-amber-400">
                Importing will replace all existing data. This action cannot be undone.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSurface, useSurfaceStorage } from '@apackdev/sdk/fe'

import { ref, computed, watch, onMounted } from 'vue';
import { useSelector } from '@xstate/vue';
import {
  ArrowLeft,
  HardDriveDownload,
  HardDriveUpload,
  Folder,
  FolderOpen,
  FileText,
  Download,
  Upload,
  Loader2,
  AlertTriangle,
  Database,
  // Search, // [SEARCH_INDEX_FF]
  Activity,
  Check,
  Calendar,
  HardDrive,
  Image as ImageIcon
} from 'lucide-vue-next';
import type { DatabaseState } from '../state.ts';
import ToastNotification from '@apackdev/ui/design/ToastNotification';

const actor: DatabaseState = useSurface();
/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = useSurfaceStorage();

// Get backup info from state
const storedBackupInfo = useSelector(actor, (state) => state.context.backupInfo);
const isExporting = useSelector(actor, (state) => state.context.exporting);
const isImporting = useSelector(actor, (state) => state.context.importing);
const backupResult = useSelector(actor, (state) => state.context.backupResult);

// Tab state
const activeTab = ref<'export' | 'import'>('export');

// Export state
const exportPath = ref('');
const backupName = ref('');
const selectedDatabases = ref({
  lmdb: true,
  // searchIndices: true, // [SEARCH_INDEX_FF]
  runHistory: false,
});
const toast = ref<InstanceType<typeof ToastNotification>>();

// Import state
const importPath = ref('');
const backupInfo = ref<any>(null);

// Computed
const canExport = computed(() => {
  return exportPath.value && Object.values(selectedDatabases.value).some(v => v);
});

const canImport = computed(() => {
  return importPath.value && backupInfo.value;
});

const canPerformAction = computed(() => {
  return activeTab.value === 'export' ? canExport.value : canImport.value;
});

const isProcessing = computed(() => {
  return activeTab.value === 'export' ? isExporting.value : isImporting.value;
});

// Navigation
function handleBack() {
  actor.send({ type: 'BACK_TO_EXPLORER' });
}

// Unified action handler
function handleUnifiedAction() {
  if (activeTab.value === 'export') {
    handleExport();
  } else {
    handleImport();
  }
}

// Watch for backup info updates
watch(storedBackupInfo, (newInfo) => {
  if (newInfo) {
    backupInfo.value = newInfo;
  }
});

// The host publishes restored state to live consumers; presentation reports the operation's result.
watch(backupResult, (result) => {
  if (!result) return;
  const operation = result.operation === 'export' ? 'Export' : 'Import';
  if (result.unknownDatabases?.length) {
    askAboutUnknownDatabases(result.unknownDatabases);
  } else if (result.error) {
    toast.value?.error(`${operation} failed`, result.error);
  } else if (result.operation === 'export') {
    toast.value?.success('Backup exported successfully!');
  } else {
    toast.value?.success('Backup imported successfully!', result.message);
  }
});

// Load saved paths from this surface's storage on mount
onMounted(() => {
  const savedExportPath = storage.get('backup-export-path');
  const savedImportPath = storage.get('backup-import-path');

  if (savedExportPath) {
    exportPath.value = savedExportPath;
  }
  if (savedImportPath) {
    importPath.value = savedImportPath;
  }
});

// Export functions
async function selectExportDirectory() {
  const directoryPath = await window.electronAPI?.fileUtils.selectDirectory();
  if (directoryPath) {
    exportPath.value = directoryPath;
    // Save to this surface's storage for future use
    storage.set('backup-export-path', directoryPath);
  }
}

function handleExport() {
  if (!canExport.value) return;

  const databases = Object.entries(selectedDatabases.value)
    .filter(([_, selected]) => selected)
    .map(([key]) => key) as Array<'lmdb' | 'runHistory'>; // 'searchIndices' removed [SEARCH_INDEX_FF]

  actor.send({
    type: 'BACKUP.EXPORT',
    path: exportPath.value,
    name: backupName.value || undefined,
    databases,
  });
}

// Import functions
async function selectImportDirectory() {
  const directoryPath = await window.electronAPI?.fileUtils.selectDirectory();
  if (directoryPath) {
    importPath.value = directoryPath;
    // Save to this surface's storage for future use
    storage.set('backup-import-path', directoryPath);
    // Get backup info for the selected directory
    actor.send({ type: 'BACKUP.READ_INFO', path: directoryPath });
  }
}

function handleImport(skipUnknownDatabases = false) {
  if (!canImport.value) return;

  const confirmed = confirm('Are you sure you want to import this backup? This will stop the assistant\'s brain and replace all of your current data with the imported data.');
  if (!confirmed) return;

  actor.send({ type: 'BACKUP.IMPORT', path: importPath.value, skipUnknownDatabases });
}

/** A backup from a newer apack: the user says whether to import it without what this one can't hold */
function askAboutUnknownDatabases(stores: string[]): void {
  const importAnyway = confirm(
    `This backup was made by a newer apack and also holds ${stores.join(', ')}, which this version doesn't have.\n\n` +
    'Nothing has been changed yet. Import it without those, replacing your current data with the rest?',
  );
  if (importAnyway) actor.send({ type: 'BACKUP.IMPORT', path: importPath.value, skipUnknownDatabases: true });
}

// Utility functions
function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}
</script>

<style scoped>
/* Transitions */
.slide-fade-enter-active {
  transition: all 0.3s ease;
}

.slide-fade-leave-active {
  transition: all 0.2s ease;
}

.slide-fade-enter-from {
  transform: translateY(-10px);
  opacity: 0;
}

.slide-fade-leave-to {
  transform: translateY(10px);
  opacity: 0;
}

/* Custom checkbox styling */
input[type="checkbox"]:checked ~ div .w-5.h-5.bg-neutral-900 {
  background-color: rgb(59 130 246);
  border-color: rgb(59 130 246);
}

/* Smooth loading animation */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
