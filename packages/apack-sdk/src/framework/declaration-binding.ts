/** @internal Check a runtime binding against host-validated declarations before registering it. */
export function _packDeclarationProblem(expected: { id: string; declarationRevision: string }, binding: unknown): string | undefined {
  if (!binding || typeof binding !== 'object') return `Pack "${expected.id}" does not export a registration`;
  if (!('id' in binding) || binding.id !== expected.id) return `Pack "${expected.id}" registration belongs to another pack`;
  if (!('declarationRevision' in binding) || binding.declarationRevision !== expected.declarationRevision) {
    return `Pack "${expected.id}" runtime does not match its declarations; rebuild and install the complete pack`;
  }
}
