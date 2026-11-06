import { describe, expect, it } from 'vitest'
import { buildSetupSteps, setupProgress, type SetupFacts } from './setup'

const ok = (name: string) => ({ name, required: true, ok: true, hint: '' })
const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  tools: [ok('git'), ok('tmux'), ok('code')],
  projects: 0, githubConnected: false, notionConnected: false, notionConfigured: false, claudeHooksInstalled: false,
  ...over
})

describe('setup checklist', () => {
  it('starts with everything open and required steps first', () => {
    const steps = buildSetupSteps(facts({ tools: [ok('git'), { name: 'tmux', required: true, ok: false, hint: 'brew install tmux' }] }))
    expect(steps.map((s) => [s.id, s.done, s.required])).toEqual([
      ['tools', false, true], ['projects', false, true], ['github', false, false], ['notion', false, false], ['claude', false, false]
    ])
    expect(steps[0].description).toContain('tmux: brew install tmux')
    expect(setupProgress(steps)).toEqual({ done: 0, total: 5 })
  })

  it('marks steps done from the facts', () => {
    const steps = buildSetupSteps(facts({ projects: 2, githubConnected: true, claudeHooksInstalled: true }))
    expect(steps.filter((s) => s.done).map((s) => s.id)).toEqual(['tools', 'projects', 'github', 'claude'])
    expect(steps.find((s) => s.id === 'projects')!.description).toBe('2 registered.')
  })

  it('Notion needs token and database', () => {
    expect(buildSetupSteps(facts({ notionConnected: true })).find((s) => s.id === 'notion')).toMatchObject({ done: false, description: expect.stringContaining('database id') })
    expect(buildSetupSteps(facts({ notionConnected: true, notionConfigured: true })).find((s) => s.id === 'notion')!.done).toBe(true)
  })
})
