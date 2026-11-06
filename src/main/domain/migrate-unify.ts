import type { WorkDesk } from './types'

/**
 * WorkDesks used to have a type (review, ticket, plain) and a Review WorkDesk one pull request (`review`). Now every WorkDesk is the same and
 * has a list of the pull requests it reviews (`reviews`). Older files are read as they were: the type is dropped, `review` becomes the list,
 * and the one checked-out folder of such a WorkDesk is marked as the checkout of that pull request. Returns the same object when there is nothing to do.
 */
export function unifyDesk<T extends object>(desk: T): T {
  const old = desk as T & { kind?: string; review?: NonNullable<WorkDesk['reviews']>[number]; reviews?: WorkDesk['reviews']; branches?: WorkDesk['branches'] }
  if (!('kind' in old) && !('review' in old)) return desk
  const { kind: _kind, review, ...rest } = old
  const reviews = rest.reviews ?? (review ? [review] : undefined)
  let branches: WorkDesk['branches'] | undefined = rest.branches
  if (review && branches?.length === 1 && !branches[0].pr) branches = [{ ...branches[0], pr: `${review.owner}/${review.repo}#${review.number}` }]
  return { ...rest, ...(reviews ? { reviews } : {}), ...(branches ? { branches } : {}) } as unknown as T
}
