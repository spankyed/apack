// An agent child is spawned from the API process's environment, so what the app set on itself is inherited by
// that child and by everything its own tools run — unless it is stripped.
//
// **Three call sites, one strip.** The claude-code runner, the codex runner and the terminal's shell each
// spawn a process for the user, and each had its own hand-written deny-list naming two of the app's ten
// variables. The cases below take their subject from the declaration rather than writing the names out, which
// is the only reason they fail when a variable is added to what the app sets and a spawn is left behind.
import { describe, expect, it } from 'vitest'
import { APP_PROCESS_ENV_VARS } from '@apackdev/sdk/env'
import { agentChildEnvironment } from '#features/code/be/services/shell-environment.ts'
import { buildChildEnv } from '#features/code/be/services/claude-code/runner.ts'
import { buildCodexEnv } from '#features/code/be/services/codex/runner.ts'

/** What the app sets on a process it starts, with a recognisable value per name. */
const appsOwnEnvironment = () =>
  Object.fromEntries(APP_PROCESS_ENV_VARS.map(name => [name, `set-by-the-app-${name}`]))

describe('the environment a process this pack starts for the user is given', () => {
  it('keeps none of the variables the app set on its own process', () => {
    // The subject is the declaration the construction in `@app/main` is typed by, so a variable added there
    // arrives here: a strip written out by hand instead of derived leaves the new one behind.
    expect(APP_PROCESS_ENV_VARS.length).toBeGreaterThan(0)
    const appsOwn = appsOwnEnvironment()

    const child = agentChildEnvironment({ ...appsOwn, HOME: '/Users/someone', PATH: '/usr/bin' })

    expect(Object.keys(child).filter(name => name in appsOwn)).toEqual([])
    expect(child).toMatchObject({ HOME: '/Users/someone', PATH: '/usr/bin' })
  })

  it('leaves the environment it was given untouched', () => {
    // The API process keeps needing its own variables — the strip is for the copy handed to the child.
    const given = { ...appsOwnEnvironment(), PATH: '/usr/bin' }

    agentChildEnvironment(given)

    expect(Object.keys(given).filter(name => (APP_PROCESS_ENV_VARS as readonly string[]).includes(name)))
      .toEqual([...APP_PROCESS_ENV_VARS])
  })
})

describe('the environment an agent child is spawned with', () => {
  // These are the call sites. `buildChildEnv` and `buildCodexEnv` read `process.env` themselves, so each case
  // sets the app's variables on this process and asserts none of them reaches the child.
  const callSites = [
    ['claude-code', buildChildEnv],
    ['codex', buildCodexEnv],
  ] as const

  it.each(callSites)('keeps none of them in the %s child', (_name, buildEnv) => {
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
