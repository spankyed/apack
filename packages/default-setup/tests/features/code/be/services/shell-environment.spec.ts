// A terminal spawns the user's shell from the API process's environment, so what the app set on itself is
// inherited by every command the user runs there unless it is stripped.
import { describe, expect, it } from 'vitest'
import { APP_PROCESS_ENV_VARS } from '@apackdev/sdk/env'
import { shellEnvironment } from '#features/code/be/services/shell-environment.ts'

describe('the environment a shell is spawned with', () => {
  it("keeps none of the variables the app set on its own process", () => {
    // The subject is the declaration the construction in `@app/main` is typed by, so a variable added there
    // arrives here: a strip written out by hand instead of derived leaves the new one behind.
    expect(APP_PROCESS_ENV_VARS.length).toBeGreaterThan(0)
    const appsOwn = Object.fromEntries(APP_PROCESS_ENV_VARS.map(name => [name, `set-by-the-app-${name}`]))

    const shell = shellEnvironment({ ...appsOwn, HOME: '/Users/someone', PATH: '/usr/bin' })

    expect(Object.keys(shell).filter(name => name in appsOwn)).toEqual([])
    expect(shell).toMatchObject({ HOME: '/Users/someone', PATH: '/usr/bin' })
  })

  it('keeps no loader that would run code of someone else\'s choosing in the shell', () => {
    const shell = shellEnvironment({
      LD_PRELOAD: '/tmp/x.so',
      LD_LIBRARY_PATH: '/tmp',
      DYLD_INSERT_LIBRARIES: '/tmp/x.dylib',
      DYLD_LIBRARY_PATH: '/tmp',
      PATH: '/usr/bin',
    })

    expect(Object.keys(shell).filter(name => /^(LD|DYLD)_/.test(name))).toEqual([])
  })

  it('tells the shell it is in a capable terminal', () => {
    expect(shellEnvironment({})).toMatchObject({ TERM_PROGRAM: 'apack', COLORTERM: 'truecolor' })
  })
})
