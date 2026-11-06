import { join } from 'node:path'

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const projectsDir = (root: string): string => join(root, '.projects')
export const bareCloneDir = (root: string, project: string): string => join(projectsDir(root), `${project}.git`)
export const deskDir = (root: string, deskId: string): string => join(root, deskId)

/** First branch of a Project sits in `<project>`, further ones in `<project>--<n>-<slug>`. */
export function worktreeDirName(project: string, index: number, branch: string): string {
  return index <= 1 ? project : `${project}--${index}-${slugify(branch)}`
}
