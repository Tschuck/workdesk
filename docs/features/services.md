---
title: "Services"
description: "Projects, GitHub, Notion, GitLab and Jira."
sidebar_position: 16
---

# Services

Everything here is also in the app: the Dashboard's checklist links to each page. Credentials are kept **per Profile**, tokens in the macOS Keychain.

## Projects

*Settings → Projects → +*: clone a repository (kept as a bare clone in `.projects/`) or point to a clone you already have (its `.env` files are taken into the store). Add the Project's setup commands if it has any. See [Branches](./branches.md).

## GitHub

Either run `gh auth login`, or store a personal access token under *Settings → GitHub*. It needs to read pull requests and checks (the cog on the *Pull Requests* tab leads there). The repositories of your Projects are watched automatically.

Pull requests are read through GitHub's **GraphQL** API, and everything read from GitHub and Notion is **kept in the app for five minutes** and shared, so another page that shows the same list costs nothing. A small **reload icon** next to a page title (Start working, Pull Requests, Notion, Branches, a WorkDesk's Details, a pull request or ticket in its detail pane) asks the network again; its tooltip says when the data was read. Your own actions (add, start, skip) never refetch.

## Notion

1. In Notion, create an integration of type *Public* and add `http://localhost:8765/notion/callback` as its redirect URI.
2. Under *Settings → Notion*, paste the integration's OAuth client id and secret, press *Connect Notion* and approve in the browser. Tick the board and its Sprints database when asked.
3. Enter the **tasks database id**: open the database as a full page and take the 32-character id from its URL (the part before `?v=`). The other property names (Sprint, Assignee, Status, Tags, "Current") are editable under *Board mapping*.

The OAuth client is your own: WorkDesk never sees anyone else's. See [Work items](./work-items.md) for what it shows.

## GitLab and Jira

:::caution Untested
These adapters are written from the documented APIs and checked with handwritten examples only, never with a real account. Expect rough edges and please report what you find.
:::

- **GitLab:** merge requests, pipelines, approvals; REST v4, a personal access token with `read_api`, a self-hosted address is configurable.
- **Jira Cloud:** ticket status, transitions, tickets assigned to you; REST v3, email and API token.
- **Credentials:** *Settings → GitLab* / *Jira*, with a *Test connection* button.
- ***Settings → Git hosts*** shows which provider a git remote belongs to (github.com, gitlab.\*, bitbucket.org, dev.azure.com are found from the host) and lets you force it for a host or one repository.

For now these adapters are reachable from Settings (connect, test, host mapping). The pull request pages, chips and polling still read GitHub only. Bitbucket, Azure DevOps and Linear are not built. To add one, see [Write an adapter](../write-an-adapter.md).
