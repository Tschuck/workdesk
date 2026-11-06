import { describe, expect, it } from 'vitest'
import type { WorkDesk } from '../main/domain/types'
import { deskPaletteActions, type DeskActionHandlers } from './desk-actions'

const calls: string[] = []
const h: DeskActionHandlers = {
  park: (id) => void calls.push(`park ${id}`),
  reactivate: (id) => void calls.push(`reactivate ${id}`),
  postpone: (id) => void calls.push(`postpone ${id}`),
  bringBack: (id) => void calls.push(`back ${id}`),
  groupByBranch: (id, on) => void calls.push(`group ${id} ${on}`),
  combine: (id) => void calls.push(`combine ${id}`)
}
const desk = (over: Partial<WorkDesk>): WorkDesk => ({ id: 'd', name: 'Desk', presence: 'active', branches: [], ...over }) as WorkDesk
const COMBINE = 'Combine this WorkDesk with another…'
const titles = (d: WorkDesk | undefined, now = 1000) => deskPaletteActions(d, h, now).map((c) => c.title)

describe('deskPaletteActions', () => {
  it('offers nothing outside a WorkDesk', () => {
    expect(titles(undefined)).toEqual([])
  })
  it('park and postpone for a running desk; grouping only with several branches', () => {
    expect(titles(desk({}))).toEqual(['Park this WorkDesk', 'Postpone this WorkDesk…', COMBINE])
    const two = desk({ branches: [{}, {}] as WorkDesk['branches'] })
    expect(titles(two)).toContain('Group the tabs by branch')
    expect(titles({ ...two, groupTabsByBranch: true })).toContain('Stop grouping the tabs by branch')
  })
  it('reactivate for a parked desk, bring back for a postponed one', () => {
    expect(titles(desk({ presence: 'parked' }))).toEqual(['Reactivate this WorkDesk', 'Postpone this WorkDesk…', COMBINE])
    expect(titles(desk({ postponedUntil: 5000 }))).toEqual(['Park this WorkDesk', 'Bring this WorkDesk back from postponed', COMBINE])
    expect(titles(desk({ postponedUntil: 500 }))).toContain('Postpone this WorkDesk…')
  })
  it('a planned desk cannot be parked', () => {
    expect(titles(desk({ presence: 'planned' }))).toEqual(['Postpone this WorkDesk…', COMBINE])
  })
  it('runs the handlers with the desk id', () => {
    calls.length = 0
    const two = desk({ branches: [{}, {}] as WorkDesk['branches'] })
    for (const c of deskPaletteActions(two, h)) c.run()
    expect(calls).toEqual(['park d', 'postpone d', 'group d true', 'combine d'])
  })
})
