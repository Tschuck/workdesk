/**
 * Housekeeping branches that get in the way when looking for real work: `chore/…`, `chore-…`, `chore(…)`,
 * and the branches dependency bots make (`renovate/…`, `dependabot/…`).
 */
const CHORE = /^(chore([/(_-]|$)|renovate\/|dependabot\/|deps?\/|bump\/)/i

export const isChoreBranch = (name: string): boolean => CHORE.test(name)
