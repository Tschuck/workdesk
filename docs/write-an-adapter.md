---
title: "Write an adapter"
---

# Write an adapter

An adapter connects one system (GitLab, Jira, …) to the app through the provider interface in
`src/main/sources/provider.ts`. It returns the shapes the app already uses, so nothing else changes.

## 1. Pick what it offers

A `Provider` has a name, an `untested` flag, `testConnection()` and one or both parts:

- `changeRequests` (pull / merge requests): `me`, `openChangeRequests`, `branchChangeRequests`,
  `changeRequestState`, `ciChecks`, `reviewRequested`. They return `PrItem`, `BranchPrStatus`, `PrTodoState`
  (`src/main/domain/prs.ts`) and `Candidate`. Map the system's words onto those: CI → `none | pending | success |
  failure`; merge status → `Mergeable` (`clean`, `dirty`, `behind`, `blocked`, `unstable`, `draft`, `unknown`); the
  readiness rule (`prReadiness`) then works unchanged.
- `tickets`: `me`, `ticket`, `transitions`, `transition`, `assigned`, `keyIn`.

Leave out what the system does not have.

## 2. Write it

Put it in `src/main/sources/providers/<name>.ts`.

- Take `fetchFn` as a parameter (default `fetch`) and call through `jsonCall` from `http.ts`: errors then name the
  system and path, never the token or the query.
- Validate anything you put in a URL (ticket keys, branch names: `encodeURIComponent`).
- Read-only calls first. A write (like `transition`) checks its input against what the system offers before sending.
- Set `untested: true` until someone confirmed it against a real account.

## 3. Credentials and settings

Add a token key next to the adapter (`provider-<name>-token`), connect it in `ProviderRegistry.connect`, list it in
`status()` / `save()` (`registry.ts`). Tokens go through `SecretStore` (the macOS Keychain); the address and email go
to the `providers` config of the Status Repo. The settings entry is `ProviderConnection` in
`src/renderer/ProviderSettings.tsx` plus one line in `SECTIONS` of `SettingsView.tsx`. Host detection for
git remotes is `detectKind` in `registry.ts`.

## 4. Fixtures and the contract

Copy the shape of the real answers from the API documentation into `providers/fixtures.ts`, telling the same story as
the others (the user `tobi` is asked to review change request 7 "Add export" of `alice`; ticket `ENG-5`). Then add an
entry to `changeRequestAdapters` or `ticketAdapters` in `providers/contract.test.ts`. The shared suite runs against
every adapter; add tests for what is specific to yours (status mappings, auth header) next to it.

No test may call a real service.

## 5. Tell people

Say "untested against a real account" in the settings entry and the README until it is confirmed.
