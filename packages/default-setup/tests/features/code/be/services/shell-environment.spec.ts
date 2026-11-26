// An agent child is spawned from the API process's environment, so what the app set on itself is inherited
// by that child and by everything its Bash tool runs — unless it is stripped (G2).
//
// **The terminal's half is not here any more.** It was, written for the `spawn` this pack used to do, and
// the broker taking that over left it with no caller at all: a shell inherited all ten variables again for
// the length of that change. It lives where the spawn does now (`@apackdev/host`'s `brokerEnvironment`),
// and what is left here is the one spawn this pack still makes.
//
// **The two runners are that spawn's call sites**, and they read `process.env` themselves rather than taking
// one, so their cases set the app's variables on this process and assert none of them reaches the child.
import { describe, expect, it } from 'vitest'
import { APP_PROCESS_ENV_VARS } from '@apackdev/sdk/env'
import { agentChildEnvironment } from '#features/code/be/services/shell-environment.ts'
import { buildChildEnv } from '#features/code/be/services/claude-code/runner.ts'
import { buildCodexEnv } from '#features/code/be/services/codex/runner.ts'

/** What the app sets on a process it starts, with a recognisable value per name. */
const appsOwnEnvironment = () =>
  Object.fromEntries(APP_PROCESS_ENV_VARS.map(name => [name, `set-by-the-app-${name}`]))

describe('the environment an agent child is spawned with', () => {
  it('keeps none of the variables the app set on its own process', () => {
    // The subject is the declaration the construction in `@app/main` is typed by, so a variable added there
    // arrives here: a strip written out by hand instead of derived leaves the new one behind.
    expect(APP_PROCESS_ENV_VARS.length).toBeGreaterThan(0)
    const appsOwn = appsOwnEnvironment()

    const child = agentChildEnvironment({ ...appsOwn, HOME: '/Users/someone', PATH: '/usr/bin' })

    expect(Object.keys(child).filter(name => name in appsOwn)).toEqual([])
    expect(child).toMatchObject({ HOME: '/Users/someone', PATH: '/usr/bin' })
  })

  it('keeps no loader that would run code of someone else\'s choosing in the child', () => {
    const child = agentChildEnvironment({
      LD_PRELOAD: '/tmp/x.so',
      LD_LIBRARY_PATH: '/tmp',
      DYLD_INSERT_LIBRARIES: '/tmp/x.dylib',
      DYLD_LIBRARY_PATH: '/tmp',
      PATH: '/usr/bin',
    })

    expect(Object.keys(child).filter(name => /^(LD|DYLD)_/.test(name))).toEqual([])
  })

  it('claims to be no terminal, because it is not one', () => {
    // `TERM_PROGRAM` and `COLORTERM` belong to a shell in a pty, which the broker starts. An agent child
    // reads stdout as a pipe, and telling it there is a truecolor terminal on the other end is a lie that
    // some CLIs act on
    const child = agentChildEnvironment({ PATH: '/usr/bin' })
    expect(child.TERM_PROGRAM).toBeUndefined()
    expect(child.COLORTERM).toBeUndefined()
  })

  it('leaves the environment it was given untouched', () => {
    // The API process keeps needing its own variables — the strip is for the copy handed to the child.
    const given = { ...appsOwnEnvironment(), PATH: '/usr/bin' }

    agentChildEnvironment(given)

    expect(Object.keys(given).filter(name => (APP_PROCESS_ENV_VARS as readonly string[]).includes(name)))
      .toEqual([...APP_PROCESS_ENV_VARS])
  })
})

describe('the call sites that spawn an agent child', () => {
  const callSites = [
    ['claude-code', buildChildEnv],
    ['codex', buildCodexEnv],
  ] as const

  it.each(callSites)('keeps none of the app\'s variables in the %s child', (_name, buildEnv) => {
    const appsOwn = appsOwnEnvironment()
    const restore = new Map(APP_PROCESS_ENV_VARS.map(name => [name, process.env[name]]))
    Object.assign(process.env, appsOwn)
    try {
      const env = buildEnv()

      expect(Object.keys(env).filter(name => name in appsOwn)).toEqual([])
    } finally {
      for (const [name, value] of restore) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it.each(callSites)('still lets a caller set one of them deliberately in the %s child', (_name, buildEnv) => {
    // The strip is of what this process happens to carry, not a refusal: an override is the caller saying it
    // means this value, and `cwd`-scoped spawns in the pack do pass deliberate environments.
    expect(buildEnv({ APACK_ENV: 'test' }).APACK_ENV).toBe('test')
  })
})
