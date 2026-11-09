// An agent child is spawned from the API process's environment, so what the app set on itself is inherited
// by that child and by everything its Bash tool runs — unless it is stripped (G2).
//
// **The terminal's half is not here any more.** It was, written for the `spawn` this pack used to do, and
// the broker taking that over left it with no caller at all: a shell inherited all ten variables again for
// the length of that change. It lives where the spawn does now (`@apackdev/host`'s `brokerEnvironment`),
// and what is left here is the one spawn this pack still makes.
import { describe, expect, it } from 'vitest'
import { APP_PROCESS_ENV_VARS } from '@apackdev/sdk/env'
import { agentChildEnvironment } from '#features/code/be/services/shell-environment.ts'

describe('the environment an agent child is spawned with', () => {
  it("keeps none of the variables the app set on its own process", () => {
    // The subject is the declaration the construction in `@app/main` is typed by, so a variable added there
    // arrives here: a strip written out by hand instead of derived leaves the new one behind.
    expect(APP_PROCESS_ENV_VARS.length).toBeGreaterThan(0)
    const appsOwn = Object.fromEntries(APP_PROCESS_ENV_VARS.map(name => [name, `set-by-the-app-${name}`]))

    const shell = agentChildEnvironment({ ...appsOwn, HOME: '/Users/someone', PATH: '/usr/bin' })

    expect(Object.keys(shell).filter(name => name in appsOwn)).toEqual([])
    expect(shell).toMatchObject({ HOME: '/Users/someone', PATH: '/usr/bin' })
  })

  it('keeps no loader that would run code of someone else\'s choosing in the shell', () => {
    const shell = agentChildEnvironment({
      LD_PRELOAD: '/tmp/x.so',
      LD_LIBRARY_PATH: '/tmp',
      DYLD_INSERT_LIBRARIES: '/tmp/x.dylib',
      DYLD_LIBRARY_PATH: '/tmp',
      PATH: '/usr/bin',
    })

    expect(Object.keys(shell).filter(name => /^(LD|DYLD)_/.test(name))).toEqual([])
  })

  it('claims to be no terminal, because it is not one', () => {
    // `TERM_PROGRAM` and `COLORTERM` belong to a shell in a pty, which the broker starts. An agent child
    // reads stdout as a pipe, and telling it there is a truecolor terminal on the other end is a lie that
    // some CLIs act on
    const child = agentChildEnvironment({ PATH: '/usr/bin' })
    expect(child.TERM_PROGRAM).toBeUndefined()
    expect(child.COLORTERM).toBeUndefined()
  })
})
