import ts from 'typescript'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

it('resolves incoming Claude events before generated pack files exist', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const file = resolve(root, 'src/features/threads/be/contract.ts')
  const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const host = ts.createCompilerHost(options), read = host.readFile, exists = host.fileExists
  // Simulate a clean checkout without deleting the active checkout's generated files.
  host.readFile = path => path.includes('/src/__generated__/') ? undefined : read(path)
  host.fileExists = path => !path.includes('/src/__generated__/') && exists(path)
  const program = ts.createProgram([file], options, host), checker = program.getTypeChecker()
  const declaration = program.getSourceFile(file)!.statements.find((node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === 'Contract')!
  const contract = checker.getTypeFromTypeNode(declaration.type), symbol = contract.getProperty('incoming')!
  const incoming = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration!)
  expect(incoming.flags & ts.TypeFlags.Any).toBe(0)
  expect(incoming.isUnion()).toBe(true)
  const names = incoming.isUnion() ? incoming.types.flatMap(member => { const property = checker.getPropertyOfType(member, 'type'); if (!property) return []; const type = checker.getTypeOfSymbolAtLocation(property, declaration); return type.isStringLiteral() ? [type.value] : [] }) : []
  expect(names).toContain('CLAUDE_PROMPT_HOST_RESPONSE')
  expect(names).toContain('CLAUDE_TERMINAL_MOUNT')
  expect(names).toContain('USER_MSG')
})
