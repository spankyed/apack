<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-6">
      <button
        class="text-neutral-400 hover:text-neutral-200 transition-colors p-1 -ml-1"
        @click="$emit('back')"
      >
        <ArrowLeft class="w-4 h-4" />
      </button>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="text-base font-medium text-neutral-200 truncate">{{ pack.name }}</h2>
          <span
            v-if="pack.updatesWith === 'app'"
            class="px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 bg-neutral-800 border border-neutral-700/50 rounded cursor-default"
            title="Updates with the app"
          >App-managed</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-neutral-500">{{ pack.id }}</span>
          <span class="text-neutral-700">&middot;</span>
          <span v-if="pack.version" class="text-xs text-neutral-600">v{{ pack.version }}</span>
          <template v-if="pack.availableVersion">
            <span class="text-neutral-700">&middot;</span>
            <span class="px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded">
              v{{ pack.availableVersion }} available
            </span>
          </template>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="space-y-5 overflow-y-auto flex-1">
      <p v-if="pack.updateCheckError" class="text-xs text-amber-400" data-testid="pack-update-check-error">
        Update check: {{ pack.updateCheckError }}
      </p>

      <p v-if="pack.appSourceProblem" class="text-xs text-amber-400" data-testid="pack-app-source-problem">
        App source: {{ pack.appSourceProblem }}
      </p>
      <p v-if="pack.loadProblem" class="text-xs text-red-400 break-words" data-testid="pack-load-problem">
        Failed to load: {{ pack.loadProblem }}
      </p>
      <ul v-if="pack.dependencyProblems.length" class="space-y-1 text-xs text-amber-400" aria-label="Pack dependencies">
        <li v-for="problem in pack.dependencyProblems" :key="problem">{{ problem }}</li>
      </ul>
      <p v-if="!pack.version" class="text-sm text-neutral-400">Pack metadata is unavailable.</p>

      <!-- Description -->
      <p v-if="pack.description" class="text-sm text-neutral-400">{{ pack.description }}</p>

      <!--
        Content decisions. One section per item the user has to decide about, and one list of the items they
        have already decided to keep — the two halves of what the applied content says is outstanding. The
        pane on the left is what they changed; the one on the right is the pack's version, which is taken
        whole, because an item is the unit of writing and a part only says where it moved.
      -->
      <section v-if="pack.contentOffers.length" class="space-y-3" data-testid="pack-content-offers">
        <SectionHeader label="Your changes to this pack's content" :count="pack.contentOffers.length" />
        <div
          v-for="offer in pack.contentOffers"
          :key="offer.key"
          class="px-4 py-3 bg-neutral-800/50 border border-neutral-700/50 rounded-lg space-y-3"
          data-testid="pack-content-offer"
        >
          <div>
            <p class="text-sm text-neutral-200">{{ offer.label }}</p>
            <p class="text-xs text-neutral-400 mt-0.5">
              {{ offer.kind === 'update'
                ? `You changed this, and ${pack.name}${pack.version ? ` v${pack.version}` : ''} ships a newer version.`
                : `You changed this, and ${pack.name} no longer ships it.` }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3 text-xs">
            <div class="min-w-0">
              <p class="text-neutral-500 mb-1">Yours</p>
              <ul class="space-y-0.5">
                <li v-for="part in offer.parts" :key="part" class="font-mono text-neutral-300 truncate" :title="part">{{ part }}</li>
                <li v-if="!offer.parts.length" class="text-neutral-500">changed</li>
              </ul>
            </div>
            <div class="min-w-0">
              <p class="text-neutral-500 mb-1">{{ offer.kind === 'update' ? `${pack.name}${pack.version ? ` v${pack.version}` : ''}` : 'The pack' }}</p>
              <p class="text-neutral-400">
                {{ offer.kind === 'update'
                  ? 'Replaces the whole item, your changes included.'
                  : 'Ships this item no longer.' }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button
              v-if="offer.kind === 'update'"
              class="px-2.5 py-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded hover:bg-emerald-500/20 transition-colors"
              data-testid="offer-take"
              @click="$emit('restoreContent', offer.key)"
            >Take the new version</button>
            <button
              class="px-2.5 py-1 text-xs font-medium text-neutral-300 bg-neutral-700/50 border border-neutral-600/50 rounded hover:bg-neutral-700 transition-colors"
              data-testid="offer-keep"
              @click="$emit('dismissOffer', offer.key)"
            >Keep mine</button>
            <button
              v-if="offer.kind === 'removed'"
              class="text-neutral-500 hover:text-red-400 transition-colors text-xs"
              data-testid="offer-delete"
              @click="$emit('deleteContent', offer.key)"
            >Delete it</button>
          </div>
        </div>
      </section>

      <section v-if="pack.contentKept.length" class="space-y-2" data-testid="pack-content-kept">
        <SectionHeader label="Items you keep your own version of" :count="pack.contentKept.length" />
        <div
          v-for="kept in pack.contentKept"
          :key="kept.key"
          class="flex items-center justify-between gap-3 px-4 py-2 bg-neutral-800/30 border border-neutral-700/40 rounded-lg"
          data-testid="pack-content-kept-item"
        >
          <span class="text-xs text-neutral-300 min-w-0 truncate" :title="kept.label">{{ kept.label }}</span>
          <button
            class="px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors flex-shrink-0"
            data-testid="kept-reset"
            @click="$emit('restoreContent', kept.key)"
          >Reset to factory</button>
        </div>
      </section>

      <!-- Status / Controls -->
      <section class="flex items-center justify-between px-4 py-3 bg-neutral-800/50 border border-neutral-700/50 rounded-lg">
        <span class="text-sm text-neutral-300">{{ pack.loadProblem ? 'Unavailable' : pack.enabled ? 'Enabled' : 'Disabled' }}</span>
        <div class="flex items-center gap-3 flex-shrink-0">
          <button
            class="relative w-9 h-5 rounded-full transition-colors"
            :class="pack.enabled ? 'bg-primary-600' : 'bg-neutral-600'"
            @click="$emit('toggle', pack.id)"
            :title="pack.enabled ? 'Disable' : 'Enable'"
          >
            <span
              class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform"
              :class="pack.enabled ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
          <button v-if="pack.appUpdate" :disabled="updating || busy" class="text-xs text-emerald-400 disabled:opacity-50"
            data-testid="pack-app-update" @click="$emit('appUpdate', pack.appUpdate.sourceRevision)">
            {{ updating ? 'Updating...' : `Update from app v${pack.appUpdate.version}` }}
          </button>
          <button
            v-if="pack.availableVersion"
            class="px-2.5 py-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            :disabled="updating"
            @click="$emit('update', pack.id)"
          >
            {{ updating ? 'Updating...' : 'Update' }}
          </button>
          <button
            class="text-neutral-500 hover:text-red-400 transition-colors text-xs"
            @click="$emit('uninstall', pack.id)"
          >
            Remove
          </button>
        </div>
      </section>

      <section class="space-y-3 px-4 py-3 bg-neutral-800/50 rounded-lg" data-testid="pack-replacement">
        <p class="text-xs text-neutral-400">{{ pack.updatesWith === 'app' ? 'Updates with the app.' : 'Updates are user-managed.' }}
          Replacing changes this pack's files and keeps your stored settings.</p>
        <div class="flex gap-2">
          <input v-model="replacement" placeholder="Local path, URL, or owner/repo" class="flex-1 min-w-0 px-2 py-1 bg-neutral-900 text-sm rounded" :disabled="busy" />
          <button :disabled="busy || !replacement.trim()" class="text-xs text-primary-400 disabled:opacity-50"
            data-testid="pack-replace" @click="$emit('replace', replacement.trim())">Replace</button>
        </div>
        <template v-if="appSource">
          <button v-if="!confirmingRestore" :disabled="busy" class="text-xs text-primary-400" data-testid="pack-restore"
            @click="confirmingRestore = appSource.sourceRevision">Restore app default v{{ appSource.version }}</button>
          <div v-else class="space-y-2" data-testid="pack-restore-confirmation">
            <p class="text-xs text-neutral-300">Replace your installed files with the selected app default and enable it? Stored settings are kept.</p>
            <button :disabled="busy" class="text-xs text-primary-400 mr-3" data-testid="pack-confirm-restore"
              @click="$emit('restore', confirmingRestore); confirmingRestore = null">Restore</button>
            <button class="text-xs text-neutral-400" @click="confirmingRestore = null">Cancel</button>
          </div>
        </template>
      </section>
      <section v-if="confirmingUninstall" class="space-y-2" data-testid="pack-remove-confirmation">
        <p class="text-sm text-neutral-300">Remove {{ pack.name }}? Pack files will be deleted; stored settings are kept.</p>
        <button class="text-xs text-red-400 mr-3" @click="$emit('confirmUninstall', pack.id)">Remove</button>
        <button class="text-xs text-neutral-400" @click="$emit('cancelUninstall')">Cancel</button>
      </section>

      <!-- Summary stats -->
      <section class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span v-if="pack.features.length">{{ pack.features.length }} features</span>
        <span v-if="entityEntries.length">{{ entityEntries.length }} entities</span>
        <span v-if="relKindEntries.length">{{ relKindEntries.length }} relations</span>
        <span v-if="roleEntries.length">{{ roleEntries.length }} roles</span>
        <span v-if="pack.steps.length">{{ pack.steps.length }} steps</span>
        <span v-if="pack.artifacts.length">{{ pack.artifacts.length }} artifacts</span>
        <span v-if="pack.blocks.length">{{ pack.blocks.length }} blocks</span>
        <span v-if="pack.migrationCount">{{ pack.migrationCount }} migrations</span>
        <span v-if="packServiceNames.length">{{ packServiceNames.length }} pack services</span>
      </section>

      <!-- Extra metadata for external packs -->
      <section v-if="pack.hostVersion || pack.installedAt || pack.dir" class="space-y-1 text-xs">
        <div v-if="pack.hostVersion" class="flex gap-2">
          <span class="text-neutral-500">Requires host</span>
          <span class="text-neutral-400">{{ pack.hostVersion }}</span>
        </div>
        <div v-if="pack.installedAt" class="flex gap-2">
          <span class="text-neutral-500">Installed</span>
          <span class="text-neutral-400">{{ formatDate(pack.installedAt) }}</span>
        </div>
        <div v-if="pack.dir" class="flex gap-2 min-w-0">
          <span class="text-neutral-500 flex-shrink-0">Directory</span>
          <span class="text-neutral-400 truncate" :title="pack.dir">{{ pack.dir }}</span>
        </div>
      </section>

      <!-- Features -->
      <section v-if="pack.features.length > 0">
        <SectionHeader label="Features" :count="pack.features.length" />
        <div class="space-y-2">
          <div
            v-for="feature in pack.features"
            :key="feature.id"
            class="px-3 py-2 bg-neutral-800/40 border border-neutral-700/30 rounded-lg"
          >
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm text-neutral-200 font-medium">{{ feature.surface?.label ?? feature.id }}</span>
              <span
                v-if="feature.designation"
                class="px-1 py-0.5 text-[9px] font-medium text-neutral-500 bg-neutral-800 border border-neutral-700/50 rounded"
              >{{ feature.designation }}</span>
            </div>
            <p class="text-xs text-neutral-400 mb-1">{{ feature.description }}</p>
            <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
              <span v-if="feature.hasSystem">system</span>
              <span v-if="feature.surface">surface</span>
              <span v-if="feature.references && Object.keys(feature.references.types).length">references: {{ Object.keys(feature.references.types).join(', ') }}</span>
              <span v-if="feature.services.length">services: {{ feature.services.join(', ') }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Fallback: flat lists when no features (external packs without features manifest) -->
      <template v-if="!pack.features.length">
        <!-- Systems -->
        <section v-if="pack.systems.length > 0">
          <SectionHeader label="Systems" :count="pack.systems.length" />
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="sys in pack.systems"
              :key="sys"
              class="chip"
            >{{ sys }}</span>
          </div>
        </section>

        <!-- Services -->
        <section v-if="pack.services.length > 0">
          <SectionHeader label="Services" :count="pack.services.length" />
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="svc in pack.services"
              :key="svc"
              class="chip"
            >{{ svc }}</span>
          </div>
        </section>
      </template>

      <!-- Pack-level services (not owned by any feature) -->
      <section v-if="packServiceNames.length > 0">
        <SectionHeader label="Pack Services" :count="packServiceNames.length" />
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="svc in packServiceNames"
            :key="svc"
            class="chip"
          >{{ svc }}</span>
        </div>
      </section>

      <!-- Boot Hooks -->
      <section v-if="pack.lifecycleHooks.length > 0">
        <SectionHeader label="Boot Hooks" :count="pack.lifecycleHooks.length" />
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="hook in pack.lifecycleHooks"
            :key="hook"
            class="chip"
          >{{ hook }}</span>
        </div>
      </section>

      <!-- Entities -->
      <section v-if="entityEntries.length > 0">
        <SectionHeader label="Entities" :count="entityEntries.length" />
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="[key] in entityEntries"
            :key="key"
            class="chip"
          >{{ key }}</span>
        </div>
      </section>

      <!-- Relation Kinds -->
      <section v-if="relKindEntries.length > 0">
        <SectionHeader label="Relation Kinds" :count="relKindEntries.length" />
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="[, value] in relKindEntries"
            :key="value"
            class="chip"
          >{{ value }}</span>
        </div>
      </section>

      <!-- Roles -->
      <section v-if="roleEntries.length > 0">
        <SectionHeader label="Roles" :count="roleEntries.length" />
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="[, value] in roleEntries"
            :key="value"
            class="chip"
          >{{ value }}</span>
        </div>
      </section>

      <!-- Steps -->
      <section v-if="pack.steps.length > 0">
        <SectionHeader label="Steps" :count="pack.steps.length" />
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="step in pack.steps"
            :key="step"
            class="chip"
          >{{ step }}</span>
        </div>
      </section>

      <!-- Artifacts -->
      <section v-if="pack.artifacts.length > 0">
        <SectionHeader label="Artifacts" :count="pack.artifacts.length" />
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="art in pack.artifacts"
            :key="art"
            class="chip"
          >{{ art }}</span>
        </div>
      </section>

      <!-- Blocks -->
      <section v-if="pack.blocks.length > 0">
        <SectionHeader label="Blocks" :count="pack.blocks.length" />
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="block in pack.blocks"
            :key="block"
            class="chip"
          >{{ block }}</span>
        </div>
      </section>

      <!-- Permissions -->
      <section v-if="pack.permissions.length > 0">
        <SectionHeader label="Permissions" :count="pack.permissions.length" />
        <div class="space-y-1">
          <div
            v-for="perm in pack.permissions"
            :key="perm"
            class="flex items-center gap-2 px-3 py-1.5 bg-amber-500/5 border border-amber-500/20 rounded text-sm"
          >
            <Shield class="w-3 h-3 text-amber-500/60 flex-shrink-0" />
            <span class="text-neutral-300">{{ perm }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowLeft, Shield } from 'lucide-vue-next';
import type { AppPackSourceSummary, InstalledPackSummary } from '@apackdev/host/fe';
import SectionHeader from './SectionHeader.vue';

const props = defineProps<{ pack: InstalledPackSummary; appSource?: AppPackSourceSummary; updating?: boolean; busy?: boolean; confirmingUninstall?: boolean }>();
const replacement = ref('');
const confirmingRestore = ref<string | null>(null);
watch(() => props.pack.id, () => { replacement.value = ''; confirmingRestore.value = null; });

defineEmits<{
  back: [];
  replace: [source: string];
  restore: [sourceRevision: string];
  confirmUninstall: [packId: string];
  cancelUninstall: [];
  toggle: [packId: string];
  uninstall: [packId: string];
  update: [packId: string];
  appUpdate: [sourceRevision: string];
  /** One content item, by content key: write the pack's version over whatever is there */
  restoreContent: [key: string];
  /** Keep the user's version of this item, against the version they were shown */
  dismissOffer: [key: string];
  /** Delete an item the pack no longer ships */
  deleteContent: [key: string];
}>();

const entityEntries = computed(() => Object.entries(props.pack.entities));
const relKindEntries = computed(() => Object.entries(props.pack.relKinds));
const roleEntries = computed(() => Object.entries(props.pack.roles));

const featureServiceNames = computed(() => {
  const names = new Set<string>();
  for (const f of props.pack.features) {
    for (const s of f.services) names.add(s);
  }
  return names;
});

const packServiceNames = computed(() =>
  props.pack.services.filter(s => !featureServiceNames.value.has(s))
);

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}
</script>

<style scoped>
.chip {
  @apply px-2 py-1 text-xs text-neutral-300 bg-neutral-800/50 border border-neutral-700/40 rounded font-mono;
}
</style>
