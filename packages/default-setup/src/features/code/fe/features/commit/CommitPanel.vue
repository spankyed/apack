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
      :show="!!revertDialogFile"
      :file="revertDialogFile"
      undoable
      :notKept="revertDialogFile ? notKeptOf([revertDialogFile.path]) : []"
      @confirm="confirmRevert"
      @cancel="cancelRevert"
    />

    <!-- Discard All Dialog -->
    <RevertDialog
      :show="showDiscardAllDialog"
      :file="null"
      :fileCount="unstagedFiles.length"
      undoable
      :notKept="notKeptOf(unstagedFiles.map((f: GitStatusFile) => f.path))"
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
      :customTitle="`Abort the ${operation?.kind ?? 'operation'}`"
      :customMessage="`Give up the ${operation?.kind ?? 'operation'} in progress? The repository goes back to where it was before it began, and what was settled in it so far is lost.`"
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
      <div v-if="isCreatingBranch" class="flex items-center gap-1.5">
        <input
          ref="newBranchInput"
          v-model="newBranchName"
          @keyup.enter="confirmCreateBranch"
          @keyup.escape="cancelCreateBranch"
          placeholder="New branch name..."
          class="flex-1 min-w-0 px-3 py-1.5 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
        />
        <button
          @click="confirmCreateBranch"
          :disabled="!newBranchName.trim()"
          class="p-1.5 rounded transition-colors text-green-400 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Create branch"
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
            v-model="branchInput"
            @input="updateBranchInput"
            @keydown.enter.prevent="handleBranchEnter"
            @keydown.arrow-down.prevent="handleBranchArrowDown"
            @keydown.arrow-up.prevent="handleBranchArrowUp"
            @keydown.escape="handleBranchEscape"
            @focus="showBranchDropdown = true; highlightedBranchIndex = -1"
            @blur="hideBranchDropdown"
            :disabled="isCheckingOutBranch"
            :placeholder="gitBranch || 'Select branch...'"
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
          @click="commitsAhead > 0 ? commitActor?.send({ type: 'commit.PUSH_BRANCH' }) : commitActor?.send({ type: 'commit.PULL_BRANCH' })"
          :disabled="isPulling || isPushing || !hasUpstream"
          class="relative p-1 rounded transition-colors text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
          :title="commitsAhead > 0 ? 'Push' : 'Pull latest'"
        >
          <Loader2 v-if="isPulling || isPushing" :size="14" class="animate-spin" />
          <ArrowUpFromLine v-else-if="commitsAhead > 0" :size="14" />
          <ArrowDownToLine v-else :size="14" />
          <span
            v-if="commitsAhead > 0"
            class="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold leading-none text-white bg-green-600 rounded-full"
          >{{ commitsAhead }}</span>
          <span
            v-else-if="commitsBehind > 0"
            class="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold leading-none text-white bg-blue-600 rounded-full"
          >{{ commitsBehind }}</span>
        </button>

        <!-- Sync feedback popover -->
        <Transition name="sync-feedback">
          <div
            v-if="syncFeedback"
            class="absolute top-full mt-1 right-0 px-2 py-1 text-[11px] font-medium rounded shadow-lg whitespace-nowrap pointer-events-none z-20"
            :class="syncFeedback.includes('Already') || syncFeedback.includes('Nothing')
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
              'px-3 py-2 cursor-pointer flex items-center gap-2',
              index === highlightedBranchIndex ? 'bg-neutral-800' : 'hover:bg-neutral-800'
            ]"
          >
            <GitBranch :size="12" class="text-neutral-400" />
            <span class="text-xs text-neutral-300">{{ branch }}</span>
            <CheckCircle v-if="branch === gitBranch" :size="12" class="ml-auto text-green-500" />
          </div>
        </div>
      </div>
    </div>

    <!-- The repository's file watches are not open, so nothing here changes until it is asked again -->
    <div
      v-if="!isWatchingRepository && !gitError"
      class="px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      Live updates are off for this repository. It is read again when you return to this window or press Refresh.
    </div>

    <!-- Fetching by itself has stopped, so what is shown of the remote is as old as the last fetch that worked -->
    <div
      v-if="isFetchSuspended && !gitError"
      class="px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      Fetching by itself is off: the remote asked for a sign-in and nobody was there to give one. It starts again after a push or a pull that works, or when the fetch settings change.
      <SignInHelp v-if="fetchSignIn" class="mt-2" :help="fetchSignIn" :busy="isSettingUpSignIn" @sign-in="setUpSignIn" />
    </div>

    <!-- A discard kept what it removed, which is offered back until it is dismissed -->
    <div
      v-if="lastDiscard && !gitError"
      data-testid="discard-undo"
      class="flex items-center gap-2 px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      <span class="flex-1">
        Discarded {{ lastDiscard.paths.length === 1 ? lastDiscard.paths[0] : `${lastDiscard.paths.length} changes` }}. What was removed is kept for 14 days.
        <template v-if="lastDiscard.notKept.length > 0">
          {{ lastDiscard.notKept.length === 1 ? 'One file was' : `${lastDiscard.notKept.length} files were` }} too large to keep.
        </template>
      </span>
      <button class="px-2 py-0.5 rounded text-neutral-200 bg-neutral-800 hover:bg-neutral-700" @click="commitActor?.send({ type: 'commit.UNDO_DISCARD' })">Undo</button>
      <button class="p-0.5 rounded hover:bg-neutral-700" title="Dismiss" @click="commitActor?.send({ type: 'commit.DISMISS_DISCARD' })"><X :size="12" /></button>
    </div>

    <!-- Undoing a discard left alone what had changed or been made again since -->
    <div
      v-else-if="discardLeft.length > 0 && !gitError"
      data-testid="discard-left"
      class="flex items-center gap-2 px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      <span class="flex-1">
        Put back, except {{ discardLeft.length === 1 ? discardLeft[0] : `${discardLeft.length} files` }}, which {{ discardLeft.length === 1 ? 'has' : 'have' }} changed since and {{ discardLeft.length === 1 ? 'was' : 'were' }} left as {{ discardLeft.length === 1 ? 'it is' : 'they are' }}.
      </span>
      <button class="p-0.5 rounded hover:bg-neutral-700" title="Dismiss" @click="commitActor?.send({ type: 'commit.DISMISS_DISCARD' })"><X :size="12" /></button>
    </div>

    <!-- The repository has more changed files than are listed -->
    <div
      v-if="isStatusTruncated && !gitError"
      class="px-3 py-2 text-xs border-b border-neutral-800 text-neutral-400"
    >
      Too many changes to list them all. Showing the first {{ gitStatus.length.toLocaleString() }}.
    </div>

    <!-- Git is in the middle of something, which ends when it is carried on with or given up -->
    <div v-if="operation" class="px-3 py-2 border-b border-neutral-800 bg-orange-900/10" data-testid="repository-operation">
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
          v-if="operation.kind === 'rebase'"
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
    <TrustRequest v-if="trustRequest" :request="trustRequest" @trust="commitActor?.send({ type: 'commit.TRUST_REPOSITORY' })" />
    <OwnershipRequest v-if="ownershipRequest" :directory="ownershipRequest.directory" @trust="commitActor?.send({ type: 'commit.TRUST_OWNERSHIP' })" />

    <!-- Git Error (only show non-directory errors) -->
    <div v-else-if="gitError && !isNoDirectoryError" class="p-3 border-b border-red-800 bg-red-900/20">
      <div class="flex items-start gap-2">
        <div
          ref="errorContentRef"
          class="flex-1 text-sm text-red-400 whitespace-pre-wrap break-words"
          :class="{ 'max-h-24 overflow-hidden': !isErrorExpanded }"
        >{{ gitError }}</div>
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
                :disabled="gitStatus.length === 0 && !isStashing"
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
            <label :class="['text-sm transition-colors', isGeneratingMessage ? 'text-amber-400/70 animate-pulse' : 'text-neutral-400']">
              {{ isGeneratingMessage ? 'Generating...' : 'Commit Message' }}
            </label>
          </div>
          <button
            :disabled="isGeneratingMessage"
            class="p-1 rounded transition-colors text-neutral-400 hover:text-amber-400 disabled:cursor-not-allowed"
            title="Generate commit message"
            @click="generateMessage"
          >
            <Loader2 v-if="isGeneratingMessage" :size="14" class="animate-spin text-amber-400" />
            <Sparkles v-else :size="14" />
          </button>
        </div>
        <textarea
          ref="commitTextarea"
          v-model="commitMessage"
          @input="updateCommitMessage"
          :placeholder="`Message (currently on ${gitBranch || 'unknown'})`"
          :class="[
            'w-full px-3 py-2 text-sm border rounded resize-none overflow-y-auto bg-neutral-900 text-neutral-100 placeholder-neutral-500 focus:outline-none commit-message transition-colors',
            isGeneratingMessage ? 'border-amber-400/30 animate-pulse' : 'border-neutral-700 focus:border-neutral-600'
          ]"
          style="max-height: 200px"
          rows="4"
        />
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
          @click="commitActor?.send({ type: 'commit.STOP_PUSH' })"
        >
          Stop pushing
        </button>

        <button
          v-else
          @click="commit"
          :disabled="!canCommit"
          :class="[
            'w-full px-3 py-1.5 rounded text-sm font-medium transition-colors',
            canCommit
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
          ]"
        >
          Commit
        </button>
      </div>
    </div>

    <!-- File Changes -->
    <div class="flex-1 overflow-y-auto">
      <!-- Nothing is known of a repository git was not run in, so it is not said to be clean -->
      <div v-if="gitNeverRan && gitStatus.length === 0" />
      <EmptyState
        v-else-if="gitStatus.length === 0"
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
              :isSelected="selectedGitFile?.path === file.path && selectedGitFile?.staged === file.staged"
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
              :isSelected="selectedGitFile?.path === file.path"
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
                :isSelected="selectedGitFile?.path === file.path && selectedGitFile?.staged === file.staged"
                @select="file.isDirectory ? toggleFolder(file) : selectFile(file)"
                @openFile="openFile"
              >
                <template v-if="file.isDirectory" #prefix>
                  <component :is="openFolders[file.path] ? ChevronDown : ChevronRight" :size="12" class="text-neutral-500 flex-shrink-0" />
                  <Folder :size="12" class="text-neutral-400 flex-shrink-0" />
                </template>
                <!-- Set in from the folder's row, by the width of its arrow and icon -->
                <template v-else-if="file.inFolder" #prefix>
                  <span class="w-7 flex-shrink-0" />
                </template>
                <template #actions>
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
                  <ContextMenuItem @select="openRevertDialog(file)" :class="MENU_ITEM_DANGER_CLASS">
                    <RotateCcw class="w-4 h-4" /> Discard Changes
                  </ContextMenuItem>
                </template>
              </GitFileItem>
              <div v-if="file.isDirectory && openFolders[file.path]?.truncated" class="ml-4 px-2 py-1 text-xs text-neutral-500">
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
      v-if="codeSettings?.showStashes && stashList.length > 0 && isStashesExpanded"
      orientation="vertical"
      subtle
      @resize="onStashResize"
    />

    <!-- Stashes Section -->
    <div v-if="codeSettings?.showStashes && stashList.length > 0" class="flex-shrink-0 border-t border-neutral-800" @contextmenu.prevent="onSectionContextMenu">
      <div class="flex items-center justify-between p-3 px-5 cursor-pointer hover:bg-neutral-800/60 transition-colors" @click="isStashesExpanded = !isStashesExpanded">
        <div class="flex items-center gap-1 text-xs font-medium text-neutral-400">
          <ChevronRight v-if="!isStashesExpanded" class="w-3 h-3" />
          <ChevronDown v-else class="w-3 h-3" />
          STASHES ({{ stashSearchQuery.trim() ? `${filteredStashes.length}/` : '' }}{{ stashList.length }})
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
            class="group px-2 py-1.5 rounded hover:bg-neutral-800/50 transition-colors cursor-pointer"
            @click="applyStash(stash.index)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <div class="flex-1 min-w-0">
                <div class="text-xs text-neutral-200 truncate">{{ formatStashMessage(stash) }}</div>
                <div class="text-[11px] text-neutral-500 truncate">{{ stash.ref }} · {{ formatStashBranch(stash.message) }} · {{ formatStashDate(stash.date) }}</div>
              </div>
              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button @click.stop="copyStashMessage(stash)" class="p-0.5 hover:bg-neutral-700 rounded" title="Copy message">
                  <Copy class="w-3 h-3 text-neutral-400" />
                </button>
                <button @click.stop="popStash(stash.index)" class="p-0.5 hover:bg-neutral-700 rounded" title="Pop (apply & remove)">
                  <ArrowDownToLine class="w-3 h-3 text-neutral-400" />
                </button>
                <button @click.stop="openDropStashDialog(stash.index)" class="p-0.5 hover:bg-neutral-700 rounded" title="Drop">
                  <Trash2 class="w-3 h-3 text-red-400" />
                </button>
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
      :customMessage="'Are you sure you want to drop this stash? This action cannot be undone.'"
      @confirm="confirmDropStash"
      @cancel="cancelDropStash"
    />

    <!-- Clear All Stashes Dialog -->
    <RevertDialog
      :show="showClearStashesDialog"
      :file="null"
      :customTitle="'Clear All Stashes'"
      :customMessage="'Are you sure you want to clear all stashes? This action cannot be undone.'"
      @confirm="confirmClearStashes"
      @cancel="cancelClearStashes"
    />

    <!-- Worktrees Section -->
    <div v-if="codeSettings?.showWorktrees && worktreeList.length > 0" class="flex-shrink-0 border-t border-neutral-800" @contextmenu.prevent="onSectionContextMenu">
      <div class="flex items-center justify-between p-3 px-5 cursor-pointer hover:bg-neutral-800/60 transition-colors" @click="isWorktreesExpanded = !isWorktreesExpanded">
        <div class="flex items-center gap-1 text-xs font-medium text-neutral-400">
          <ChevronRight v-if="!isWorktreesExpanded" class="w-3 h-3" />
          <ChevronDown v-else class="w-3 h-3" />
          WORKTREES ({{ worktreeList.length }})
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
            v-for="wt in worktreeList"
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

import { computed, ref, nextTick, watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { useSurface, useShell } from '@apackdev/sdk/fe'
import type { CodeState } from '#features/code/fe/state.ts'
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts'
import type { ConflictKind, OperationMove } from '#features/code/be/types.ts'
import { Folder, GitBranch, GitBranchPlus, GitCommit, GitFork, GitMerge, RefreshCw, Plus, Minus, RotateCcw, ChevronDown, ChevronRight, CheckCircle, Check, X, Sparkles, Loader2, ArrowDownToLine, ArrowUpFromLine, MoreVertical, Trash2, Copy, Search, FolderSync, Lock } from 'lucide-vue-next'
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
import { panelChild } from '../children.ts';

// Get actors
const shell = useShell()
const codeActor: CodeState = useSurface()
const commitActor = panelChild(codeActor, 'commit')!

// Settings from code actor
const codeSettings = useSelector(codeActor, (state) => state.context.settings)

// Section visibility context menu
const { showMenu, menuPos, sectionMenuItems, onSectionContextMenu } = useSectionVisibilityMenu(codeSettings)

// State selectors from commit actor
const gitStatus = useSelector(commitActor, (state) => state.context.gitStatus)
const gitBranch = useSelector(commitActor, (state) => state.context.gitBranch)
const gitError = useSelector(commitActor, (state) => state.context.gitError)
const isGitLoading = useSelector(commitActor, (state) => state.context.isGitLoading)
const selectedGitFile = useSelector(commitActor, (state) => state.context.selectedGitFile)
const commitMessage = useSelector(commitActor, (state) => state.context.commitMessage)
const revertDialogFile = useSelector(commitActor, (state) => state.context.revertDialogFile)
const discardPreview = useSelector(commitActor, (state) => state.context.discardPreview)
const lastDiscard = useSelector(commitActor, (state) => state.context.lastDiscard)
const discardLeft = useSelector(commitActor, (state) => state.context.discardLeft)
/** What discarding these rows would remove that cannot be brought back, once that has been answered for these rows */
const notKeptOf = (paths: string[]): string[] =>
  (discardPreview.value && discardPreview.value.paths.join('\0') === paths.join('\0') ? discardPreview.value.notKept : [])
const availableBranches = useSelector(commitActor, (state) => state.context.availableBranches)
const branchInput = useSelector(commitActor, (state) => state.context.branchInput)
const isCheckingOutBranch = useSelector(commitActor, (state) => state.context.isCheckingOutBranch)
const hasUpstream = useSelector(commitActor, (state) => state.context.hasUpstream)
const isStatusTruncated = useSelector(commitActor, (state) => state.context.isStatusTruncated)
const isWatchingRepository = useSelector(commitActor, (state) => state.context.isWatchingRepository)
const operation = useSelector(commitActor, (state) => state.context.operation)
const isFetchSuspended = useSelector(commitActor, (state) => state.context.isFetchSuspended)
const fetchSignIn = useSelector(commitActor, (state) => state.context.fetchSignIn)
const isSettingUpSignIn = useSelector(commitActor, (state) => state.context.isSettingUpSignIn)
// The help belongs to the error it came with, and goes when that error does
const errorSignIn = useSelector(commitActor, (state) => (state.context.gitError ? state.context.gitFailure?.signIn ?? null : null))
// The refusal belongs to the error it came with, and goes when that error does
const trustRequest = useSelector(commitActor, (state) => (state.context.gitError ? state.context.gitFailure?.trust ?? null : null))
const ownershipRequest = useSelector(commitActor, (state) => (state.context.gitError ? state.context.gitFailure?.ownership ?? null : null))
/** The failures for which git read nothing, so the panel says nothing of the working tree */
const NOTHING_READ = new Set(['untrusted', 'unsafe-ownership', 'git-not-found', 'developer-tools-missing', 'git-too-old'])
const gitNeverRan = useSelector(commitActor, (state) => !!state.context.gitError && NOTHING_READ.has(state.context.gitFailure?.code ?? ''))
const isMovingOperation = useSelector(commitActor, (state) => state.context.isMovingOperation)
const commitsAhead = useSelector(commitActor, (state) => state.context.commitsAhead)
const commitsBehind = useSelector(commitActor, (state) => state.context.commitsBehind)
const isPushing = useSelector(commitActor, (state) => state.context.isPushing)
const isPulling = useSelector(commitActor, (state) => state.context.isPulling)
const isGeneratingMessage = useSelector(commitActor, (state) => state.context.isGeneratingMessage)
const stashList = useSelector(commitActor, (state) => state.context.stashList)
const isStashing = useSelector(commitActor, (state) => state.context.isStashing)
const worktreeList = useSelector(commitActor, (state) => state.context.worktreeList)
const isWorktreeLoading = useSelector(commitActor, (state) => state.context.isWorktreeLoading)
const baseDirectory = useSelector(codeActor, (state) => state.context.baseDirectory)

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
  noopMessage: string
) => {
  let snapshotCount = 0
  watch(flag, (active, wasActive) => {
    if (active) {
      snapshotCount = getCount()
      clearTimeout(syncClearTimer)
      syncFeedback.value = null
    } else if (wasActive) {
      if (gitError.value) {
        toast.value?.error(`${label} failed`, gitError.value)
      } else {
        showSyncFeedback(snapshotCount > 0
          ? `${label}ed ${snapshotCount} commit${snapshotCount !== 1 ? 's' : ''}`
          : noopMessage)
      }
    }
  })
}

const setUpSignIn = (host: string) => {
  commitActor.send({ type: 'commit.SET_UP_SIGN_IN', host })
}

const dismissError = () => {
  commitActor.send({ type: 'commit.DISMISS_ERROR' })
  isErrorExpanded.value = false
}

watch(gitError, () => {
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

watchSyncOp(isPulling, () => commitsBehind.value, 'Pull', 'Already up to date')
watchSyncOp(isPushing, () => commitsAhead.value, 'Push', 'Nothing to push')

watch(commitMessage, (val) => {
  if (!val && commitTextarea.value) {
    commitTextarea.value.style.height = ''
  }
})

// Computed
const stagedFiles = computed(() => gitStatus.value.filter((f: any) => f.staged))
const mergeConflictFiles = computed(() => gitStatus.value.filter((f: any) => f.status === 'unmerged'))
const unstagedFiles = computed(() => gitStatus.value.filter((f: any) => !f.staged && f.status !== 'unmerged'))
const openFolders = useSelector(commitActor, (state) => state.context.openFolders)
/** The unstaged rows as they are drawn: each open folder's row is followed by a row for each file it lists */
const unstagedRows = computed(() => unstagedFiles.value.flatMap((file: GitStatusFile): (GitStatusFile & { inFolder?: boolean })[] => {
  const open = file.isDirectory ? openFolders.value[file.path] : undefined
  return [file, ...(open?.files ?? []).map(path => ({ path, status: 'untracked' as const, staged: false, inFolder: true }))]
}))
const toggleFolder = (file: GitStatusFile) => commitActor?.send({ type: 'commit.TOGGLE_FOLDER', path: file.path })
const canCommit = computed(() => commitMessage.value.trim() && stagedFiles.value.length > 0)

const isNoDirectoryError = computed(() => {
  return gitError.value?.includes('No directory selected')
})

const isNoGitRepoError = computed(() => {
  return gitError.value?.includes('not a git repository') ||
         gitError.value?.includes('Not a git repository')
})

const shouldShowActionButton = computed(() => {
  // Commit button takes priority when there are staged files
  if (stagedFiles.value.length > 0) return false
  return !hasUpstream.value || commitsAhead.value > 0 || commitsBehind.value > 0
})

const progress = useSelector(commitActor, (state) => state.context.progress)
/** How far along git says it is, once it has said: `Writing objects 42%` */
const progressOf = (during: 'push' | 'pull') => (progress.value?.during === during ? ` ${progress.value.stage} ${progress.value.percent}%` : '...')
const actionButtonText = computed(() => {
  if (isPushing.value) return `Pushing${progressOf('push')}`
  if (isPulling.value) return `Pulling${progressOf('pull')}`
  if (!hasUpstream.value) return 'Publish Branch'

  // If we have both commits ahead and behind, prioritize pull
  if (commitsBehind.value > 0 && commitsAhead.value === 0) {
    return `Pull (${commitsBehind.value} commit${commitsBehind.value !== 1 ? 's' : ''} behind)`
  }

  if (commitsAhead.value > 0) {
    return `Push (${commitsAhead.value} commit${commitsAhead.value !== 1 ? 's' : ''})`
  }

  return 'Sync'
})

const isActionButtonPull = computed(() => {
  return hasUpstream.value && commitsBehind.value > 0 && commitsAhead.value === 0
})

const isActionButtonDisabled = computed(() => {
  return isPushing.value || isPulling.value
})

const filteredBranches = computed(() => {
  const input = branchInput.value.toLowerCase().trim()
  if (!input) return availableBranches.value
  return availableBranches.value.filter((branch: string) =>
    branch.toLowerCase().includes(input)
  )
})

const filteredStashes = computed(() => {
  const query = stashSearchQuery.value.trim()
  if (!query) return stashList.value
  const lowerQuery = query.toLowerCase()
  return stashList.value.filter((stash: any) => {
    const text = `${stash.ref} ${stash.message}`.toLowerCase()
    return text.includes(lowerQuery)
  })
})

// Event handlers
const refreshStatus = () => {
  commitActor?.send({ type: 'commit.REFRESH_STATUS' })
}

const selectFile = (file: GitStatusFile) => {
  shell.restoreChat()
  commitActor?.send({ type: 'commit.SELECT_FILE', file })
  commitActor?.send({ type: 'commit.VIEW_DIFF', path: file.path, staged: file.staged })
}

const stageFile = (file: GitStatusFile) => {
  commitActor?.send({ type: 'commit.STAGE_FILES', paths: [file.path] })
}

const unstageFile = (file: GitStatusFile) => {
  commitActor?.send({ type: 'commit.UNSTAGE_FILES', paths: [file.path] })
}

const generateMessage = () => {
  commitActor?.send({ type: 'commit.GENERATE_MESSAGE' })
}

const updateCommitMessage = (event: Event) => {
  const target = event.target as HTMLTextAreaElement
  target.style.height = 'auto'
  target.style.height = `${Math.min(target.scrollHeight, 200)}px`
  commitActor?.send({ type: 'commit.UPDATE_MESSAGE', message: target.value })
}

const commit = () => {
  if (canCommit.value) {
    commitActor?.send({ type: 'commit.COMMIT' })
  }
}

const handleActionButton = () => {
  if (isActionButtonPull.value) {
    commitActor?.send({ type: 'commit.PULL_BRANCH' })
  } else {
    commitActor?.send({ type: 'commit.PUSH_BRANCH' })
  }
}

const stageAll = () => {
  commitActor?.send({ type: 'commit.STAGE_FILES', paths: unstagedFiles.value.map((f: GitStatusFile) => f.path) })
}

const unstageAll = () => {
  commitActor?.send({ type: 'commit.UNSTAGE_FILES', paths: stagedFiles.value.map((f: GitStatusFile) => f.path) })
}

const openDiscardAllDialog = () => {
  commitActor?.send({ type: 'commit.PREVIEW_DISCARD', paths: unstagedFiles.value.map((f: GitStatusFile) => f.path) })
  showDiscardAllDialog.value = true
}

const confirmDiscardAll = () => {
  commitActor?.send({ type: 'commit.REVERT_FILES', paths: unstagedFiles.value.map((f: GitStatusFile) => f.path) })
  showDiscardAllDialog.value = false
}

const cancelDiscardAll = () => {
  showDiscardAllDialog.value = false
}

const acceptOurs = (file: GitStatusFile) => {
  commitActor?.send({ type: 'commit.RESOLVE_CONFLICT', path: file.path, strategy: 'ours' })
}

const acceptTheirs = (file: GitStatusFile) => {
  commitActor?.send({ type: 'commit.RESOLVE_CONFLICT', path: file.path, strategy: 'theirs' })
}

const markResolved = (file: GitStatusFile) => {
  commitActor?.send({ type: 'commit.MARK_RESOLVED', path: file.path })
}

const markAllResolved = () => {
  commitActor?.send({ type: 'commit.STAGE_FILES', paths: mergeConflictFiles.value.map((f: GitStatusFile) => f.path) })
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
  const current = operation.value
  if (!current) return ''
  switch (current.kind) {
    case 'merge': return `Merging ${current.subject}${gitBranch.value && gitBranch.value !== 'HEAD' ? ` into ${gitBranch.value}` : ''}`
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
  commitActor?.send({ type: 'commit.MOVE_OPERATION', move })
}
const confirmAbortOperation = () => {
  showAbortOperationDialog.value = false
  moveOperation('abort')
}

const confirmDiscardAllMerge = () => {
  commitActor?.send({ type: 'commit.RESOLVE_ALL_CONFLICTS', strategy: 'ours' })
  showDiscardAllMergeDialog.value = false
}

const openRevertDialog = (file: GitStatusFile) => {
  commitActor?.send({ type: 'commit.TOGGLE_REVERT_DIALOG', file })
}

const confirmRevert = () => {
  commitActor?.send({ type: 'commit.REVERT_FILE', path: revertDialogFile.value!.path })
}

const cancelRevert = () => {
  commitActor?.send({ type: 'commit.TOGGLE_REVERT_DIALOG' })
}

const openFile = (file: GitStatusFile) => {
  shell.restoreChat()
  commitActor?.send({ type: 'commit.OPEN_FILE', file })
}

const updateBranchInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  commitActor?.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: target.value })
  highlightedBranchIndex.value = -1
}

const checkoutBranch = () => {
  if (branchInput.value.trim() && !isCheckingOutBranch.value) {
    commitActor?.send({ type: 'commit.CHECKOUT_BRANCH' })
    showBranchDropdown.value = false
  }
}

const selectBranch = (branch: string) => {
  commitActor?.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: branch })
  commitActor?.send({ type: 'commit.CHECKOUT_BRANCH' })
  showBranchDropdown.value = false
  commitActor?.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: '' })
}

const startCreateBranch = () => {
  isCreatingBranch.value = true
  nextTick(() => newBranchInput.value?.focus())
}

const confirmCreateBranch = () => {
  const name = newBranchName.value.trim()
  if (!name) return
  commitActor?.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: name })
  commitActor?.send({ type: 'commit.CHECKOUT_BRANCH' })
  isCreatingBranch.value = false
  newBranchName.value = ''
  commitActor?.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: '' })
}

const cancelCreateBranch = () => {
  isCreatingBranch.value = false
  newBranchName.value = ''
}

// Stash handlers
const hideStashMenu = () => {
  setTimeout(() => {
    showStashMenu.value = false
  }, 200)
}

const stashAll = () => {
  showStashMenu.value = false
  commitActor?.send({ type: 'commit.STASH_PUSH', message: commitMessage.value || undefined, stagedOnly: false })
}

const stashStaged = () => {
  showStashMenu.value = false
  commitActor?.send({ type: 'commit.STASH_PUSH', message: commitMessage.value || undefined, stagedOnly: true })
}

const applyStash = (index: number) => {
  commitActor?.send({ type: 'commit.STASH_APPLY', index })
}

const popStash = (index: number) => {
  commitActor?.send({ type: 'commit.STASH_POP', index })
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
    commitActor?.send({ type: 'commit.STASH_DROP', index: pendingDropIndex.value })
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
  commitActor?.send({ type: 'commit.STASH_CLEAR' })
  showClearStashesDialog.value = false
}

const cancelClearStashes = () => {
  showClearStashesDialog.value = false
}

// Worktree handlers
const switchWorktree = (path: string) => {
  commitActor?.send({ type: 'commit.WORKTREE_SWITCH', path })
}

const addWorktree = () => {
  const branch = newWorktreeBranch.value.trim()
  const wtPath = newWorktreePath.value.trim()
  if (!branch || !wtPath) return
  commitActor?.send({
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
    commitActor?.send({ type: 'commit.WORKTREE_REMOVE', path: pendingRemoveWorktreePath.value })
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
  setTimeout(() => {
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
commitActor?.send({ type: 'commit.GET_ALL_BRANCHES' })
commitActor?.send({ type: 'commit.STASH_LIST' })
commitActor?.send({ type: 'commit.WORKTREE_LIST' })
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

