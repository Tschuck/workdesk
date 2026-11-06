import { useEffect, useState } from 'react'
import type { AccountsState } from '../main/claude/accounts'

/** The Claude Accounts with their login and usage, kept current while the component is shown. */
export function useAccounts(): AccountsState | undefined {
  const [state, setState] = useState<AccountsState>()
  useEffect(() => {
    const api = window.workdesk
    void api.accountsState().then(setState)
    return api.onAccountsChanged(setState)
  }, [])
  return state
}

export const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
