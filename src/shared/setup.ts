import { missingRequired, type ToolCheck } from '../main/tools-shared'

/** What is known about this installation; collected by the main process. */
export interface SetupFacts {
  tools: ToolCheck[]
  projects: number
  githubConnected: boolean
  notionConnected: boolean
  notionConfigured: boolean
  claudeHooksInstalled: boolean
}

export type SetupTarget = 'dashboard' | 'projects' | 'github-prs' | 'notion-tickets' | 'claude'

export interface SetupStep {
  id: 'tools' | 'projects' | 'github' | 'notion' | 'claude'
  title: string
  description: string
  done: boolean
  required: boolean
  /** where the step is completed */
  target: SetupTarget
}

/** The first-start checklist: required steps first, then the optional connections. */
export function buildSetupSteps(f: SetupFacts): SetupStep[] {
  const missing = missingRequired(f.tools)
  return [
    {
      id: 'tools',
      title: 'Install the required tools',
      description: missing.length === 0 ? 'git, tmux and VS Code are available.' : missing.map((m) => `${m.name}: ${m.hint}`).join('\n'),
      done: missing.length === 0,
      required: true,
      target: 'dashboard'
    },
    {
      id: 'projects',
      title: 'Register your Projects',
      description: f.projects > 0 ? `${f.projects} registered.` : 'Add the git repositories you work on, so WorkDesks can check out Branches.',
      done: f.projects > 0,
      required: true,
      target: 'projects'
    },
    {
      id: 'github',
      title: 'Connect GitHub',
      description: f.githubConnected ? 'Review requests show up below.' : 'Log in with `gh auth login` or store a token, to get Pull Requests as reviews.',
      done: f.githubConnected,
      required: false,
      target: 'github-prs'
    },
    {
      id: 'notion',
      title: 'Connect Notion',
      description:
        f.notionConnected && f.notionConfigured
          ? 'Tickets show up below.'
          : f.notionConnected
            ? 'Token stored; now set the database id and property mapping.'
            : 'Store an integration token and pick the tickets database.',
      done: f.notionConnected && f.notionConfigured,
      required: false,
      target: 'notion-tickets'
    },
    {
      id: 'claude',
      title: 'Install the Claude hooks',
      description: f.claudeHooksInstalled ? 'Claude Signals are on.' : 'Lets WorkDesk tell you when Claude needs input or has finished.',
      done: f.claudeHooksInstalled,
      required: false,
      target: 'claude'
    }
  ]
}

export const setupProgress = (steps: readonly SetupStep[]): { done: number; total: number } => ({
  done: steps.filter((s) => s.done).length,
  total: steps.length
})
