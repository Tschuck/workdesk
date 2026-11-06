---
title: "The browser"
description: "How pages open, sessions, favorites, blocking and extensions."
sidebar_position: 8
---

# The browser

**Goal:** understand where a link opens and what the browser shares between sites.

WorkDesk's browser tabs are Electron web views, not a full browser. They sit next to terminals in a WorkDesk, and there is a global **Browser** page for everything outside a desk.

## Where a link opens

- **Inside a WorkDesk**, GitHub and Notion links (the pull request, a branch, a ticket, links in notes) open as a browser tab of that WorkDesk. A page that is already open is brought to the front.
- **Outside a WorkDesk** (the Dashboard, the pull request and Notion pages) they open on the Browser page.
- **In a parked WorkDesk** they open in your system browser.
- **From other apps:** *Settings → Browser → General* can make WorkDesk the default browser (installed app only). A link goes to the page that shows it already, otherwise it opens as a new tab of the Browser page.

## Tabs, pins and favorites

- **Pin** a tab (right-click) to shrink it to its icon: it stays first and cannot be closed by accident. Pinned browser tabs are also listed in the left panel's header.
- A **new tab is empty** and shows your favorites by group; inside a WorkDesk also its pull requests and work items. Typing in the address bar opens the picker: favorites, visited pages, an address or a search.
- The star in the address bar adds or edits a favorite. Favorites live in `bookmarks.json` of the Status Repo.
- History is kept on this machine only; *Settings → Browser → Security → Browsing history* switches it off.

## Sessions: what is shared

By default **every site has a session of its own**: cookies and logins of `github.com` are not visible to another site. *Settings → Browser → Sessions* lets you put domains into a shared session with rules such as `*.google.com`, or switch the default off so that all other sites share one. A domain can be in several sessions (for example *Private* and *Work*); a page then asks which to open it in. Installed extensions run in every session.

## Blocking and extensions

- **Trackers and ads:** *Settings → Browser → Security*: *No blocking* (default), *Block trackers* or *Block trackers and ads*. Requests are cancelled before they are sent; the page itself is never blocked.
- **Blocked sites:** *Settings → Browser → Blocked sites* lists sites that never load.
- **Extensions:** *Settings → Extensions* installs from the Chrome Web Store (paste the page address or the id). Content-script extensions work; those that need Chrome itself, such as native messaging or sync, usually do not. They see every page: install only what you would install in Chrome.

## Saving memory

A loaded page costs about 70 to 80 MB. A browser tab that stays out of sight for 30 minutes is **hibernated** and shows a *Wake up* screen. See [Save resources](/use-cases/saving-resources).

## What is missing

No safe-browsing or phishing warnings and no download warnings. Security fixes of the web engine come with the app's Electron version.

## Related

[Browser reference](/features/browser)
