import type { TerminalColors } from '@apackdev/sdk/services'

/**
 * The colours a terminal is drawn in.
 *
 * **One declaration, read by both halves.** The window draws with it and the backend hands it to the host
 * when a session starts, because the host is what answers a program that asks the terminal for its colours
 * — which is how a program picks a light or a dark theme. Two copies would be a window drawn in one palette
 * and a program told about another.
 */
export const TERMINAL_THEME = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1e1e1e',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
} as const

/** The same colours as a session is told them: the sixteen named ones in palette order */
export const TERMINAL_COLORS: TerminalColors = {
  foreground: TERMINAL_THEME.foreground,
  background: TERMINAL_THEME.background,
  cursor: TERMINAL_THEME.cursor,
  ansi: [
    TERMINAL_THEME.black, TERMINAL_THEME.red, TERMINAL_THEME.green, TERMINAL_THEME.yellow,
    TERMINAL_THEME.blue, TERMINAL_THEME.magenta, TERMINAL_THEME.cyan, TERMINAL_THEME.white,
    TERMINAL_THEME.brightBlack, TERMINAL_THEME.brightRed, TERMINAL_THEME.brightGreen, TERMINAL_THEME.brightYellow,
    TERMINAL_THEME.brightBlue, TERMINAL_THEME.brightMagenta, TERMINAL_THEME.brightCyan, TERMINAL_THEME.brightWhite,
  ],
}
