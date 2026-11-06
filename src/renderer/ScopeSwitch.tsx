import type { FileRoot } from '../main/files'
import { branchRoots, setScope, useScope } from './scope'

/** Which branch of a WorkDesk the files are looked for in: all of them, or one. Not shown with a single branch. */
export function ScopeSwitch({ deskId, roots }: { deskId: string; roots: FileRoot[] }) {
  const scope = useScope(deskId)
  const branches = branchRoots(roots)
  if (branches.length < 2) return null
  const active = branches.some((r) => r.path === scope) ? scope : undefined
  return (
    <div className="scope-switch" role="group" aria-label="Branch">
      <button type="button" className={active ? '' : 'on'} onClick={() => setScope(deskId, undefined)}>All</button>
      {branches.map((r) => (
        <button key={r.path} type="button" className={r.path === active ? 'on' : ''} title={r.path} onClick={() => setScope(deskId, r.path)}>
          {r.label}
        </button>
      ))}
    </div>
  )
}
