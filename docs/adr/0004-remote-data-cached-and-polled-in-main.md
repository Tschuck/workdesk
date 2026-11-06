---
title: "ADR 0004 — Remote data is cached and polled in the main process; the renderer only asks and shows"
---

# ADR 0004 — Remote data is cached and polled in the main process; the renderer only asks and shows

## Status
Accepted — 2026-10-29.

## Context
The app reads a lot from GitHub and Notion: review requests, the user's own pull requests, the state of each pull request, the pull requests of every WorkDesk's branch, tickets, ticket text. Each view asked on its own when it opened, and four timers in the main process (pull request watch, review polling, auto-assignment, the Details page) asked again for the same pull requests. Only three places had a cache. "My pull requests that need work" took about 90 REST requests per call, and with the `gh` login every request starts a process.

## Decision
- **The main process owns the cache and the clock.** One remote layer holds entries by key with a 5-minute lifetime, shares one request between callers that ask at the same time, and lets a refresh skip the cache. The renderer asks through IPC and is answered from the cache; when an entry changes, main tells the renderer which key.
- **No query library in the renderer.** TanStack Query would only duplicate the cache and the timer that now live in main. Pages ask through IPC, pass `refresh: true` from their reload icon, keep their own loading and error state, and re-read when main announces that a key they show was replaced.
- **Two tiers.** Lists (review requests, own pull requests, assigned tickets, a WorkDesk's pull requests) are cheap and refresh every 5 minutes while something shows them. Details of one item (pull request state, reviews, checks, ticket text, branch details) are read only for the item that is selected or that sits in a started WorkDesk whose Details are open; never for a whole list.
- **GraphQL for pull requests.** One request lists the user's open pull requests with reviews, checks and mergeability; one request with an alias per pull request serves the background poll. The Pull Requests page (one request per repository) and the pull requests of a WorkDesk's branches (one request per WorkDesk) use it too. REST stays for the Notion API, for single facts GraphQL has no use for (a pull request's clone URL and fork flag), and for a login that cannot send GraphQL.
- **One background poll** every 5 minutes, only for started WorkDesks, replaces the four timers. It feeds the chips and the Signals, and assigns open pull requests to the WorkDesk that has their branch. It pauses while the window is minimised or the machine is locked.
- **A page's reload icon refreshes what that page shows** and nothing else; there is no global refresh. The user's own actions (add, start, skip) change local state only and refetch nothing, except claiming a ticket in Notion.

## Consequences
- Review Signals can arrive up to 5 minutes late (before: 1 minute); the reload icon fetches at once.
- GitHub reads `mergeable` lazily, so a conflict can show up one refresh later.
- Both GitHub logins (`gh` and a token) must be able to send GraphQL.
- Everything remote goes through one layer, so adding a source means adding keys to it, not new timers.
