/** Split user-entered argv with quotes/escapes, without shell expansion or execution. */
export function parseCommandArguments(text: string): string[] {
  const args: string[] = [];
  let value = '';
  let started = false;
  let quote: 'single' | 'double' | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '\0') throw new Error('Command arguments cannot contain NUL');
    if (quote === 'single') {
      if (char === "'") quote = undefined;
      else value += char;
      continue;
    }
    if (char === '\\') {
      const next = text[index + 1];
      if (next === undefined) throw new Error('Command arguments end with an unfinished escape');
      if (next === '\0') throw new Error('Command arguments cannot contain NUL');
      if (quote === 'double' && !['$', '`', '"', '\\', '\n'].includes(next)) { value += char; continue; }
      index++;
      if (next !== '\n') { value += next; started = true; }
      continue;
    }
    if (quote === 'double') {
      if (char === '"') quote = undefined;
      else value += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char === "'" ? 'single' : 'double'; started = true; continue; }
    if (/[ \t\r\n]/.test(char)) {
      if (started) { args.push(value); value = ''; started = false; }
      continue;
    }
    value += char;
    started = true;
  }
  if (quote) throw new Error('Command arguments contain an unclosed quote');
  if (started) args.push(value);
  return args;
}
