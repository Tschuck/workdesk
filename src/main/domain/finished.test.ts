import { describe, expect, it } from 'vitest'
import { unfinishedReason, type DeskFacts } from './finished'

const done: DeskFacts = { todos: [true], prs: ['merged'], tickets: [true], openBranchPrs: 0 }

describe('a WorkDesk is finished when all its items are', () => {
  it('is finished when Todos are resolved, pull requests merged or closed, tickets done and no branch has an open pull request', () => {
    expect(unfinishedReason(done)).toBeUndefined()
    expect(unfinishedReason({ ...done, prs: ['closed'] })).toBeUndefined()
  })

  it('waits for the last item', () => {
    expect(unfinishedReason({ ...done, todos: [true, false] })).toMatch(/Todo/)
    expect(unfinishedReason({ ...done, prs: ['merged', 'open'] })).toMatch(/open/)
    expect(unfinishedReason({ ...done, tickets: [false] })).toMatch(/ticket/)
    expect(unfinishedReason({ ...done, openBranchPrs: 1 })).toMatch(/branch/)
  })

  it('never counts unknown as finished, and an empty WorkDesk is not finished', () => {
    expect(unfinishedReason({ ...done, prs: [undefined] })).toMatch(/not known/)
    expect(unfinishedReason({ ...done, tickets: [undefined] })).toMatch(/ticket/)
    expect(unfinishedReason({ ...done, openBranchPrs: undefined })).toMatch(/branches/)
    expect(unfinishedReason({ todos: [], prs: [], tickets: [], openBranchPrs: 0 })).toMatch(/no work items/)
  })
})
