import { describe, expect, it } from 'vitest'
import { isChoreBranch } from './branches'

describe('chore branches', () => {
  it('recognises chore and dependency-bot branches', () => {
    for (const name of ['chore/update-deps', 'chore-lint', 'chore(deps): bump x', 'chore', 'Chore/Upper', 'renovate/typescript-5.x', 'dependabot/npm_and_yarn/lodash-4.17.21', 'deps/update', 'dep/x', 'bump/vite']) {
      expect(isChoreBranch(name), name).toBe(true)
    }
  })

  it('leaves real work alone, also when the word appears elsewhere', () => {
    for (const name of ['main', 'feature/chores-list', 'fix/chore-scheduler', 'feature/ACME-1220-key-resolution', 'choreography', 'chorebranch', 'dependencies-page', 'release/bump', 'my-renovate/x']) {
      expect(isChoreBranch(name), name).toBe(false)
    }
  })
})
