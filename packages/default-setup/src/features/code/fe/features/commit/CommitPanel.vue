<template>
  <div class="flex flex-col h-full overflow-hidden min-w-0">
    <!-- Header -->
    <CodePanelHeader
      :icon="GitCommit"
      title="Source Control"
    >
      <template #actions>
        <button
          @click="refreshStatus()"
          :disabled="isGitLoading"
          class="p-0 transition-colors rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
          title="Refresh"
        >
          <RefreshCw :size="16" :class="{ 'animate-spin': isGitLoading }" />
        </button>
      </template>
    </CodePanelHeader>

    <!-- Revert Dialog -->
    <RevertDialog
      :show="!!recovery?.data.revertDialogFile"
      :file="recovery?.data.revertDialogFile ?? null"
      undoable
      :notKept="recovery?.data.revertDialogFile ? notKeptOf([recovery.data.revertDialogFile.path]) : []"
      @confirm="confirmRevert"
      @cancel="cancelRevert"
    />

    <!-- Discard All Dialog -->
    <RevertDialog
      :show="showDiscardAllDialog"
      :file="null"
      :fileCount="unstagedFiles.length"
      undoable
      :notKept="notKeptOf(byName(unstagedFiles))"
      @confirm="confirmDiscardAll"
      @cancel="cancelDiscardAll"
    />

    <!-- Discard All Merge Conflicts Dialog -->
    <RevertDialog
      :show="showDiscardAllMergeDialog"
      :file="null"
      :fileCount="mergeConflictFiles.length"
      customTitle="Accept All Ours (HEAD)"
      customMessage="Accept HEAD version for all conflicted files? This discards all incoming changes from the merge/stash."
      @confirm="confirmDiscardAllMerge"
      @cancel="showDiscardAllMergeDialog = false"
    />

    <!-- Give up what git is in the middle of -->
    <RevertDialog
      :show="showAbortOperationDialog"
      :file="null"
      :customTitle="`Abort the ${openCommit?.data.operation?.kind ?? 'operation'}`"
      :customMessage="`Give up the ${openCommit?.data.operation?.kind ?? 'operation'} in progress? The repository goes back to where it was before it began, and what was settled in it so far is lost.`"
      @confirm="confirmAbortOperation"
      @cancel="showAbortOperationDialog = false"
    />

    <!-- Show friendly empty state if no git repository -->
    <EmptyState
      v-if="isNoGitRepoError"
      :icon="GitBranch"
      title="No Git Repository"
      subtitle="Open a folder with a git repository to use source control features"
    />

    <!-- Show error if no directory selected -->
    <NoDirectoryState v-else-if="!baseDirectory" />

    <!-- Show normal UI only when directory is selected and has git -->
    <template v-else>
      <!-- Branch Info -->
      <div class="px-4 py-2 border-b border-neutral-800 bg-neutral-800/50">
      <!-- Create Branch Mode -->
      <div v-if="isCreatingBranch || renamingBranch" class="flex items-center gap-1.5">
        <input
          ref="newBranchInput"
          v-model="newBranchName"
          data-testid="branch-name-input"
          @keyup.enter="confirmCreateBranch"
          @keyup.escape="cancelCreateBranch"
          :placeholder="renamingBranch ? `Rename ${renamingBranch} to...` : 'New branch name...'"
          class="flex-1 min-w-0 px-3 py-1.5 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
        />
        <button
          @click="confirmCreateBranch"
          :disabled="!newBranchName.trim()"
          class="p-1.5 rounded transition-colors text-green-400 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
          :title="renamingBranch ? 'Rename branch' : 'Create branch'"
        >
          <Check :size="14" />
        </button>
        <button
          @click="cancelCreateBranch"
          class="p-1.5 rounded transition-colors text-neutral-400 hover:bg-neutral-700"
          title="Cancel"
        >
          <X :size="14" />
        </button>
      </div>

      <!-- Branch Select Mode -->
      <div v-else class="relative flex items-center gap-1.5">
        <div class="relative flex-1 min-w-0">
          <GitBranch
            :size="12"
            class="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
          />
          <input
            :value="remotes?.data.branchInput ?? ''"
            @input="updateBranchInput"
            @keydown.enter.prevent="handleBranchEnter"
            @keydown.arrow-down.prevent="handleBranchArrowDown"
            @keydown.arrow-up.prevent="handleBranchArrowUp"
            @keydown.escape="handleBranchEscape"
            @focus="showBranchDropdown = true; highlightedBranchIndex = -1"
            @blur="hideBranchDropdown"
            :disabled="isCheckingOutBranch"
            :placeholder="openCommit?.data.gitBranch || 'Select branch...'"
            class="w-full pl-7 pr-8 py-1.5 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-600 disabled:opacity-50"
          />
          <ChevronDown
            :size="14"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
          />
        </div>
        <button
          @click="startCreateBranch"
          class="p-1 rounded transition-colors text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700"
          title="Create new branch"
        >
          <GitBranchPlus :size="14" />
        </button>
        <button
          @click="(openCommit?.data.commitsAhead ?? 0) > 0 ? send({ type: 'commit.PUSH_BRANCH' }) : send({ type: 'commit.PULL_BRANCH' })"
          :disabled="isPulling || isPushing || !openCommit?.data.hasUpstream"
          class="relative p-1 rounded transition-colors text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
          :title="syncTitle"
        >
          <Loader2 v-if="isPulling || isPushing" :size="14" class="animate-spin" />
          <ArrowUpFromLine v-else-if="(openCommit?.data.commitsAhead ?? 0) > 0" :size="14" />
          <ArrowDownToLine v-else :size="14" />
          <span
            v-if="(openCommit?.data.commitsAhead ?? 0) > 0"
            class="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold leading-none text-white bg-green-600 rounded-full"
          >{{ openCommit?.data.commitsAhead }}</span>
          <span
            v-else-if="(openCommit?.data.commitsBehind ?? 0) > 0"
            class="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold leading-none text-white bg-blue-600 rounded-full"
          >{{ openCommit?.data.commitsBehind }}</span>
        </button>

        <!-- Sync feedback popover -->
        <Transition name="sync-feedback">
          <div
            v-if="syncFeedback"
            class="absolute top-full mt-1 right-0 px-2 py-1 text-[11px] font-medium rounded shadow-lg whitespace-nowrap pointer-events-none z-20"
            :class="syncFeedback.includes('Already') || syncFeedback.includes('Nothing') || syncFeedback.includes('stopped')
              ? 'text-neutral-300 bg-neutral-800 border border-neutral-700'
              : 'text-green-300 bg-green-900/90 border border-green-800/60'"
          >
            {{ syncFeedback }}
          </div>
        </Transition>

        <!-- Dropdown -->
        <div
          v-if="showBranchDropdown && filteredBranches.length > 0"
          class="absolute left-0 right-8 z-10 mt-1 top-full bg-neutral-900 border border-neutral-700 rounded shadow-lg max-h-48 overflow-y-auto"
        >
          <div
            v-for="(branch, index) in filteredBranches"
            :key="branch"
            @mousedown.prevent="selectBranch(branch)"
            @mouseenter="highlightedBranchIndex = Number(index)"
            :class="[
              'group px-3 py-2 cursor-pointer flex items-center gap-2',
              index === highlightedBranchIndex ? 'bg-neutral-800' : 'hover:bg-neutral-800'
            ]"
          >
            <GitBranch :size="12" class="text-neutral-400" />
            <span class="text-xs text-neutral-300">{{ branch }}</span>
            <span v-if="remotes?.data.branchStanding[branch]?.upstreamGone" class="text-[10px] text-amber-400" title="What it followed is gone from the remote">gone</span>
            <span v-else-if="remotes?.data.branchStanding[branch] && (remotes.data.branchStanding[branch].ahead || remotes.data.branchStanding[branch].behind)" class="text-[10px] tabular-nums text-neutral-500" :title="`Against ${remotes.data.branchStanding[branch].upstream}`">
              <span v-if="remotes.data.branchStanding[branch].ahead">↑{{ remotes.data.branchStanding[branch].ahead }}</span>
              <span v-if="remotes.data.branchStanding[branch].behind">↓{{ remotes.data.branchStanding[branch].behind }}</span>
            </span>
            <span v-if="branch === openCommit?.data.gitBranch" class="ml-auto flex items-center gap-1">
              <button
                data-testid="rename-branch"
                @mousedown.stop.prevent="startRenameBranch(branch)"
                :title="`Rename ${branch}`"
                class="p-0.5 hover:bg-neutral-700 rounded opacity-0 group-hover:opacity-100"
              ><Pencil :size="12" class="text-neutral-400" /></button>
              <CheckCircle :size="12" class="text-green-500" />
            </span>
            <span v-else class="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100">
              <button
                v-if="remotes?.data.branchStanding[branch]"
                data-testid="rename-branch"
                @mousedown.stop.prevent="startRenameBranch(branch)"
                :title="`Rename ${branch}`"
                class="p-0.5 hover:bg-neutral-700 rounded"
              ><Pencil :size="12" class="text-neutral-400" /></button>
              <button
                data-testid="merge-branch"
                @mousedown.stop.prevent="startOperation('merge', branch)"
                @mouseenter="send({ type: 'commit.PREVIEW_MERGE', target: branch })"
                :disabled="isStartingOperation || !!openCommit?.data.operation"
                :title="mergeTitle(branch)"
                class="p-0.5 hover:bg-neutral-700 rounded disabled:opacity-40"
              ><GitMerge :size="12" class="text-neutral-400" /></button>
              <button
                data-testid="rebase-onto-branch"
                @mousedown.stop.prevent="startOperation('rebase', branch)"
                :disabled="isStartingOperation || !!openCommit?.data.operation"
                :title="`Rebase ${openCommit?.data.gitBranch} onto ${branch}`"
                class="p-0.5 hover:bg-neutral-700 rounded disabled:opacity-40"
              ><GitPullRequestArrow :size="12" class="text-neutral-400" /></button>
            </span>
          </div>
          <template v-if="(remotes?.data.tags.length ?? 0) > 0 && !remotes?.data.branchInput">
            <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-neutral-500 border-t border-neutral-800">Tags</div>
            <div v-for="tag in remotes!.data.tags" :key="tag.name" data-testid="tag-row" class="group px-3 py-1.5 flex items-center gap-2 hover:bg-neutral-800" @mousedown.prevent>
              <Tag :size="12" class="text-neutral-400" />
              <span class="text-xs text-neutral-300">{{ tag.name }}</span>
              <span class="text-[10px] text-neutral-500 font-mono">{{ tag.commit.slice(0, 7) }}</span>
              <span class="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <Loader2 v-if="remotes?.data.tagBusy?.name === tag.name" data-testid="tag-busy" :size="12" class="animate-spin text-neutral-400" />
                <template v-else>
                  <button data-testid="push-tag" :disabled="!!remotes?.data.tagBusy" @mousedown.stop.prevent="tagConfirmation = { name: tag.name, action: 'push' }" :title="`Push ${tag.name}`" class="p-0.5 hover:bg-neutral-700 rounded disabled:opacity-40"><Upload :size="12" class="text-neutral-400" /></button>
                  <button data-testid="delete-tag" :disabled="!!remotes?.data.tagBusy" @mousedown.stop.prevent="tagConfirmation = { name: tag.name, action: 'delete' }" :title="`Delete ${tag.name} here`" class="p-0.5 hover:bg-neutral-700 rounded disabled:opacity-40"><Trash2 :size="12" class="text-neutral-400" /></button>
                </template>
              </span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- The repository's file watches are not open, or are open and not delivering, so what is shown may be behind -->
    <div
      v-if="openCommit && (!openCommit.data.isWatchingRepository || openCommit.data.isWatchSilent) && !openCommit.data.gitError"
      data-testid="watch-notice"
      class="px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      <template v-if="!openCommit.data.isWatchingRepository">Live updates are off for this repository.</template>
      <template v-else>Live updates are not arriving for this repository: changes keep turning up that the watch never reported, as a network drive or the system's limit on watches can cause.</template>
      It is read again when you return to this window or press Refresh.
    </div>

    <!-- A whole status took longer than its budget, and git has speed-ups for it that are off here -->
    <div
      v-if="openCommit?.data.slowStatus && !openCommit.data.gitError"
      data-testid="slow-status"
      class="flex items-center gap-2 px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      <span class="flex-1">
        Reading this repository's status took {{ (openCommit.data.slowStatus.ms / 1000).toFixed(1) }}s.
        Git can make it faster by {{ slowStatusRemedy }}, which is written to this repository's settings.
      </span>
      <button
        data-testid="speed-up-status"
        :disabled="isSpeedingUpStatus"
        class="px-2 py-0.5 rounded text-neutral-200 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40"
        @click="send({ type: 'commit.SPEED_UP_STATUS' })"
      >Turn on</button>
    </div>

    <!-- Fetching by itself has stopped, so what is shown of the remote is as old as the last fetch that worked -->
    <div
      v-if="openCommit?.data.isFetchSuspended && !openCommit.data.gitError"
      class="px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      Fetching by itself is off: the remote asked for a sign-in and nobody was there to give one. It starts again after a push or a pull that works, or when the fetch settings change.
      <SignInHelp v-if="openCommit.data.fetchSignIn" class="mt-2" :help="openCommit.data.fetchSignIn" :busy="isSettingUpSignIn" @sign-in="setUpSignIn" />
    </div>

    <!-- More than one repository under the folder: the panel works in the one chosen -->
    <div v-if="(openCommit?.data.repositories.length ?? 0) > 1" data-testid="repository-picker" class="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-neutral-800 text-neutral-400">
      <span class="shrink-0">Repository</span>
      <select
        class="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-neutral-200"
        :value="openCommit!.data.directory"
        @change="send({ type: 'commit.SELECT_REPOSITORY', path: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="repository in openCommit!.data.repositories" :key="repository.path" :value="repository.path">
          {{ repository.relative || 'This folder' }}{{ repository.kind === 'top' || repository.kind === 'nested' ? '' : ` (${repository.kind})` }}
        </option>
      </select>
    </div>

    <!-- The last write here that can be taken back: a commit, a reset, a dropped or cleared stash -->
    <div
      v-if="recovery?.data.lastUndoable && !openCommit?.data.gitError"
      data-testid="write-undo"
      class="flex items-center gap-2 px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      <span class="flex-1">
        <template v-if="recovery.data.undoConfirmation">{{ recovery.data.undoConfirmation }}</template>
        <template v-else>Done: {{ recovery.data.lastUndoable.summary }}.</template>
      </span>
      <button
        v-if="recovery.data.undoConfirmation"
        data-testid="write-undo-anyway"
        class="px-2 py-0.5 rounded text-neutral-200 bg-neutral-800 hover:bg-neutral-700"
        @click="send({ type: 'commit.UNDO_LAST', evenIfPublished: true })"
      >Undo here anyway</button>
      <button
        v-else
        data-testid="write-undo-button"
        class="px-2 py-0.5 rounded text-neutral-200 bg-neutral-800 hover:bg-neutral-700"
        @click="send({ type: 'commit.UNDO_LAST' })"
      >Undo</button>
      <button class="p-0.5 rounded hover:bg-neutral-700" title="Dismiss" @click="send({ type: 'commit.DISMISS_UNDO' })"><X :size="12" /></button>
    </div>

    <!-- An amend or a rewrite of commits a remote branch already holds: done here only once the user says so -->
    <div
      v-if="composer?.data.rewriteConfirmation"
      data-testid="rewrite-confirmation"
      class="flex items-center gap-2 px-3 py-2 text-xs border-b border-neutral-800 text-amber-300"
    >
      <span class="flex-1">{{ composer.data.rewriteConfirmation.message }}</span>
      <button
        data-testid="rewrite-anyway"
        class="px-2 py-0.5 rounded text-neutral-200 bg-neutral-800 hover:bg-neutral-700"
        @click="send({ type: 'commit.CONFIRM_REWRITE' })"
      >Rewrite here anyway</button>
      <button class="p-0.5 rounded hover:bg-neutral-700" title="Dismiss" @click="send({ type: 'commit.DISMISS_REWRITE' })"><X :size="12" /></button>
    </div>

    <!-- A discard kept what it removed, which is offered back until it is dismissed -->
    <div
      v-if="recovery?.data.lastDiscard && !openCommit?.data.gitError"
      data-testid="discard-undo"
      class="flex items-center gap-2 px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      <span class="flex-1">
        Discarded {{ recovery.data.lastDiscard.paths.length === 1 ? recovery.data.lastDiscard.paths[0] : `${recovery.data.lastDiscard.paths.length} changes` }}. What was removed is kept for 14 days.
        <template v-if="recovery.data.lastDiscard.notKept.length > 0">
          {{ recovery.data.lastDiscard.notKept.length === 1 ? 'One file was' : `${recovery.data.lastDiscard.notKept.length} files were` }} too large to keep.
        </template>
      </span>
      <button class="px-2 py-0.5 rounded text-neutral-200 bg-neutral-800 hover:bg-neutral-700" @click="send({ type: 'commit.UNDO_DISCARD' })">Undo</button>
      <button class="p-0.5 rounded hover:bg-neutral-700" title="Dismiss" @click="send({ type: 'commit.DISMISS_DISCARD' })"><X :size="12" /></button>
    </div>

    <!-- Undoing a discard left alone what had changed or been made again since -->
    <div
      v-else-if="(recovery?.data.discardLeft.length ?? 0) > 0 && !openCommit?.data.gitError"
      data-testid="discard-left"
      class="flex items-center gap-2 px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      <span class="flex-1">
        Put back, except {{ recovery!.data.discardLeft.length === 1 ? recovery!.data.discardLeft[0] : `${recovery!.data.discardLeft.length} files` }}, which {{ recovery!.data.discardLeft.length === 1 ? 'has' : 'have' }} changed since and {{ recovery!.data.discardLeft.length === 1 ? 'was' : 'were' }} left as {{ recovery!.data.discardLeft.length === 1 ? 'it is' : 'they are' }}.
      </span>
      <button class="p-0.5 rounded hover:bg-neutral-700" title="Dismiss" @click="send({ type: 'commit.DISMISS_DISCARD' })"><X :size="12" /></button>
    </div>

    <!-- The repository has more changed files than are listed -->
    <div
      v-if="openCommit?.data.isStatusTruncated && !openCommit.data.gitError"
      class="px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      Too many changes to list them all. Showing the first {{ openCommit.data.gitStatus.length.toLocaleString() }}.
    </div>

    <!-- Git is in the middle of something, which ends when it is carried on with or given up -->
    <div v-if="openCommit?.data.operation" class="px-3 py-2 border-b border-neutral-800 bg-orange-900/10" data-testid="repository-operation">
      <div class="text-xs font-medium text-orange-400">{{ operationTitle }}</div>
      <div class="mt-0.5 text-xs text-neutral-400">{{ operationHint }}</div>
      <div class="flex items-center gap-2 mt-2">
        <button
          @click="moveOperation('continue')"
          :disabled="mergeConflictFiles.length > 0 || isMovingOperation"
          :class="[
            'px-2 py-1 rounded text-xs font-medium transition-colors',
            mergeConflictFiles.length > 0 || isMovingOperation
              ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 text-white'
          ]"
        >
          Continue
        </button>
        <button
          v-if="openCommit.data.operation.kind === 'rebase'"
          @click="moveOperation('skip')"
          :disabled="isMovingOperation"
          class="px-2 py-1 text-xs font-medium transition-colors rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed"
          title="Leave out the commit the rebase stopped at"
        >
          Skip commit
        </button>
        <button
          @click="showAbortOperationDialog = true"
          :disabled="isMovingOperation"
          class="px-2 py-1 text-xs font-medium transition-colors rounded bg-neutral-800 text-red-400 hover:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed"
        >
          Abort
        </button>
      </div>
    </div>

    <!-- Git was not run, because the repository would have it run something and has not been trusted -->
    <TrustRequest v-if="trustRequest" :request="trustRequest" @trust="send({ type: 'commit.TRUST_REPOSITORY' })" />
    <OwnershipRequest v-else-if="ownershipRequest" :directory="ownershipRequest.directory" @trust="send({ type: 'commit.TRUST_OWNERSHIP' })" />

    <!-- Git Error (only show non-directory errors) -->
    <div v-else-if="openCommit?.data.gitError && !isNoDirectoryError" class="p-3 border-b border-red-800 bg-red-900/20">
      <div class="flex items-start gap-2">
        <div
          ref="errorContentRef"
          class="flex-1 text-sm text-red-400 whitespace-pre-wrap break-words"
          :class="{ 'max-h-24 overflow-hidden': !isErrorExpanded }"
        >{{ openCommit.data.gitError }}<pre v-if="refusingHook?.output" data-testid="hook-output" class="mt-1.5 p-2 rounded bg-neutral-950/60 text-xs font-mono text-neutral-300 whitespace-pre-wrap">{{ refusingHook.output }}</pre></div>
        <button
          @click="dismissError"
          class="shrink-0 p-0.5 rounded text-red-400 hover:text-red-200 hover:bg-red-900/40 transition-colors"
          title="Dismiss"
        >
          <X :size="14" />
        </button>
      </div>
      <button
        v-if="isErrorOverflowing"
        @click="isErrorExpanded = !isErrorExpanded"
        class="mt-1 text-xs text-red-500 hover:text-red-300 transition-colors"
      >{{ isErrorExpanded ? 'View less' : 'View more' }}</button>
      <SignInHelp v-if="errorSignIn" class="mt-2" :help="errorSignIn" :busy="isSettingUpSignIn" @sign-in="setUpSignIn" />
      <!-- A checkout found no branch of the name: making one is offered, never done unasked -->
      <button
        v-if="missingBranch"
        data-testid="create-missing-branch"
        @click="send({ type: 'commit.CREATE_BRANCH', branchName: missingBranch })"
        class="mt-2 px-2 py-1 text-xs rounded border border-red-800 text-red-300 hover:bg-red-900/40 transition-colors"
      >Create branch {{ missingBranch }}</button>
    </div>

    <!-- Commit Message -->
    <div class="px-4 py-3 border-b border-neutral-800">
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1">
            <div class="relative -ml-1">
              <button
                @click="showStashMenu = !showStashMenu"
                @blur="hideStashMenu"
                :disabled="(openCommit?.data.gitStatus.length ?? 0) === 0 && !isStashing"
                class="p-1 rounded transition-colors text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                title="More actions"
              >
                <Loader2 v-if="isStashing" :size="14" class="animate-spin" />
                <MoreVertical v-else :size="14" />
              </button>
              <div
                v-if="showStashMenu"
                class="absolute left-0 z-10 mt-1 w-44 bg-neutral-900 border border-neutral-700 rounded shadow-lg"
              >
                <button
                  @mousedown.prevent="stashAll"
                  class="w-full px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800 transition-colors"
                >
                  Stash All Changes
                </button>
                <button
                  @mousedown.prevent="stashStaged"
                  :disabled="stagedFiles.length === 0"
                  class="w-full px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Stash Staged Only
                </button>
              </div>
            </div>
            <label :class="['text-sm transition-colors', commit?.data.isGeneratingMessage ? 'text-amber-400/70 animate-pulse' : 'text-neutral-400']">
              {{ commit?.data.isGeneratingMessage ? 'Generating...' : 'Commit Message' }}
            </label>
          </div>
          <button
            :disabled="commit?.data.isGeneratingMessage"
            class="p-1 rounded transition-colors text-neutral-400 hover:text-amber-400 disabled:cursor-not-allowed"
            title="Generate commit message"
            @click="generateMessage"
          >
            <Loader2 v-if="commit?.data.isGeneratingMessage" :size="14" class="animate-spin text-amber-400" />
            <Sparkles v-else :size="14" />
          </button>
        </div>
        <textarea
          ref="commitTextarea"
          :value="commit?.data.commitMessage ?? ''"
          :readonly="commit?.data.isGeneratingMessage"
          data-testid="commit-message"
          @input="updateCommitMessage"
          @keydown.enter="commitByKey"
          :placeholder="`Message (currently on ${openCommit?.data.gitBranch || 'unknown'})`"
          :class="[
            'w-full px-3 py-2 text-sm border rounded resize-none overflow-y-auto bg-neutral-900 text-neutral-100 placeholder-neutral-500 focus:outline-none commit-message transition-colors',
            commit?.data.isGeneratingMessage ? 'border-amber-400/30 animate-pulse' : 'border-neutral-700 focus:border-neutral-600'
          ]"
          style="max-height: 200px"
          rows="4"
        />
        <!-- The trailers git reads at the end of the message: each can be taken out, and those the settings name are left out of the commit -->
        <div v-if="(composer?.data.trailers.length ?? 0) > 0" class="flex flex-wrap items-center gap-1" data-testid="commit-trailers">
          <span
            v-for="(trailer, index) in composer!.data.trailers"
            :key="`${index}:${trailer.key}:${trailer.value}`"
            :class="[
              'inline-flex items-center gap-1 max-w-full pl-1.5 pr-0.5 py-0.5 text-[11px] rounded border',
              removedOnCommit(trailer) ? 'border-neutral-800 text-neutral-500' : 'border-neutral-700 text-neutral-300'
            ]"
            :title="removedOnCommit(trailer) ? `${trailer.key}: ${trailer.value} — removed on commit (Settings › Code)` : `${trailer.key}: ${trailer.value}`"
            data-commit-trailer
          >
            <span :class="['truncate', removedOnCommit(trailer) && 'line-through']">{{ trailer.key }}: {{ trailer.value }}</span>
            <span v-if="removedOnCommit(trailer)" class="flex-shrink-0 text-neutral-600">removed on commit</span>
            <button
              class="flex-shrink-0 p-0.5 text-neutral-500 hover:text-red-400 transition-colors"
              :title="`Take ${trailer.key} out of the message`"
              @click="send({ type: 'commit.REMOVE_TRAILER', trailer })"
            >
              <X :size="11" />
            </button>
          </span>
        </div>
        <button
          v-if="shouldShowActionButton"
          @click="handleActionButton"
          :disabled="isActionButtonDisabled"
          :class="[
            'w-full px-3 py-1.5 rounded text-sm font-medium transition-colors',
            !isActionButtonDisabled
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
          ]"
        >
          {{ actionButtonText }}
        </button>
        <!-- A push waiting on the network can be stopped: what it leaves is the checkout as it was -->
        <button
          v-if="shouldShowActionButton && isPushing"
          data-testid="stop-push"
          class="w-full px-3 py-1 mt-1 text-xs rounded text-neutral-300 bg-neutral-800 hover:bg-neutral-700"
          @click="send({ type: 'commit.STOP_PUSH' })"
        >
          Stop pushing
        </button>

        <button
          v-if="!shouldShowActionButton"
          @click="commitChanges"
          :disabled="!canCommit"
          :title="whyNot.commit ?? undefined"
          data-testid="commit-button"
          :class="[
            'w-full px-3 py-1.5 rounded text-sm font-medium transition-colors',
            canCommit
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
          ]"
        >
          Commit
        </button>
        <button
          v-if="hasCommits && !isPushing"
          data-testid="amend-button"
          @click="amend"
          :disabled="!!openCommit?.data.operation || isCommitting"
          class="w-full mt-1 px-3 py-1 rounded text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
          title="Amend the last commit with what is staged, and with this message if one is written"
        >
          Amend last commit
        </button>
      </div>
    </div>

    <!-- File Changes -->
    <div class="flex-1 overflow-y-auto">
      <!-- Nothing is known of a repository git was not run in, so it is not said to be clean -->
      <div v-if="gitNeverRan && (openCommit?.data.gitStatus.length ?? 0) === 0" />
      <EmptyState
        v-else-if="(openCommit?.data.gitStatus.length ?? 0) === 0"
        :icon="GitCommit"
        title="No changes to commit"
        subtitle="Working tree is clean"
      />

      <div v-else class="divide-y divide-neutral-800">
        <!-- Staged Changes -->
        <div v-if="stagedFiles.length > 0" class="p-3">
          <div class="flex items-center justify-between mb-2 px-2">
            <span class="text-xs font-medium text-neutral-400">STAGED CHANGES</span>
            <button @click="unstageAll" class="p-0.5 hover:bg-neutral-700 rounded" title="Unstage All">
              <Minus class="w-3 h-3 text-neutral-400" />
            </button>
          </div>
          <div class="space-y-1">
            <GitFileItem
              v-for="file in stagedFiles"
              :key="`staged-${file.path}`"
              :file="file"
              :count="openCommit?.data.lineCounts[`${file.staged}:${file.path}`]"
              :isSelected="openCommit?.data.selectedGitFile?.path === file.path && openCommit?.data.selectedGitFile?.staged === file.staged"
              @select="selectFile"
              @openFile="openFile"
            >
              <template #actions>
                <button @click.stop="unstageFile(file)" class="p-0.5 hover:bg-neutral-700 rounded" title="Unstage">
                  <Minus class="w-3 h-3 text-neutral-400" />
                </button>
              </template>
              <template #menuItems>
                <ContextMenuItem @select="unstageFile(file)" :class="MENU_ITEM_CLASS">
                  <Minus class="w-4 h-4" /> Unstage
                </ContextMenuItem>
                <ContextMenuItem @select="stashFile(file)" :class="MENU_ITEM_CLASS">
                  <Archive class="w-4 h-4" /> Stash this file
                </ContextMenuItem>
              </template>
            </GitFileItem>
          </div>
        </div>

        <!-- Merge Conflicts -->
        <div v-if="mergeConflictFiles.length > 0" class="p-3">
          <div class="flex items-center justify-between mb-2 px-2">
            <span class="text-xs font-medium text-orange-400">MERGE CHANGES</span>
            <div class="flex items-center gap-2">
              <button @click="showDiscardAllMergeDialog = true" class="p-0.5 hover:bg-neutral-700 rounded" title="Accept All Ours (HEAD)">
                <RotateCcw class="w-3 h-3 text-red-400" />
              </button>
              <button @click="markAllResolved" class="p-0.5 hover:bg-neutral-700 rounded" title="Stage All Merge Files">
                <Plus class="w-3 h-3 text-neutral-400" />
              </button>
            </div>
          </div>
          <div class="space-y-1">
            <GitFileItem
              v-for="file in mergeConflictFiles"
              :key="`merge-${file.path}`"
              :file="file"
              :isSelected="openCommit?.data.selectedGitFile?.path === file.path"
              @select="selectFile"
              @openFile="openFile"
            >
              <template #prefix>
                <GitMerge :size="12" class="text-orange-400 flex-shrink-0" />
              </template>
              <template #statusBadge>
                <span class="flex-shrink-0 w-4 text-xs font-medium text-orange-500" :title="conflictLabel(file)">C</span>
              </template>
              <template #actions>
                <button @click.stop="acceptOurs(file)" class="p-0.5 hover:bg-neutral-700 rounded" title="Accept Ours">
                  <RotateCcw class="w-3 h-3 text-blue-400" />
                </button>
                <button @click.stop="acceptTheirs(file)" class="p-0.5 hover:bg-neutral-700 rounded" title="Accept Theirs">
                  <Check class="w-3 h-3 text-green-400" />
                </button>
                <button @click.stop="markResolved(file)" class="p-0.5 hover:bg-neutral-700 rounded" title="Mark as Resolved (stage as-is)">
                  <Plus class="w-3 h-3 text-neutral-400" />
                </button>
              </template>
              <template #menuItems>
                <ContextMenuItem @select="acceptOurs(file)" :class="MENU_ITEM_CLASS">
                  <RotateCcw class="w-4 h-4" /> Accept Ours
                </ContextMenuItem>
                <ContextMenuItem @select="acceptTheirs(file)" :class="MENU_ITEM_CLASS">
                  <Check class="w-4 h-4" /> Accept Theirs
                </ContextMenuItem>
                <ContextMenuItem @select="markResolved(file)" :class="MENU_ITEM_CLASS">
                  <Plus class="w-4 h-4" /> Mark as Resolved
                </ContextMenuItem>
              </template>
            </GitFileItem>
          </div>
        </div>

        <!-- Unstaged Changes -->
        <div v-if="unstagedFiles.length > 0" class="p-3">
          <div class="flex items-center justify-between mb-2 px-2">
            <span class="text-xs font-medium text-neutral-400">CHANGES</span>
            <div class="flex items-center gap-2">
              <button @click="openDiscardAllDialog" class="p-0.5 hover:bg-neutral-700 rounded" title="Discard All Changes">
                <RotateCcw class="w-3 h-3 text-red-400" />
              </button>
              <button @click="stageAll" class="p-0.5 hover:bg-neutral-700 rounded" title="Stage All Changes">
                <Plus class="w-3 h-3 text-neutral-400" />
              </button>
            </div>
          </div>
          <div class="space-y-1">
            <template v-for="file in unstagedRows" :key="`unstaged-${file.path}`">
              <!-- A file in an open folder is a row under the folder's, which is one row for all of it -->
              <GitFileItem
                :file="file"
                :count="openCommit?.data.lineCounts[`${file.staged}:${file.path}`]"
                :isSelected="openCommit?.data.selectedGitFile?.path === file.path && openCommit?.data.selectedGitFile?.staged === file.staged"
                @select="file.isDirectory ? toggleFolder(file) : selectFile(file)"
                @openFile="openFile"
              >
                <template v-if="file.isDirectory" #prefix>
                  <component :is="openCommit?.data.openFolders[file.path] ? ChevronDown : ChevronRight" :size="12" class="text-neutral-500 flex-shrink-0" />
                  <Folder :size="12" class="text-neutral-400 flex-shrink-0" />
                </template>
                <!-- Set in from the folder's row, by the width of its arrow and icon -->
                <template v-else-if="file.inFolder" #prefix>
                  <span class="w-7 flex-shrink-0" />
                </template>
                <template #actions>
                  <button
                    v-if="file.submodule?.commit"
                    @click.stop="updateSubmodule(file)"
                    :disabled="openCommit?.data.updatingSubmodule !== null"
                    class="p-0.5 hover:bg-neutral-700 rounded disabled:opacity-50"
                    :title="openCommit?.data.updatingSubmodule === file.path ? `Updating submodule${progressOf('submodule')}` : 'Update submodule to the commit this repository records'"
                    data-testid="update-submodule"
                  >
                    <component :is="openCommit?.data.updatingSubmodule === file.path ? Loader2 : FolderSync" :class="['w-3 h-3 text-neutral-400', openCommit?.data.updatingSubmodule === file.path && 'animate-spin']" />
                  </button>
                  <button @click.stop="openRevertDialog(file)" class="p-0.5 hover:bg-neutral-700 rounded" title="Discard changes">
                    <RotateCcw class="w-3 h-3 text-red-400" />
                  </button>
                  <button @click.stop="stageFile(file)" class="p-0.5 hover:bg-neutral-700 rounded" title="Stage">
                    <Plus class="w-3 h-3 text-neutral-400" />
                  </button>
                </template>
                <template #menuItems>
                  <ContextMenuItem @select="stageFile(file)" :class="MENU_ITEM_CLASS">
                    <Plus class="w-4 h-4" /> Stage
                  </ContextMenuItem>
                  <ContextMenuItem v-if="file.submodule?.commit" :disabled="openCommit?.data.updatingSubmodule !== null" @select="updateSubmodule(file)" :class="MENU_ITEM_CLASS">
                    <FolderSync class="w-4 h-4" /> Update Submodule
                  </ContextMenuItem>
                  <ContextMenuItem v-if="!file.isDirectory" @select="stashFile(file)" :class="MENU_ITEM_CLASS">
                    <Archive class="w-4 h-4" /> Stash this file
                  </ContextMenuItem>
                  <ContextMenuItem @select="openRevertDialog(file)" :class="MENU_ITEM_DANGER_CLASS">
                    <RotateCcw class="w-4 h-4" /> Discard Changes
                  </ContextMenuItem>
                </template>
              </GitFileItem>
              <div v-if="file.isDirectory && openCommit?.data.openFolders[file.path]?.truncated" class="ml-4 px-2 py-1 text-xs text-neutral-500">
                This folder holds more files than are listed here. Staging or discarding its row covers all of them.
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Commits Section -->
    <div @contextmenu.prevent="onSectionContextMenu">
      <CommitLogSection v-if="codeSettings?.showCommits !== false" :toast="toast" />
    </div>

    <!-- Stash resize handle -->
    <PanelResizer
      v-if="codeSettings?.showStashes && (stashes?.data.stashList.length ?? 0) > 0 && isStashesExpanded"
      orientation="vertical"
      subtle
      @resize="onStashResize"
    />

    <!-- Stashes Section -->
    <div v-if="codeSettings?.showStashes && (stashes?.data.stashList.length ?? 0) > 0" class="flex-shrink-0 border-t border-neutral-800" @contextmenu.prevent="onSectionContextMenu">
      <div class="flex items-center justify-between p-3 px-5 cursor-pointer hover:bg-neutral-800/60 transition-colors" @click="isStashesExpanded = !isStashesExpanded">
        <div class="flex items-center gap-1 text-xs font-medium text-neutral-400">
          <ChevronRight v-if="!isStashesExpanded" class="w-3 h-3" />
          <ChevronDown v-else class="w-3 h-3" />
          STASHES ({{ stashSearchQuery.trim() ? `${filteredStashes.length}/` : '' }}{{ stashes!.data.stashList.length }})
        </div>
        <div class="flex items-center gap-1" @click.stop>
          <button @click="toggleStashSearch" class="p-1 hover:bg-neutral-700 rounded transition-colors" :class="showStashSearch ? 'bg-neutral-700' : ''" title="Search Stashes">
            <Search class="w-3.5 h-3.5 text-neutral-400" />
          </button>
          <button @click="openClearStashesDialog" class="p-1 hover:bg-neutral-700 rounded transition-colors" title="Clear All Stashes">
            <Trash2 class="w-3.5 h-3.5 text-neutral-400" />
          </button>
        </div>
      </div>
      <div v-if="isStashesExpanded" class="overflow-y-auto pb-3" :style="{ maxHeight: stashHeight + 'px' }">
        <div v-if="showStashSearch" class="pl-5 pr-3 mb-1.5">
          <div class="relative">
          <Search :size="12" class="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            ref="stashSearchInput"
            v-model="stashSearchQuery"
            placeholder="Search stashes..."
            class="w-full pl-7 pr-7 py-1 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
            @click.stop
          />
          <button
            v-if="stashSearchQuery"
            @click.stop="stashSearchQuery = ''"
            class="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-neutral-700 rounded"
          >
            <X :size="12" class="text-neutral-400" />
          </button>
          </div>
        </div>
        <div class="space-y-0.5 pl-3">
          <div
            v-for="stash in filteredStashes"
            :key="stash.ref"
            data-testid="stash-row"
            class="group px-2 py-1.5 rounded hover:bg-neutral-800/50 transition-colors cursor-pointer"
            @click="send({ type: 'commit.TOGGLE_STASH_FILES', index: stash.index })"
          >
            <div class="flex items-center gap-2 min-w-0">
              <div class="flex-1 min-w-0">
                <div class="text-xs text-neutral-200 truncate">{{ formatStashMessage(stash) }}</div>
                <div class="text-[11px] text-neutral-500 truncate">{{ stash.ref }} · {{ formatStashBranch(stash.message) }} · {{ formatStashDate(stash.date) }}</div>
              </div>
              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button @click.stop="send({ type: 'commit.TOGGLE_STASH_FILES', index: stash.index })" class="p-0.5 hover:bg-neutral-700 rounded" title="Show its files" data-testid="stash-files-toggle">
                  <FileText class="w-3 h-3 text-neutral-400" />
                </button>
                <button @click.stop="copyStashMessage(stash)" class="p-0.5 hover:bg-neutral-700 rounded" title="Copy message">
                  <Copy class="w-3 h-3 text-neutral-400" />
                </button>
                <button @click.stop="applyStash(stash.index)" class="p-0.5 hover:bg-neutral-700 rounded" title="Apply (keep the stash)" data-testid="stash-apply">
                  <Check class="w-3 h-3 text-neutral-400" />
                </button>
                <button @click.stop="popStash(stash.index)" class="p-0.5 hover:bg-neutral-700 rounded" title="Pop (apply & remove)">
                  <ArrowDownToLine class="w-3 h-3 text-neutral-400" />
                </button>
                <button @click.stop="openDropStashDialog(stash.index)" class="p-0.5 hover:bg-neutral-700 rounded" title="Drop">
                  <Trash2 class="w-3 h-3 text-red-400" />
                </button>
              </div>
            </div>
            <!-- What the stash holds, read without applying it -->
            <div v-if="stashes?.data.stashFiles[stash.index]" class="mt-1 pl-2 space-y-0.5" data-testid="stash-files" @click.stop>
              <div v-for="file in stashes.data.stashFiles[stash.index]" :key="file.path" class="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                <span class="truncate flex-1" :title="file.path">{{ file.path }}</span>
                <span v-if="!file.binary" class="tabular-nums flex-shrink-0"><span class="text-green-500/80">+{{ file.added }}</span> <span class="text-red-500/80">-{{ file.removed }}</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Drop Stash Dialog -->
    <RevertDialog
      :show="showDropStashDialog"
      :file="null"
      :customTitle="'Drop Stash'"
      :customMessage="'Are you sure you want to drop this stash?'"
      @confirm="confirmDropStash"
      @cancel="cancelDropStash"
    />

    <!-- Clear All Stashes Dialog -->
    <RevertDialog
      :show="showClearStashesDialog"
      :file="null"
      :customTitle="'Clear All Stashes'"
      :customMessage="'Are you sure you want to clear all stashes?'"
      @confirm="confirmClearStashes"
      @cancel="cancelClearStashes"
    />

    <!-- Pushing a tag or deleting one, confirmed first -->
    <RevertDialog
      :show="!!tagConfirmation"
      :file="null"
      :customTitle="tagConfirmation?.action === 'push' ? 'Push Tag' : 'Delete Tag'"
      :customMessage="tagConfirmation?.action === 'push'
        ? `Push the tag ${tagConfirmation.name} to the remote, where others can fetch it?`
        : `Delete the tag ${tagConfirmation?.name} here? A copy already pushed stays on the remote.`"
      :reversible="tagConfirmation?.action === 'push' ? 'A tag pushed can be deleted from the remote again.' : undefined"
      @confirm="confirmTag"
      @cancel="tagConfirmation = null"
    />

    <!-- Worktrees Section -->
    <div v-if="codeSettings?.showWorktrees && (worktrees?.data.worktreeList.length ?? 0) > 0" class="flex-shrink-0 border-t border-neutral-800" @contextmenu.prevent="onSectionContextMenu">
      <div class="flex items-center justify-between p-3 px-5 cursor-pointer hover:bg-neutral-800/60 transition-colors" @click="isWorktreesExpanded = !isWorktreesExpanded">
        <div class="flex items-center gap-1 text-xs font-medium text-neutral-400">
          <ChevronRight v-if="!isWorktreesExpanded" class="w-3 h-3" />
          <ChevronDown v-else class="w-3 h-3" />
          WORKTREES ({{ worktrees!.data.worktreeList.length }})
          <Loader2 v-if="isWorktreeLoading" class="w-3 h-3 animate-spin ml-1" />
        </div>
        <div class="flex items-center gap-1" @click.stop>
          <button @click="startAddWorktree" :disabled="isWorktreeLoading" class="p-1 hover:bg-neutral-700 rounded transition-colors disabled:opacity-50" title="Add Worktree">
            <Plus class="w-3.5 h-3.5 text-neutral-400" />
          </button>
        </div>
      </div>
      <div v-if="isWorktreesExpanded" class="overflow-y-auto pb-3" style="max-height: 300px" :class="{ 'opacity-50 pointer-events-none': isWorktreeLoading }">
        <!-- Add worktree form -->
        <div v-if="showWorktreeAddForm" class="px-5 pb-2 space-y-2">
          <input
            v-model="newWorktreeBranch"
            placeholder="Branch name"
            class="w-full px-2 py-1 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
            @keydown.enter="addWorktree"
            @keydown.escape="cancelAddWorktree"
          />
          <input
            v-model="newWorktreePath"
            placeholder="Path"
            class="w-full px-2 py-1 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
            @keydown.enter="addWorktree"
            @keydown.escape="cancelAddWorktree"
          />
          <label class="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
            <input type="checkbox" v-model="createNewWorktreeBranch" class="rounded border-neutral-600" />
            Create new branch
          </label>
          <div class="flex items-center gap-2">
            <button @click="addWorktree" :disabled="!newWorktreeBranch.trim() || !newWorktreePath.trim() || isWorktreeLoading" class="px-2 py-1 text-xs bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-neutral-200 transition-colors">
              Create
            </button>
            <button @click="cancelAddWorktree" class="px-2 py-1 text-xs hover:bg-neutral-800 rounded text-neutral-400 transition-colors">
              Cancel
            </button>
          </div>
        </div>

        <!-- Worktree list -->
        <div class="space-y-0.5 pl-3">
          <div
            v-for="wt in worktrees!.data.worktreeList"
            :key="wt.path"
            class="group px-2 py-1.5 rounded hover:bg-neutral-800/50 transition-colors"
            :class="{ 'bg-neutral-800/30': wt.isCurrent, 'cursor-pointer': !wt.isCurrent }"
            @click="!wt.isCurrent && !isWorktreeLoading && switchWorktree(wt.path)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <Lock v-if="wt.isLocked" class="w-3 h-3 flex-shrink-0 text-yellow-500" :title="wt.lockedReason ? `Locked: ${wt.lockedReason}` : 'Locked'" />
              <GitFork v-else class="w-3 h-3 flex-shrink-0" :class="wt.isCurrent ? 'text-blue-400' : 'text-neutral-500'" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs truncate" :class="wt.isCurrent ? 'text-blue-300 font-medium' : 'text-neutral-200'">{{ wt.branch || '(detached)' }}</span>
                  <span v-if="wt.isCurrent" class="text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 flex-shrink-0">current</span>
                </div>
                <div class="text-[11px] text-neutral-500 truncate" :title="wt.path">{{ formatWorktreePath(wt.path) }}</div>
              </div>
              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button v-if="!wt.isCurrent" @click.stop="switchWorktree(wt.path)" class="p-0.5 hover:bg-neutral-700 rounded" title="Switch to this worktree">
                  <FolderSync class="w-3 h-3 text-neutral-400" />
                </button>
                <button v-if="!wt.isCurrent && !wt.isBare && !wt.isMain && !wt.isLocked" @click.stop="openRemoveWorktreeDialog(wt.path)" class="p-0.5 hover:bg-neutral-700 rounded" title="Remove worktree">
                  <Trash2 class="w-3 h-3 text-red-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Remove Worktree Dialog -->
    <RevertDialog
      :show="showRemoveWorktreeDialog"
      :file="null"
      :customTitle="'Remove Worktree'"
      :customMessage="'Are you sure you want to remove this worktree? Any uncommitted changes in the worktree will be lost.'"
      @confirm="confirmRemoveWorktree"
      @cancel="cancelRemoveWorktree"
    />

    <ToastNotification ref="toast" />

    <ContextMenuPopup
      :show="showMenu"
      :pos="menuPos"
      :items="sectionMenuItems"
      @close="showMenu = false"
    />
    </template>
  </div>
</template>

<script setup lang="ts">
import { whatCanBeDone, type Availability, type UnavailableReason } from '@apackdev/git/availability'

import { computed, onBeforeUnmount, ref, nextTick, watch } from 'vue'
import { useShell } from '@apackdev/sdk/fe'
import { useState } from '#generated/state-fe.ts'
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts'
import type { CommitTrailer, ConflictKind, OperationMove, ProgressDuring } from '#features/code/be/types.ts'
import { Folder, GitBranch, GitBranchPlus, GitCommit, GitFork, GitMerge, RefreshCw, Plus, Minus, RotateCcw, ChevronDown, ChevronRight, CheckCircle, Check, X, Sparkles, Loader2, ArrowDownToLine, ArrowUpFromLine, MoreVertical, Trash2, Copy, Search, FolderSync, Lock, FileText, GitPullRequestArrow, Pencil, Tag, Upload, Archive } from 'lucide-vue-next'
import { ContextMenuItem } from 'reka-ui'
import { MENU_ITEM_CLASS, MENU_ITEM_DANGER_CLASS } from '#features/code/fe/features/explorer/constants.ts'
import GitFileItem from '#features/code/fe/features/commit/GitFileItem.vue'
import CodePanelHeader from '#features/code/fe/features/CodePanelHeader.vue'
import NoDirectoryState from '#features/code/fe/features/NoDirectoryState.vue'
import EmptyState from '#features/code/fe/features/EmptyState.vue'
import RevertDialog from '#features/code/fe/features/commit/RevertDialog.vue'
import TrustRequest from '#features/code/fe/features/commit/TrustRequest.vue'
import OwnershipRequest from '#features/code/fe/features/commit/OwnershipRequest.vue'
import SignInHelp from '#features/code/fe/features/commit/SignInHelp.vue'
import CommitLogSection from '#features/code/fe/features/commit/CommitLogSection.vue'
import ToastNotification from '@apackdev/ui/design/ToastNotification'
import ContextMenuPopup from '@apackdev/ui/design/ContextMenuPopup'
import PanelResizer from '@apackdev/ui/layout/panel-resizer'
import { useSectionVisibilityMenu } from '#features/code/fe/composables/useSectionVisibilityMenu.ts'

const shell = useShell()

// The code surface's machine, the commit child, and commit's six folder-scoped children.
const { state: code, child } = useState('code')
const { state: commit, send, child: commitChild } = useState(() => child('commit'))
const openCommit = computed(() => (commit.value?.at === 'open' ? commit.value : undefined))
const { state: composer } = useState(() => commitChild('composer'))
const { state: recovery } = useState(() => commitChild('recovery'))
const { state: history } = useState(() => commitChild('history'))
const { state: remotes } = useState(() => commitChild('remotes'))
const { state: stashes } = useState(() => commitChild('stashes'))
const { state: worktrees } = useState(() => commitChild('worktrees'))

// Settings from code state
const codeSettings = computed(() => code.value.data.settings)
/** Whether the settings leave this trailer out of what is committed: by key, whatever its case, as git reads one */
const removedOnCommit = (trailer: CommitTrailer) =>
  (codeSettings.value?.trailersRemovedOnCommit ?? []).some(key => key.toLowerCase() === trailer.key.toLowerCase())

// Section visibility context menu
const { showMenu, menuPos, sectionMenuItems, onSectionContextMenu } = useSectionVisibilityMenu(codeSettings)

// State selectors from commit state and its children
/** The hook of the repository's that refused the last command, whose output is shown as its own */
const refusingHook = computed(() => openCommit.value?.data.gitFailure?.hook ?? null)
const isGitLoading = computed(() => Boolean(openCommit.value?.data.statusLoadingShown))
const hasCommits = computed(() => (history.value?.data.commitLog.length ?? 0) > 0)
/** What discarding these rows would remove that cannot be brought back, once that has been answered for these rows */
const notKeptOf = (paths: string[]): string[] => {
  const preview = recovery.value?.data.discardPreview
  return preview && preview.paths.join('\0') === paths.join('\0') ? [...preview.notKept] : []
}
/** What a pull would do, said before the click */
const pullTitle = computed(() => {
  const preview = openCommit.value?.data.pullPreview
  if (!preview) return 'Pull latest'
  switch (preview.kind) {
    case 'fast-forward': return 'Pull: a fast-forward'
    case 'clean': return 'Pull: merges cleanly'
    case 'conflicts': return `Pull: would conflict in ${preview.files.join(', ')}`
    case 'up-to-date': return 'Pull: nothing to bring in'
    default: return 'Pull latest'
  }
})
const isCheckingOutBranch = computed(() => Boolean(remotes.value?.pending.checkout || remotes.value?.pending.createBranch))
const isSpeedingUpStatus = computed(() => Boolean(openCommit.value?.pending.speedUp))
/** What turning the speed-ups on would turn on, of those that are off */
const slowStatusRemedy = computed(() => {
  const slow = openCommit.value?.data.slowStatus
  const off = [
    ...(slow && !slow.fileMonitor && slow.fileMonitorAvailable ? ['watching for changes itself'] : []),
    ...(slow && !slow.untrackedCache ? ['remembering untracked files'] : []),
  ]
  return off.join(' and ')
})
const isSettingUpSignIn = computed(() => Boolean(remotes.value?.pending.signIn))
// The help belongs to the error it came with, and goes when that error does
const missingBranch = computed(() => (openCommit.value?.data.gitError ? openCommit.value.data.gitFailure?.missingBranch ?? null : null))
const errorSignIn = computed(() => (openCommit.value?.data.gitError ? openCommit.value.data.gitFailure?.signIn ?? null : null))
// The refusal belongs to the error it came with, and goes when that error does
const trustRequest = computed(() => (openCommit.value?.data.gitError ? openCommit.value.data.gitFailure?.trust ?? null : null))
const ownershipRequest = computed(() => (openCommit.value?.data.gitError ? openCommit.value.data.gitFailure?.ownership ?? null : null))
/** The failures for which git read nothing, so the panel says nothing of the working tree */
const NOTHING_READ = new Set(['untrusted', 'unsafe-ownership', 'git-not-found', 'developer-tools-missing', 'git-too-old'])
const gitNeverRan = computed(() => !!openCommit.value?.data.gitError && NOTHING_READ.has(openCommit.value.data.gitFailure?.code ?? ''))
const isMovingOperation = computed(() => Boolean(remotes.value?.pending.moveOperation))
const isStartingOperation = computed(() => Boolean(remotes.value?.pending.startOperation))
/** What merging a branch in would do, said before the click once it is known */
const mergeTitle = (branch: string): string => {
  const known = remotes.value?.data.mergePreview?.target === branch ? remotes.value.data.mergePreview.preview : undefined
  const merging = `Merge ${branch} into ${openCommit.value?.data.gitBranch}`
  switch (known?.kind) {
    case 'fast-forward': return `${merging}: a fast-forward`
    case 'clean': return `${merging}: merges cleanly`
    case 'conflicts': return `${merging}: would conflict in ${known.files.join(', ')}`
    case 'up-to-date': return `${merging}: nothing to bring in`
    default: return merging
  }
}
const startOperation = (kind: 'merge' | 'rebase', target: string) => {
  showBranchDropdown.value = false
  send({ type: 'commit.START_OPERATION', kind, target })
}
const isPushing = computed(() => Boolean(remotes.value?.pending.push))
const isPulling = computed(() => Boolean(remotes.value?.pending.pull))
const isStashing = computed(() => Boolean(stashes.value?.pending.stash))
const isWorktreeLoading = computed(() =>
  Boolean(worktrees.value?.pending.worktreeAdd || worktrees.value?.pending.worktreeRemove || worktrees.value?.pending.worktreeSwitch))
const baseDirectory = computed(() => code.value.data.baseDirectory)

// Local state
const showDiscardAllDialog = ref(false)
const showDiscardAllMergeDialog = ref(false)
const showAbortOperationDialog = ref(false)
const showBranchDropdown = ref(false)
const highlightedBranchIndex = ref(-1)
const isCreatingBranch = ref(false)
const newBranchName = ref('')
const newBranchInput = ref<HTMLInputElement | null>(null)
const showStashMenu = ref(false)
const isStashesExpanded = ref(false)
const MIN_STASH_HEIGHT = 80
const MAX_STASH_HEIGHT = 400
const stashHeight = ref(192)
const stashSearchQuery = ref('')
const showStashSearch = ref(false)
const stashSearchInput = ref<HTMLInputElement | null>(null)
const showDropStashDialog = ref(false)
const pendingDropIndex = ref<number | null>(null)
const showClearStashesDialog = ref(false)
const isWorktreesExpanded = ref(false)
const showWorktreeAddForm = ref(false)
const newWorktreeBranch = ref('')
const newWorktreePath = ref('')
const createNewWorktreeBranch = ref(true)
const showRemoveWorktreeDialog = ref(false)
const pendingRemoveWorktreePath = ref<string | null>(null)
const isErrorExpanded = ref(false)
const errorContentRef = ref<HTMLElement | null>(null)
const isErrorOverflowing = ref(false)
const commitTextarea = ref<HTMLTextAreaElement | null>(null)
const toast = ref<InstanceType<typeof ToastNotification>>()
const syncFeedback = ref<string | null>(null)
let syncClearTimer: ReturnType<typeof setTimeout> | undefined
let stashMenuHideTimer: ReturnType<typeof setTimeout> | undefined
let branchDropdownHideTimer: ReturnType<typeof setTimeout> | undefined

onBeforeUnmount(() => {
  clearTimeout(syncClearTimer)
  clearTimeout(stashMenuHideTimer)
  clearTimeout(branchDropdownHideTimer)
})

const onStashResize = (delta: number) => {
  stashHeight.value = Math.max(MIN_STASH_HEIGHT, Math.min(MAX_STASH_HEIGHT, stashHeight.value - delta))
}

const showSyncFeedback = (message: string) => {
  syncFeedback.value = message
  clearTimeout(syncClearTimer)
  syncClearTimer = setTimeout(() => { syncFeedback.value = null }, 1500)
}

const watchSyncOp = (
  flag: typeof isPulling,
  getCount: () => number,
  label: string,
  noopMessage: string,
  stopped?: () => boolean
) => {
  let snapshotCount = 0
  watch(flag, (active, wasActive) => {
    if (active) {
      snapshotCount = getCount()
      clearTimeout(syncClearTimer)
      syncFeedback.value = null
    } else if (wasActive) {
      if (openCommit.value?.data.gitError) {
        toast.value?.error(`${label} failed`, openCommit.value.data.gitError)
      } else if (stopped?.()) {
        showSyncFeedback(`${label} stopped`)
      } else {
        showSyncFeedback(snapshotCount > 0
          ? `${label}ed ${snapshotCount} commit${snapshotCount !== 1 ? 's' : ''}`
          : noopMessage)
      }
    }
  })
}

const setUpSignIn = (host: string) => {
  send({ type: 'commit.SET_UP_SIGN_IN', host })
}

const dismissError = () => {
  send({ type: 'commit.DISMISS_ERROR' })
  isErrorExpanded.value = false
}

watch(() => openCommit.value?.data.gitError, () => {
  isErrorExpanded.value = false
  nextTick(() => {
    const el = errorContentRef.value
    if (el) {
      isErrorOverflowing.value = el.scrollHeight > el.clientHeight
    } else {
      isErrorOverflowing.value = false
    }
  })
})

watchSyncOp(isPulling, () => openCommit.value?.data.commitsBehind ?? 0, 'Pull', 'Already up to date')
watchSyncOp(isPushing, () => openCommit.value?.data.commitsAhead ?? 0, 'Push', 'Nothing to push', () => remotes.value?.data.pushStopped ?? false)

watch(() => commit.value?.data.commitMessage, (val) => {
  if (!val && commitTextarea.value) {
    commitTextarea.value.style.height = ''
  }
})

// Computed
const gitStatusList = computed(() => (openCommit.value?.data.gitStatus ?? []) as GitStatusFile[])
const stagedFiles = computed(() => gitStatusList.value.filter((f) => f.staged))
const mergeConflictFiles = computed(() => gitStatusList.value.filter((f) => f.status === 'unmerged'))
const unstagedFiles = computed(() => gitStatusList.value.filter((f) => !f.staged && f.status !== 'unmerged'))
/** The unstaged rows as they are drawn: each open folder's row is followed by a row for each file it lists */
const unstagedRows = computed(() => unstagedFiles.value.flatMap((file: GitStatusFile): (GitStatusFile & { inFolder?: boolean })[] => {
  const open = file.isDirectory ? openCommit.value?.data.openFolders[file.path] : undefined
  return [file, ...(open?.files ?? []).map(path => ({ path, status: 'untracked' as const, staged: false, inFolder: true }))]
}))
const toggleFolder = (file: GitStatusFile) => send({ type: 'commit.TOGGLE_FOLDER', path: file.path })

/** What can be done now, and why not, from what the panel holds of the repository: worded here, decided by the engine */
const canBeDone = computed(() => whatCanBeDone({
  files: [...gitStatusList.value],
  truncated: openCommit.value?.data.isStatusTruncated ?? false,
  branch: openCommit.value?.data.gitBranch ?? '',
  hasUpstream: openCommit.value?.data.hasUpstream ?? false,
  ahead: openCommit.value?.data.commitsAhead ?? 0,
  behind: openCommit.value?.data.commitsBehind ?? 0,
  hasIdentity: openCommit.value?.data.hasIdentity ?? true,
  ...(openCommit.value?.data.operation && { operation: openCommit.value.data.operation }),
}))
const REASONS: Record<UnavailableReason, string> = {
  'nothing-staged': 'Nothing is staged to commit.',
  conflicts: 'Settle the conflicts first.',
  'no-identity': 'Git has no name and email to commit with: set user.name and user.email.',
  'operation-in-progress': 'Carry on with what git is in the middle of, or give it up, first.',
  'no-upstream': 'This branch follows no remote branch: publish it first.',
  diverged: 'This branch and the one it follows have both moved on: pull first.',
  'up-to-date': 'There is nothing to do: it is up to date.',
}
const reasonOf = (availability: Availability) => (availability.possible ? null : REASONS[availability.reason])
const whyNot = computed(() => ({ commit: reasonOf(canBeDone.value.commit), push: reasonOf(canBeDone.value.push), pull: reasonOf(canBeDone.value.pull) }))
const syncTitle = computed(() => ((openCommit.value?.data.commitsAhead ?? 0) > 0 ? whyNot.value.push ?? 'Push' : whyNot.value.pull ?? pullTitle.value))

const isCommitting = computed(() => Boolean(composer.value?.pending.commit || composer.value?.pending.amend))
const canCommit = computed(() => !!commit.value?.data.commitMessage.trim() && stagedFiles.value.length > 0 && canBeDone.value.commit.possible && !isCommitting.value)

const isNoDirectoryError = computed(() => {
  return openCommit.value?.data.gitError?.includes('No directory selected')
})

const isNoGitRepoError = computed(() => {
  return openCommit.value?.data.gitError?.includes('not a git repository') ||
         openCommit.value?.data.gitError?.includes('Not a git repository')
})

const shouldShowActionButton = computed(() => {
  // Commit button takes priority when there are staged files
  if (stagedFiles.value.length > 0) return false
  return !openCommit.value?.data.hasUpstream || (openCommit.value?.data.commitsAhead ?? 0) > 0 || (openCommit.value?.data.commitsBehind ?? 0) > 0
})

/** How far along git says it is, once it has said: `Writing objects 42%` */
const progressOf = (during: ProgressDuring) => (openCommit.value?.data.progress?.during === during ? ` ${openCommit.value.data.progress.stage} ${openCommit.value.data.progress.percent}%` : '...')
const actionButtonText = computed(() => {
  if (isPushing.value) return `Pushing${progressOf('push')}`
  if (isPulling.value) return `Pulling${progressOf('pull')}`
  if (!openCommit.value?.data.hasUpstream) return 'Publish Branch'

  const behind = openCommit.value.data.commitsBehind
  const ahead = openCommit.value.data.commitsAhead
  // If we have both commits ahead and behind, prioritize pull
  if (behind > 0 && ahead === 0) {
    return `Pull (${behind} commit${behind !== 1 ? 's' : ''} behind)`
  }

  if (ahead > 0) {
    return `Push (${ahead} commit${ahead !== 1 ? 's' : ''})`
  }

  return 'Sync'
})

const isActionButtonPull = computed(() => {
  return Boolean(openCommit.value?.data.hasUpstream && openCommit.value.data.commitsBehind > 0 && openCommit.value.data.commitsAhead === 0)
})

const isActionButtonDisabled = computed(() => {
  return isPushing.value || isPulling.value
})

const filteredBranches = computed(() => {
  const branches = remotes.value?.data.availableBranches ?? []
  const input = (remotes.value?.data.branchInput ?? '').toLowerCase().trim()
  if (!input) return branches
  return branches.filter((branch: string) =>
    branch.toLowerCase().includes(input)
  )
})

const filteredStashes = computed(() => {
  const list = stashes.value?.data.stashList ?? []
  const query = stashSearchQuery.value.trim()
  if (!query) return list
  const lowerQuery = query.toLowerCase()
  return list.filter((stash: any) => {
    const text = `${stash.ref} ${stash.message}`.toLowerCase()
    return text.includes(lowerQuery)
  })
})

// Event handlers
const refreshStatus = () => {
  send({ type: 'commit.REFRESH_STATUS' })
}

const selectFile = (file: GitStatusFile) => {
  shell.restoreChat()
  send({ type: 'commit.SELECT_FILE', file })
  send({ type: 'commit.VIEW_DIFF', path: file.path, staged: file.staged })
}

const stageFile = (file: GitStatusFile) => {
  send({ type: 'commit.STAGE_FILES', paths: [file.path] })
}

const unstageFile = (file: GitStatusFile) => {
  send({ type: 'commit.UNSTAGE_FILES', paths: [file.path] })
}

const generateMessage = () => {
  send({ type: 'commit.GENERATE_MESSAGE' })
}

const updateCommitMessage = (event: Event) => {
  const target = event.target as HTMLTextAreaElement
  target.style.height = 'auto'
  target.style.height = `${Math.min(target.scrollHeight, 200)}px`
  send({ type: 'commit.UPDATE_MESSAGE', message: target.value })
}

const commitChanges = () => {
  if (canCommit.value) {
    send({ type: 'commit.COMMIT' })
  }
}

/**
 * Cmd+Enter or Ctrl+Enter in the message box commits, where the Commit button could be pressed. A key an input
 * method is composing with is the method's, and Enter alone is a new line
 */
const commitByKey = (event: KeyboardEvent) => {
  if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
  event.preventDefault()
  commitChanges()
}

const handleActionButton = () => {
  if (isActionButtonPull.value) {
    send({ type: 'commit.PULL_BRANCH' })
  } else {
    send({ type: 'commit.PUSH_BRANCH' })
  }
}

/** Amends the last commit with what is staged, and with the message box's words when there are any */
const amend = () => {
  const message = commit.value?.data.commitMessage?.trim()
  send({ type: 'commit.AMEND', ...(message && { message }) })
}

/** The paths of these files that git can be asked about by name: one whose name is not text is refused, and left out */
const byName = (files: GitStatusFile[]): string[] => files.filter(file => !file.nameNotText).map(file => file.path)

const stageAll = () => {
  send({ type: 'commit.STAGE_FILES', paths: byName(unstagedFiles.value) })
}

const unstageAll = () => {
  send({ type: 'commit.UNSTAGE_FILES', paths: byName(stagedFiles.value) })
}

const openDiscardAllDialog = () => {
  send({ type: 'commit.PREVIEW_DISCARD', paths: byName(unstagedFiles.value) })
  showDiscardAllDialog.value = true
}

const confirmDiscardAll = () => {
  send({ type: 'commit.REVERT_FILES', paths: byName(unstagedFiles.value) })
  showDiscardAllDialog.value = false
}

const cancelDiscardAll = () => {
  showDiscardAllDialog.value = false
}

const acceptOurs = (file: GitStatusFile) => {
  send({ type: 'commit.RESOLVE_CONFLICT', path: file.path, strategy: 'ours' })
}

const acceptTheirs = (file: GitStatusFile) => {
  send({ type: 'commit.RESOLVE_CONFLICT', path: file.path, strategy: 'theirs' })
}

const markResolved = (file: GitStatusFile) => {
  send({ type: 'commit.MARK_RESOLVED', path: file.path })
}

const markAllResolved = () => {
  send({ type: 'commit.STAGE_FILES', paths: mergeConflictFiles.value.map((f: GitStatusFile) => f.path) })
}

/** How a file is in conflict, in words: "here" is the side the checkout was on, as git's "ours" is */
const CONFLICT_LABELS: Record<ConflictKind, string> = {
  'both-modified': 'Changed on both sides',
  'both-added': 'Added on both sides',
  'both-deleted': 'Deleted on both sides',
  'added-by-us': 'Added here',
  'added-by-them': 'Added by the incoming side',
  'deleted-by-us': 'Deleted here, changed by the incoming side',
  'deleted-by-them': 'Changed here, deleted by the incoming side',
}
const conflictLabel = (file: GitStatusFile) => file.conflict ? `In conflict: ${CONFLICT_LABELS[file.conflict]}` : 'In conflict'

/** What git is in the middle of, as the panel names it */
const operationTitle = computed(() => {
  const current = openCommit.value?.data.operation
  if (!current) return ''
  const branch = openCommit.value?.data.gitBranch
  switch (current.kind) {
    case 'merge': return `Merging ${current.subject}${branch && branch !== 'HEAD' ? ` into ${branch}` : ''}`
    case 'rebase': return `Rebasing ${current.branch ?? 'commits'} onto ${current.subject}${current.step ? ` (commit ${current.step} of ${current.steps})` : ''}`
    case 'cherry-pick': return `Cherry-picking ${current.subject}`
    case 'revert': return `Reverting ${current.subject}`
  }
  return ''
})
const operationHint = computed(() => {
  const count = mergeConflictFiles.value.length
  if (count === 0) return 'Nothing is in conflict. Continue to finish it.'
  return `${count} ${count === 1 ? 'file is' : 'files are'} in conflict. Settle ${count === 1 ? 'it' : 'them'}, then continue.`
})
const moveOperation = (move: OperationMove) => {
  send({ type: 'commit.MOVE_OPERATION', move })
}
const confirmAbortOperation = () => {
  showAbortOperationDialog.value = false
  moveOperation('abort')
}

const confirmDiscardAllMerge = () => {
  send({ type: 'commit.RESOLVE_ALL_CONFLICTS', strategy: 'ours' })
  showDiscardAllMergeDialog.value = false
}

const openRevertDialog = (file: GitStatusFile) => {
  send({ type: 'commit.TOGGLE_REVERT_DIALOG', file })
}

const confirmRevert = () => {
  const file = recovery.value?.data.revertDialogFile
  if (file) send({ type: 'commit.REVERT_FILE', path: file.path })
}

const cancelRevert = () => {
  send({ type: 'commit.TOGGLE_REVERT_DIALOG' })
}

const openFile = (file: GitStatusFile) => {
  shell.restoreChat()
  send({ type: 'commit.OPEN_FILE', file })
}

const updateBranchInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  send({ type: 'commit.UPDATE_BRANCH_INPUT', input: target.value })
  highlightedBranchIndex.value = -1
}

const checkoutBranch = () => {
  if (remotes.value?.data.branchInput.trim() && !isCheckingOutBranch.value) {
    send({ type: 'commit.CHECKOUT_BRANCH' })
    showBranchDropdown.value = false
  }
}

const selectBranch = (branch: string) => {
  send({ type: 'commit.UPDATE_BRANCH_INPUT', input: branch })
  send({ type: 'commit.CHECKOUT_BRANCH' })
  showBranchDropdown.value = false
  send({ type: 'commit.UPDATE_BRANCH_INPUT', input: '' })
}

const startCreateBranch = () => {
  isCreatingBranch.value = true
  nextTick(() => newBranchInput.value?.focus())
}

const confirmCreateBranch = () => {
  const name = newBranchName.value.trim()
  if (!name) return
  if (renamingBranch.value) {
    if (name !== renamingBranch.value) send({ type: 'commit.RENAME_BRANCH', name: renamingBranch.value, to: name })
    cancelCreateBranch()
    return
  }
  send({ type: 'commit.CREATE_BRANCH', branchName: name })
  isCreatingBranch.value = false
  newBranchName.value = ''
}

const cancelCreateBranch = () => {
  isCreatingBranch.value = false
  renamingBranch.value = null
  newBranchName.value = ''
}

/** The local branch being renamed, in the branch name box */
const renamingBranch = ref<string | null>(null)
const startRenameBranch = (branch: string) => {
  showBranchDropdown.value = false
  renamingBranch.value = branch
  newBranchName.value = branch
  nextTick(() => newBranchInput.value?.select())
}

/** The submodule being brought to the commit this repository records for it, which holds the others back until it is */

/** Brings a submodule whose row says it is on another commit to the one this repository records */
const updateSubmodule = (file: GitStatusFile) => {
  send({ type: 'commit.UPDATE_SUBMODULE', path: file.path })
}

/** Stashes one file's changes, leaving the rest as they are */
const stashFile = (file: GitStatusFile) => {
  send({ type: 'commit.STASH_PUSH', message: `${file.path}`, paths: [file.path] })
}

// Stash handlers
const hideStashMenu = () => {
  clearTimeout(stashMenuHideTimer)
  stashMenuHideTimer = setTimeout(() => {
    showStashMenu.value = false
  }, 200)
}

const stashAll = () => {
  showStashMenu.value = false
  send({ type: 'commit.STASH_PUSH', message: commit.value?.data.commitMessage || undefined, stagedOnly: false })
}

const stashStaged = () => {
  showStashMenu.value = false
  send({ type: 'commit.STASH_PUSH', message: commit.value?.data.commitMessage || undefined, stagedOnly: true })
}

const applyStash = (index: number) => {
  send({ type: 'commit.STASH_APPLY', index })
}

/** The tag push or delete waiting on the user's yes */
const tagConfirmation = ref<{ name: string; action: 'push' | 'delete' } | null>(null)
const confirmTag = () => {
  const asked = tagConfirmation.value
  tagConfirmation.value = null
  if (asked) send({ type: asked.action === 'push' ? 'commit.PUSH_TAG' : 'commit.DELETE_TAG', name: asked.name })
}
watch(() => remotes.value?.data.tagPushed, (pushed) => { if (pushed) toast.value?.success('Tag pushed', `${pushed.name} is on the remote`) })

const popStash = (index: number) => {
  send({ type: 'commit.STASH_POP', index })
}

const copyStashMessage = (stash: any) => {
  const message = formatStashMessage(stash)
  navigator.clipboard.writeText(message)
}

const toggleStashSearch = async () => {
  showStashSearch.value = !showStashSearch.value
  if (showStashSearch.value) {
    await nextTick()
    stashSearchInput.value?.focus()
  } else {
    stashSearchQuery.value = ''
  }
}

const openDropStashDialog = (index: number) => {
  pendingDropIndex.value = index
  showDropStashDialog.value = true
}

const confirmDropStash = () => {
  if (pendingDropIndex.value !== null) {
    send({ type: 'commit.STASH_DROP', index: pendingDropIndex.value })
  }
  showDropStashDialog.value = false
  pendingDropIndex.value = null
}

const cancelDropStash = () => {
  showDropStashDialog.value = false
  pendingDropIndex.value = null
}

const openClearStashesDialog = () => {
  showClearStashesDialog.value = true
}

const confirmClearStashes = () => {
  send({ type: 'commit.STASH_CLEAR' })
  showClearStashesDialog.value = false
}

const cancelClearStashes = () => {
  showClearStashesDialog.value = false
}

// Worktree handlers
const switchWorktree = (path: string) => {
  send({ type: 'commit.WORKTREE_SWITCH', path })
}

const addWorktree = () => {
  const branch = newWorktreeBranch.value.trim()
  const wtPath = newWorktreePath.value.trim()
  if (!branch || !wtPath) return
  send({
    type: 'commit.WORKTREE_ADD',
    path: wtPath,
    branch,
    createBranch: createNewWorktreeBranch.value
  })
  showWorktreeAddForm.value = false
  newWorktreeBranch.value = ''
  newWorktreePath.value = ''
}

const cancelAddWorktree = () => {
  showWorktreeAddForm.value = false
  newWorktreeBranch.value = ''
  newWorktreePath.value = ''
}

const openRemoveWorktreeDialog = (path: string) => {
  pendingRemoveWorktreePath.value = path
  showRemoveWorktreeDialog.value = true
}

const confirmRemoveWorktree = () => {
  if (pendingRemoveWorktreePath.value) {
    send({ type: 'commit.WORKTREE_REMOVE', path: pendingRemoveWorktreePath.value })
  }
  showRemoveWorktreeDialog.value = false
  pendingRemoveWorktreePath.value = null
}

const cancelRemoveWorktree = () => {
  showRemoveWorktreeDialog.value = false
  pendingRemoveWorktreePath.value = null
}

const formatWorktreePath = (fullPath: string) => {
  const parts = fullPath.split('/')
  return parts.slice(-2).join('/')
}

const startAddWorktree = () => {
  showWorktreeAddForm.value = true
  newWorktreeBranch.value = ''
  newWorktreePath.value = ''
  createNewWorktreeBranch.value = true
}

// Auto-populate worktree path from branch name
watch(newWorktreeBranch, (branch) => {
  if (!showWorktreeAddForm.value) return
  const base = baseDirectory.value || ''
  const parent = base.substring(0, base.lastIndexOf('/'))
  if (!branch.trim()) {
    newWorktreePath.value = ''
    return
  }
  const sanitized = branch.trim().replace(/[/\\]/g, '-')
  newWorktreePath.value = parent ? `${parent}/${sanitized}` : sanitized
})

const hideBranchDropdown = () => {
  // Small delay to allow click events to fire
  clearTimeout(branchDropdownHideTimer)
  branchDropdownHideTimer = setTimeout(() => {
    showBranchDropdown.value = false
    highlightedBranchIndex.value = -1
  }, 200)
}

const handleBranchArrowDown = () => {
  if (!showBranchDropdown.value) {
    showBranchDropdown.value = true
    highlightedBranchIndex.value = 0
    return
  }
  const max = filteredBranches.value.length - 1
  highlightedBranchIndex.value = highlightedBranchIndex.value < max ? highlightedBranchIndex.value + 1 : 0
}

const handleBranchArrowUp = () => {
  if (!showBranchDropdown.value) return
  const max = filteredBranches.value.length - 1
  highlightedBranchIndex.value = highlightedBranchIndex.value > 0 ? highlightedBranchIndex.value - 1 : max
}

const handleBranchEnter = () => {
  if (showBranchDropdown.value && highlightedBranchIndex.value >= 0 && highlightedBranchIndex.value < filteredBranches.value.length) {
    selectBranch(filteredBranches.value[highlightedBranchIndex.value])
  } else {
    checkoutBranch()
  }
}

const handleBranchEscape = () => {
  if (showBranchDropdown.value) {
    showBranchDropdown.value = false
    highlightedBranchIndex.value = -1
  }
}

// Helper functions
const formatStashMessage = (stash: any) => {
  if (stash.message) {
    // Strip the "On branch: " or "WIP on branch:" prefix that git adds
    const cleaned = stash.message
      .replace(/^On \S+:\s*/, '')
      .replace(/^WIP on \S+\s*/, '')
    return cleaned || `stash@{${stash.index}}`
  }
  return `stash@{${stash.index}}`
}

const formatStashBranch = (message: string) => {
  // Extract branch name from "On branch:" or "WIP on branch" prefix
  const match = message?.match(/^(?:On|WIP on)\s+(\S+?)[:,\s]/)
  return match ? match[1] : 'unknown'
}

const formatStashDate = (dateStr: string) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Trigger initial load when panel is mounted
// Git watcher will handle subsequent updates
refreshStatus()
// Also get available branches and stash list
send({ type: 'commit.GET_ALL_BRANCHES' })
send({ type: 'commit.STASH_LIST' })
send({ type: 'commit.WORKTREE_LIST' })
</script>

<style scoped>
.commit-message::placeholder {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sync-feedback-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.sync-feedback-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.sync-feedback-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.sync-feedback-leave-to {
  opacity: 0;
  transform: translateY(2px);
}
</style>

