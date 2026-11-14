import {Composition} from 'remotion';
import {AgentBuddyFilm, AgentBuddyFilmSquare} from './film/AgentBuddyFilm';
import {AgentBuddyFilmSimple, AgentBuddyFilmSimpleSquare} from './film/simple/SimpleFilm';
import {totalFrames} from './film/state/timeline';
import {simpleTotalFrames} from './film/simple/timeline';
import './global.css';
import {
  ActionDetailDemo,
  ActionCollapsedSectionsDemo,
  ActionCreateDemo,
  ActionsEmptyDemo,
  ActionsFilteredDemo,
  ActionsListDemo,
  ActionsLoadingMoreDemo,
  ActionsSurfaceDemo,
  BrainEmptyEventsDemo,
  BrainNestedFlowDemo,
  BoardSurfaceDemo,
  BrowserAutocompleteDemo,
  BrowserSurfaceDemo,
  CalendarDayDemo,
  CalendarDayPickerDemo,
  CalendarDialogDemo,
  CalendarMonthDemo,
  CalendarMonthPickerDemo,
  BrainPausedDemo,
  BrainStoppedDemo,
  BrainSurfaceDemo,
  CodeSurfaceDemo,
  ChatSurfaceDemo,
  ChatComposerCommandSuggestionDemo,
  ChatComposerCommandSuggestionEmptyDemo,
  ChatComposerDemo,
  ChatComposerActiveThreadRenameDemo,
  ChatComposerInputStatesDemo,
  ChatComposerMixedAttachmentsDemo,
  ChatComposerModeMenuDemo,
  ChatComposerNewThreadChildMenuDemo,
  ChatComposerNewThreadProjectMenuDemo,
  ChatComposerPhaseMenuDemo,
  ChatComposerQuickPromptsEditingDemo,
  ChatComposerRevertActionsDemo,
  ChatComposerRevertHistoryDemo,
  ChatComposerReferenceEmptyStatesDemo,
  ChatComposerReferenceCategoriesDemo,
  ChatComposerReferenceFilteredCategoriesDemo,
  ChatComposerReferenceItemTypesDemo,
  ChatComposerReferencePillsDemo,
  ChatComposerRecentThreadsDemo,
  ChatComposerRecentThreadsEmptyDemo,
  ChatComposerRecentThreadsRenameDemo,
  ChatComposerReferencesDemo,
  ChatComposerStatusLineDemo,
  ChatComposerWithAttachmentDemo,
  CodeReviewDemo,
  ContentBlocksDemo,
  FullMarkdownViewerDemo,
  DatabaseAiLoadingDemo,
  DatabaseAiPromptDemo,
  DatabaseExamplesDemo,
  DatabaseBackupExportDemo,
  DatabaseBackupImportDemo,
  DatabaseCopiedRowDemo,
  DatabaseEmptyArrayDemo,
  DatabaseErrorDemo,
  DatabaseGraphDemo,
  DatabaseObjectResultDemo,
  DatabasePrimitiveArrayDemo,
  DatabaseQueryDemo,
  DatabaseLoadingDemo,
  DatabaseSchemaNoResultsDemo,
  DatabaseSchemaRefreshingDemo,
  DatabaseSurfaceDemo,
  DatabaseTraceDemo,
  FlowCanvasDemo,
  FlowsListDemo,
  FlowsListMenuDemo,
  FlowsListSearchDemo,
  LogsFilteredDemo,
  LogsContextMenuDemo,
  LogsCopiedDemo,
  LogsCombinedContentDemo,
  LogsEmptyDemo,
  LogsHasMoreDemo,
  LogsListDemo,
  LogsNoMatchingDemo,
  LogsSurfaceDemo,
  FlowNodeFormDemo,
  FlowNodeVariantsDemo,
  FlowPaletteDemo,
  InteractionControlsDemo,
  InteractionBlocksDemo,
  KanbanComponentsDemo,
  LibraryBrokenSymlinkDemo,
  LibraryBrokenRowRelinkDemo,
  LibraryDocumentEditorCopiedCodeDemo,
  LibraryDocumentEditorDemo,
  LibraryBulkSelectionDemo,
  LibraryLoadingFolderDemo,
  LibraryRenameRowDemo,
  LibraryRowMenuDemo,
  LibrarySurfaceDemo,
  MessageBubbleDemo,
  NotesRightRailDemo,
  NotesRightRailMenuDemo,
  NotesRightRailSearchDemo,
  NotesRightRailTrashActionsDemo,
  NotesRightRailTrashDemo,
  NotesSurfaceDemo,
  PlanArtifactDemo,
  PullRequestCreateDemo,
  PullRequestDetailsDemo,
  PullRequestFilesDemo,
  PullRequestFilesLoadingDemo,
  PullRequestPanelDemo,
  PullRequestSelectorDemo,
  PullRequestSelectorEmptyDemo,
  PromptCreateDemo,
  PromptCollapsedSectionsDemo,
  PromptDetailDemo,
  PromptsEmptyDemo,
  PromptsFilteredDemo,
  PromptsListDemo,
  PromptsLoadingMoreDemo,
  PromptsSurfaceDemo,
  SettingsBrainPluginDemo,
  SettingsBrowserPluginDemo,
  SettingsActionsPluginDemo,
  SettingsApplicationDemo,
  SettingsCodePluginDemo,
  SettingsDatabasePluginDemo,
  SettingsFlowsPluginDemo,
  SettingsHelpDemo,
  SettingsHelpExpandedDemo,
  SettingsJsonDemo,
  SettingsLibraryPluginDemo,
  SettingsLogsPluginDemo,
  SettingsNotesPluginDemo,
  SettingsPersonalDemo,
  SettingsPluginsDemo,
  SettingsPluginsNoSelectionDemo,
  SettingsPromptsPluginDemo,
  SettingsProjectsDemo,
  SettingsProvidersDemo,
  SettingsResetConfirmDemo,
  SettingsResettingDemo,
  SettingsSetupPackErrorDemo,
  SettingsSetupPackPreviewingDemo,
  SettingsSetupPackSelectingDemo,
  SettingsSetupPackSuccessDemo,
  SettingsThreadsPluginDemo,
  SourceControlPanelDemo,
  TaskListPanelDemo,
  TaskListPanelMenuDemo,
  TaskListPanelRowMenuDemo,
  TerminalPanelDemo,
  ThreadsHeaderArchiveDemo,
  ThreadsHeaderDemo,
  ThreadsHeaderFilterDemo,
  ThreadsHeaderSearchDemo,
  ToolActivityDemo,
  ToolInputBlocksDemo,
  ToolbarDemo,
  WorkflowSurfaceDemo,
} from './compositions/demos';

const fps = 30;
const demoDuration = 240;

export const RemotionRoot = () => {
  return (
    <>
      <Composition id="AgentBuddyFilm" component={AgentBuddyFilm} durationInFrames={totalFrames} fps={fps} width={1440} height={900} />
      <Composition id="AgentBuddyFilmSquare" component={AgentBuddyFilmSquare} durationInFrames={totalFrames} fps={fps} width={1080} height={1080} />
      <Composition id="AgentBuddyFilmSimple" component={AgentBuddyFilmSimple} durationInFrames={simpleTotalFrames} fps={fps} width={1440} height={900} />
      <Composition id="AgentBuddyFilmSimpleSquare" component={AgentBuddyFilmSimpleSquare} durationInFrames={simpleTotalFrames} fps={fps} width={1080} height={1080} />
      <Composition id="ToolbarDemo" component={ToolbarDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ActionsListDemo" component={ActionsListDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ActionsEmptyDemo" component={ActionsEmptyDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ActionsFilteredDemo" component={ActionsFilteredDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ActionsLoadingMoreDemo" component={ActionsLoadingMoreDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ActionCreateDemo" component={ActionCreateDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ActionDetailDemo" component={ActionDetailDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ActionCollapsedSectionsDemo" component={ActionCollapsedSectionsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ActionsSurfaceDemo" component={ActionsSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="BrainSurfaceDemo" component={BrainSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="BrainPausedDemo" component={BrainPausedDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="BrainStoppedDemo" component={BrainStoppedDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="BrainEmptyEventsDemo" component={BrainEmptyEventsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="BrainNestedFlowDemo" component={BrainNestedFlowDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="BrowserSurfaceDemo" component={BrowserSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="BrowserAutocompleteDemo" component={BrowserAutocompleteDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="CalendarMonthDemo" component={CalendarMonthDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="CalendarDayDemo" component={CalendarDayDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="CalendarDialogDemo" component={CalendarDialogDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="CalendarMonthPickerDemo" component={CalendarMonthPickerDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="CalendarDayPickerDemo" component={CalendarDayPickerDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PromptsListDemo" component={PromptsListDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PromptsEmptyDemo" component={PromptsEmptyDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PromptsFilteredDemo" component={PromptsFilteredDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PromptsLoadingMoreDemo" component={PromptsLoadingMoreDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PromptCreateDemo" component={PromptCreateDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PromptDetailDemo" component={PromptDetailDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PromptCollapsedSectionsDemo" component={PromptCollapsedSectionsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PromptsSurfaceDemo" component={PromptsSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseQueryDemo" component={DatabaseQueryDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseExamplesDemo" component={DatabaseExamplesDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseAiPromptDemo" component={DatabaseAiPromptDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseAiLoadingDemo" component={DatabaseAiLoadingDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabasePrimitiveArrayDemo" component={DatabasePrimitiveArrayDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseObjectResultDemo" component={DatabaseObjectResultDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseCopiedRowDemo" component={DatabaseCopiedRowDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseSchemaNoResultsDemo" component={DatabaseSchemaNoResultsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseSchemaRefreshingDemo" component={DatabaseSchemaRefreshingDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseLoadingDemo" component={DatabaseLoadingDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseErrorDemo" component={DatabaseErrorDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseEmptyArrayDemo" component={DatabaseEmptyArrayDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseSurfaceDemo" component={DatabaseSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseBackupExportDemo" component={DatabaseBackupExportDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseBackupImportDemo" component={DatabaseBackupImportDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseTraceDemo" component={DatabaseTraceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="DatabaseGraphDemo" component={DatabaseGraphDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LogsListDemo" component={LogsListDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LogsEmptyDemo" component={LogsEmptyDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LogsNoMatchingDemo" component={LogsNoMatchingDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LogsFilteredDemo" component={LogsFilteredDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LogsContextMenuDemo" component={LogsContextMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LogsCopiedDemo" component={LogsCopiedDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LogsCombinedContentDemo" component={LogsCombinedContentDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LogsHasMoreDemo" component={LogsHasMoreDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LogsSurfaceDemo" component={LogsSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LibraryBrokenSymlinkDemo" component={LibraryBrokenSymlinkDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LibraryBrokenRowRelinkDemo" component={LibraryBrokenRowRelinkDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LibraryDocumentEditorCopiedCodeDemo" component={LibraryDocumentEditorCopiedCodeDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LibraryDocumentEditorDemo" component={LibraryDocumentEditorDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LibraryBulkSelectionDemo" component={LibraryBulkSelectionDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LibraryLoadingFolderDemo" component={LibraryLoadingFolderDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LibraryRenameRowDemo" component={LibraryRenameRowDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LibraryRowMenuDemo" component={LibraryRowMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="LibrarySurfaceDemo" component={LibrarySurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsApplicationDemo" component={SettingsApplicationDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsSetupPackPreviewingDemo" component={SettingsSetupPackPreviewingDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsSetupPackSelectingDemo" component={SettingsSetupPackSelectingDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsSetupPackSuccessDemo" component={SettingsSetupPackSuccessDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsSetupPackErrorDemo" component={SettingsSetupPackErrorDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsResetConfirmDemo" component={SettingsResetConfirmDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsResettingDemo" component={SettingsResettingDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsProvidersDemo" component={SettingsProvidersDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsProjectsDemo" component={SettingsProjectsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsPersonalDemo" component={SettingsPersonalDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsJsonDemo" component={SettingsJsonDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsPluginsDemo" component={SettingsPluginsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsPluginsNoSelectionDemo" component={SettingsPluginsNoSelectionDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsCodePluginDemo" component={SettingsCodePluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsDatabasePluginDemo" component={SettingsDatabasePluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsFlowsPluginDemo" component={SettingsFlowsPluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsLibraryPluginDemo" component={SettingsLibraryPluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsLogsPluginDemo" component={SettingsLogsPluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsBrainPluginDemo" component={SettingsBrainPluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsBrowserPluginDemo" component={SettingsBrowserPluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsNotesPluginDemo" component={SettingsNotesPluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsActionsPluginDemo" component={SettingsActionsPluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsPromptsPluginDemo" component={SettingsPromptsPluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsThreadsPluginDemo" component={SettingsThreadsPluginDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsHelpDemo" component={SettingsHelpDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SettingsHelpExpandedDemo" component={SettingsHelpExpandedDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerDemo" component={ChatComposerDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerActiveThreadRenameDemo" component={ChatComposerActiveThreadRenameDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerWithAttachmentDemo" component={ChatComposerWithAttachmentDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerMixedAttachmentsDemo" component={ChatComposerMixedAttachmentsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerStatusLineDemo" component={ChatComposerStatusLineDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerInputStatesDemo" component={ChatComposerInputStatesDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerCommandSuggestionDemo" component={ChatComposerCommandSuggestionDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerCommandSuggestionEmptyDemo" component={ChatComposerCommandSuggestionEmptyDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerModeMenuDemo" component={ChatComposerModeMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerNewThreadProjectMenuDemo" component={ChatComposerNewThreadProjectMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerNewThreadChildMenuDemo" component={ChatComposerNewThreadChildMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerPhaseMenuDemo" component={ChatComposerPhaseMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerQuickPromptsEditingDemo" component={ChatComposerQuickPromptsEditingDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerRevertHistoryDemo" component={ChatComposerRevertHistoryDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerRevertActionsDemo" component={ChatComposerRevertActionsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerReferenceCategoriesDemo" component={ChatComposerReferenceCategoriesDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerReferenceFilteredCategoriesDemo" component={ChatComposerReferenceFilteredCategoriesDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerReferenceEmptyStatesDemo" component={ChatComposerReferenceEmptyStatesDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerReferenceItemTypesDemo" component={ChatComposerReferenceItemTypesDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerReferencePillsDemo" component={ChatComposerReferencePillsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerReferencesDemo" component={ChatComposerReferencesDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerRecentThreadsDemo" component={ChatComposerRecentThreadsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerRecentThreadsEmptyDemo" component={ChatComposerRecentThreadsEmptyDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatComposerRecentThreadsRenameDemo" component={ChatComposerRecentThreadsRenameDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="TaskListPanelDemo" component={TaskListPanelDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="TaskListPanelMenuDemo" component={TaskListPanelMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="TaskListPanelRowMenuDemo" component={TaskListPanelRowMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="NotesRightRailDemo" component={NotesRightRailDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="NotesRightRailSearchDemo" component={NotesRightRailSearchDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="NotesRightRailMenuDemo" component={NotesRightRailMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="NotesRightRailTrashDemo" component={NotesRightRailTrashDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="NotesRightRailTrashActionsDemo" component={NotesRightRailTrashActionsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ThreadsHeaderDemo" component={ThreadsHeaderDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ThreadsHeaderSearchDemo" component={ThreadsHeaderSearchDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ThreadsHeaderFilterDemo" component={ThreadsHeaderFilterDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ThreadsHeaderArchiveDemo" component={ThreadsHeaderArchiveDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="KanbanComponentsDemo" component={KanbanComponentsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="CodeReviewDemo" component={CodeReviewDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="SourceControlPanelDemo" component={SourceControlPanelDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ToolActivityDemo" component={ToolActivityDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="InteractionBlocksDemo" component={InteractionBlocksDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ToolInputBlocksDemo" component={ToolInputBlocksDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="InteractionControlsDemo" component={InteractionControlsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ContentBlocksDemo" component={ContentBlocksDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="FullMarkdownViewerDemo" component={FullMarkdownViewerDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="MessageBubbleDemo" component={MessageBubbleDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PlanArtifactDemo" component={PlanArtifactDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PullRequestPanelDemo" component={PullRequestPanelDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PullRequestFilesDemo" component={PullRequestFilesDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PullRequestFilesLoadingDemo" component={PullRequestFilesLoadingDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PullRequestSelectorDemo" component={PullRequestSelectorDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PullRequestSelectorEmptyDemo" component={PullRequestSelectorEmptyDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PullRequestCreateDemo" component={PullRequestCreateDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="PullRequestDetailsDemo" component={PullRequestDetailsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="TerminalPanelDemo" component={TerminalPanelDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="FlowsListDemo" component={FlowsListDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="FlowsListSearchDemo" component={FlowsListSearchDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="FlowsListMenuDemo" component={FlowsListMenuDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="FlowPaletteDemo" component={FlowPaletteDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="FlowNodeVariantsDemo" component={FlowNodeVariantsDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="FlowCanvasDemo" component={FlowCanvasDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="FlowNodeFormDemo" component={FlowNodeFormDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="BoardSurfaceDemo" component={BoardSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="CodeSurfaceDemo" component={CodeSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="NotesSurfaceDemo" component={NotesSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="ChatSurfaceDemo" component={ChatSurfaceDemo} durationInFrames={demoDuration} fps={fps} width={1440} height={900} />
      <Composition id="WorkflowSurfaceDemo" component={WorkflowSurfaceDemo} durationInFrames={260} fps={fps} width={1440} height={900} />
    </>
  );
};
