import { useMemo, useRef } from 'react'
import type { ReviewComment } from '../main/domain/local-review'
import { cleanError, notifyGitChanged } from './git-state'
import type { CommentsHost } from './review-comments'

/**
 * The review comments of one file as a host for `attachComments`: reads the comments of `all` that are on `rel`, and writes through the main process
 * (which keeps `.review/comments.json`). A comment just made or removed shows at once; `notifyGitChanged` makes every panel read again.
 */
export function useCommentsHost(deskId: string, rootPath: string | undefined, rel: string | undefined, all: ReviewComment[] | undefined, onError: (m: string) => void): CommentsHost | undefined {
  const list = useRef<ReviewComment[]>([])
  list.current = all ?? []
  const fail = useRef(onError)
  fail.current = onError
  return useMemo(() => {
    if (!rootPath || !rel) return undefined
    const api = window.workdesk
    return {
      comments: () => list.current.filter((c) => c.path === rel),
      onAdd: async (line, text) => {
        const c = await api.reviewAddComment(deskId, rootPath, rel, line, text)
        list.current = [...list.current, c]
        notifyGitChanged()
      },
      onUpdate: async (id, text) => {
        await api.reviewUpdateComment(deskId, rootPath, id, text)
        list.current = list.current.map((c) => (c.id === id ? { ...c, text: text.trim() } : c))
        notifyGitChanged()
      },
      onRemove: async (id) => {
        await api.reviewRemoveComment(deskId, rootPath, id)
        list.current = list.current.filter((c) => c.id !== id)
        notifyGitChanged()
      },
      onError: (m) => fail.current(cleanError({ message: m }))
    }
  }, [deskId, rootPath, rel])
}
