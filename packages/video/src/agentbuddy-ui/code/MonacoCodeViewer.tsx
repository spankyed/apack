import {useLayoutEffect, useRef} from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/min/vs/editor/editor.main.css';
import './MonacoCodeViewer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('MonacoCodeViewer');

let themeDefined = false;
let modelId = 0;
let workersConfigured = false;

type MonacoCodeViewerProps = {
  filePath?: string;
  height?: number | string;
  language?: string;
  lineNumberStart?: number;
  lineNumbers?: 'off' | 'on';
  modified?: string;
  original?: string;
  value?: string;
};

// Shared read-only Monaco surface for film replicas. Mirrors the renderer's
// UnifiedMonacoEditor readonly/simple and readonly/inline-diff modes.
export function MonacoCodeViewer({
  filePath,
  height = '100%',
  language,
  lineNumberStart = 1,
  lineNumbers = 'off',
  modified,
  original,
  value = '',
}: MonacoCodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDiff = original !== undefined || modified !== undefined;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    configureWorkers();
    defineTheme();
    const resolvedLanguage = language ?? languageFromPath(filePath);
    const commonOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
      automaticLayout: false,
      contextmenu: false,
      cursorBlinking: 'solid',
      domReadOnly: true,
      folding: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      glyphMargin: false,
      lineDecorationsWidth: 0,
      lineHeight: 20,
      lineNumbers: lineNumbers === 'off' ? 'off' : lineNumber => String(lineNumber + lineNumberStart - 1),
      minimap: {enabled: false},
      overviewRulerBorder: false,
      padding: {top: 12, bottom: 12},
      readOnly: true,
      renderLineHighlight: 'none',
      renderValidationDecorations: 'off',
      roundedSelection: false,
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        horizontal: 'hidden',
        vertical: 'hidden',
      },
      scrollBeyondLastLine: false,
      theme: 'film-dark',
    };

    if (isDiff) {
      const originalModel = createModel(original ?? '', resolvedLanguage, filePath, 'original');
      const modifiedModel = createModel(modified ?? value, resolvedLanguage, filePath, 'modified');
      const editor = monaco.editor.createDiffEditor(container, {
        ...commonOptions,
        compactMode: true,
        diffAlgorithm: 'advanced',
        hideUnchangedRegions: {enabled: false},
        renderGutterMenu: false,
        renderIndicators: false,
        renderMarginRevertIcon: false,
        renderOverviewRuler: false,
        renderSideBySide: false,
        scrollbar: {
          alwaysConsumeMouseWheel: false,
          horizontal: 'hidden',
          vertical: 'hidden',
        },
      });
      editor.setModel({original: originalModel, modified: modifiedModel});
      editor.layout();
      return () => {
        editor.dispose();
        originalModel.dispose();
        modifiedModel.dispose();
      };
    }

    const model = createModel(value, resolvedLanguage, filePath, 'model');
    const editor = monaco.editor.create(container, {...commonOptions, model});
    editor.layout();
    return () => {
      editor.dispose();
      model.dispose();
    };
  }, [filePath, isDiff, language, lineNumberStart, lineNumbers, modified, original, value]);

  return (
    <div className={styles.root} style={{height}}>
      <div className={styles.editor} ref={containerRef} />
      <pre className={styles.placeholder}>{isDiff ? (modified ?? original ?? value) : value}</pre>
    </div>
  );
}

function configureWorkers() {
  if (workersConfigured || typeof window === 'undefined') return;
  workersConfigured = true;
  const scope = window as Window & {
    MonacoEnvironment?: {
      getWorker: (_moduleId: string, label: string) => Worker;
    };
  };
  scope.MonacoEnvironment = {
    getWorker: (_moduleId: string, label: string) => {
      if (label === 'json') {
        return new Worker(new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url), {type: 'module'});
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url), {type: 'module'});
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new Worker(new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url), {type: 'module'});
      }
      if (label === 'typescript' || label === 'javascript') {
        return new Worker(new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url), {type: 'module'});
      }
      return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), {type: 'module'});
    },
  };
}

function createModel(value: string, language: string, filePath: string | undefined, suffix: string) {
  const safePath = filePath?.replace(/[^a-zA-Z0-9._/-]/g, '_') ?? 'untitled';
  const uri = monaco.Uri.parse(`inmemory://film/${modelId++}-${suffix}/${safePath}`);
  return monaco.editor.createModel(value, language, uri);
}

function defineTheme() {
  if (themeDefined) return;
  themeDefined = true;
  monaco.editor.defineTheme('film-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#171717',
      'editor.foreground': '#d4d4d8',
      'editor.lineHighlightBackground': '#171717',
      'editorGutter.background': '#171717',
      'editorLineNumber.foreground': '#525252',
      'editorLineNumber.activeForeground': '#737373',
      'scrollbarSlider.background': '#52525266',
      'scrollbarSlider.hoverBackground': '#73737366',
    },
  });
}

function languageFromPath(filePath?: string) {
  const extension = filePath?.split('.').pop()?.toLowerCase();
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') return 'javascript';
  if (extension === 'json') return 'json';
  if (extension === 'css') return 'css';
  if (extension === 'html') return 'html';
  if (extension === 'md' || extension === 'mdx') return 'markdown';
  if (extension === 'sh' || extension === 'zsh' || extension === 'bash') return 'shell';
  return 'plaintext';
}
