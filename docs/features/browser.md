---
title: "Browser"
description: "Browser tabs, favorites, sessions, blocking, extensions and security."
sidebar_position: 11
---

# Browser

Browser pages sit next to terminals in a WorkDesk, and the **Browser** page (the globe icon in the left panel's header) is a browser outside any WorkDesk. Both use the same web views and the same login sessions.

They are Electron web views, not a full browser. Treat them as a convenient browser for your work sites and docs, not for banking or sites you do not trust. See [Security](#security).

## Pages and tabs

- A tab is named after its page title until you rename it (double-click, or *Set tab alias…*). The alias only changes the name the tab is listed under. The tab shows the page's icon (a globe without one; the host stands in for a missing title).
- Pages and terminals **stay alive** when you switch tabs or WorkDesks.
- A thin progress bar runs under the address bar while a page loads. The **lock** left of the address shows how the page was reached (secure, plain http, a local address, or a certificate problem); click it for the certificate (issued to / by, validity, SHA-256). A page whose certificate is refused is not loaded, and there is no way around it.
- `⌘F` searches in the page, `⌘R` reloads the page (never the app), and the back / forward buttons of a mouse work.
- **Right-click a tab:** *Duplicate*, *Hibernate*, *Pin*, *Set tab alias…*. A hibernated page is unloaded to free memory, the tab stays dimmed and loads again on *Wake up*, also after a restart.
- **Right-click a page:** Back, Forward, Reload, *Open link in new tab*, *Copy link address*, Copy / Cut / Paste, *Copy URL as Markdown link* (`[title](url)`), *Attach to \<WorkDesk\>*, *Attach to a Todo…*, *Inspect*.
- **Sign-in pop-ups** (*Continue with Google*, *Sign in with Apple*) get a real small window of the same session, with its opener, so the pop-up can hand the result back. Only https.

## Where links open

- **Inside a WorkDesk,** GitHub and Notion links (pull request, branch, ticket, links in notes) open as a browser tab of that WorkDesk. A page that is already open is brought to the front.
- **Outside a WorkDesk** (Dashboard, pull request and Notion pages) they open on the Browser page.
- **In a parked WorkDesk** they open in your system browser.
- **From other apps:** *Settings → Browser → General* can make WorkDesk the default browser (installed app only; macOS asks to confirm). A link goes to the page that shows it already, in a WorkDesk or on the Browser page, otherwise to a new tab of the Browser page.

## Attach pages as references

The **⋯** button in a browser pane's address bar (or ⌘P → *Attach this page to …*) offers *Attach to \<WorkDesk\>* and *Attach to a Todo…* (open Todos of the WorkDesk, then loose ones, with search). Attached pages are listed under **Pages** on the WorkDesk's Details page and on the Todo, with icon and host. A click opens the page as a tab of the WorkDesk, × detaches it. Only http(s) pages can be attached. They are kept in the WorkDesk's `desk.json` and the Todo's `refs`.

## Pinned tabs

On the Browser page the 📌 of a tab (or *Pin* in its menu) shrinks it to its icon: it stays first and cannot be closed by accident. Its icon is also listed in the left panel's header; click it to go there. Pinned tabs can be sorted by dragging, in the tab bar or among the header icons (both show the same order).

## Favorites and the new-tab picker

A new tab is empty and shows your favorites by group, and inside a WorkDesk a *This WorkDesk* section with the open pull requests of its branches and its work items. Type to filter (every word must match title, address or group); `↓` / `↑` move, `Enter` opens, `Esc` clears.

- **What you type that is no favorite is not lost:** below the matches a row offers to open it (a pasted URL is the first row) or to search for it with your default engine, or, when no favorite matches, with every engine, the default first. *Settings → Browser → Search engines*: sort them by dragging; the first is the default (Startpage, DuckDuckGo, Google, Bing, Brave Search, Ecosia, Qwant). The address bar uses the same engine.
- **A word that names a group ranks the whole group up:** with `acme portal`, the group *acme* comes first, its entries that fit both words on top, then the rest of the group, then other entries with both words.
- **Add a favorite** with the star in the address bar (name, address, group; on a favorite it edits it, with *Remove*), or *+ Add* on the favorites page. *Duplicate* opens the same dialog filled in from a favorite.
- **Groups:** click a heading to close or open it (a search opens every group), drag a heading to move the group, or use *Move up / Move down*, *Rename…* (an existing name merges the two groups). *Collapse all* / *Expand all* sit above the list; *Settings → Browser → Favorites → Groups start closed* sets the default.
- **Move a favorite:** drag it onto another group (onto *Favorites* to take it out; *Drop here for a new group* asks for a name), or right-click → *Add to a group…*.
- **Import:** *Settings → Browser → Favorites → Import favorites…* takes favorites over from **Vivaldi** (every profile) or **Firefox** (read from a copy, so Firefox can stay open). Tick what to import in a tree of folders. A folder becomes a group (`Work / Deep`). Favorites that exist already are skipped.
- Bookmarks are the same everywhere. They live in `bookmarks.json` of the Status Repo; order and closed groups in `bookmark-groups.json`.

## Address bar and history

Typing in the address bar opens the same picker: favorites, visited pages, an address (opens it) or a search; `Enter` goes there, `⌘Enter` opens a new tab.

History is kept on this machine only. *Settings → Browser → History* lists pages by day (search, click opens, × forgets one page); *Clear day* and *Clear all history* forget more, and *Forget pages older than …* (never, 1, 7, 14, 30, 90, 180, 365 days) removes old pages at start and every few hours. *Security → Browsing history* switches it off and clears it.

## Sessions

By default **every site has a session of its own** (cookies, logins): `github.com` and `gist.github.com` are one site, `notion.so` another. *Settings → Browser → Sessions*:

- **Every site has a session of its own** switched off makes every site that no rule names share one session. Logins of the shared session do not move to the sites' own sessions, so sign in once more.
- **Rules:** `*.google.com` (that domain and everything below it) or `github.com` (exactly that host) puts those domains into one session of their own, so one login serves all of Google. The first matching rule wins.
- **A domain in several sessions** (a *Private* and a *Work* session that both name `claude.ai`): a page that opens on it first asks which session to open in, and nothing loads until you pick. The choice is kept for that pane or tab. Moving within the domain stays in that session, and so does everything the page hops to by links and redirects, so a sign-in through Google runs inside the session you picked.
- **A label next to the address bar** shows the session (a configured name, the site's own, or *Shared*). With several sessions it shows ▾, and a click lists them; one click on another opens the same page there (a new page, the history does not come along).
- **A page sent to another session by a link** says so in a bar above it, with a button to keep that host in the session the page came from. Sign-in flows that hop between sites still work, but pop-ups that talk to each other across sessions do not.
- *Sign out everywhere* deletes the cookies of a session.

### Camera, microphone, screen sharing

A site asks before it may use them (and macOS asks its own question the first time). *Allow* is kept per site. The **site settings icon** in the address bar allows or takes back these for the open site without waiting for a question, and *Settings → Browser → Sessions* lists the sites to take it back from. Other permissions (location, notifications) are refused.

## Blocking

- **Trackers and ads:** *Settings → Browser → Security*: *No blocking* (default), *Block trackers* (EasyPrivacy) or *Block trackers and ads* (EasyList, EasyPrivacy, Fanboy Annoyances, Peter Lowe's list). Requests to listed addresses are cancelled before they are sent, in every session; the page itself is never blocked. The lists download when a level is first chosen (the only network use of this feature) and renew weekly. Empty ad boxes are not hidden, and open pages need a reload after a change.
- **Per site:** the **site settings icon** in the address bar gives the open site a level of its own (for its whole site: `github.com` covers `gist.github.com`), or lets it follow the one of all pages again; the page reloads with it. *Settings → Browser → Security* lists the sites that have their own level.
- **Blocked sites:** *Settings → Browser → Blocked sites* lists sites (`reddit.com`, covering subdomains, or a part such as `reddit.com/r/all`) that do not load in any browser tab. The tab shows a page instead, with *Go back* and, after a ten-second wait, a **pass for that one page** for ten minutes. Page changes of single-page sites are caught too. The list is in the Status Repo (`site-block.json`); passes are only in memory.

## Extensions

*Settings → Extensions* installs extensions from the Chrome Web Store: paste the address of its page or its id. They are installed in the browser session, work in every browser tab and are loaded again at each start. Each has a button right of the address bar that opens its popup (the buttons are those of the session the page is in).

Only part of Chrome's extension API exists in Electron. Content-script extensions (ad blockers, page tweaks) work; those that need Chrome itself (native messaging, sync) usually do not. An extension that opens a page of its own (a sign-in) gets a window of its own, which does not always work, and autofill depends on the extension. Because every site has its own session by default, an extension that keeps a login (a password manager) is signed out in each site's session: turn *Every site has a session of its own* off, or use a rule that groups your sites. Tried: Proton Pass shows its popup (sign-in screen); signing in from it is not verified.

## Security

- **Isolated:** a page has no Node access and no preload script, so it cannot reach the app, its IPC, your files or your tokens. Pages run in their own session, separate from the app. Only `https:` links are handed to the system browser, and the app window itself never navigates to a web page.
- **Denied and asked:** pages get no location or notifications (only copying to the clipboard and fullscreen). Camera, microphone and screen sharing are asked per site, only for secure pages, and refused without a question otherwise. A page that checks first (Google Meet does) is told it may ask.
- **Shared:** by default a page never sees the cookies of another site. Pages of the domains of one rule share a session, and with the default switched off all other sites share one. Installed extensions run in every session.
- **Extensions see every page.** Install from the Chrome Web Store only what you would install in Chrome, and remove what you do not use.
- **Missing:** no safe-browsing or phishing warnings, no download warnings, and `file:` addresses are accepted. Security fixes of the web engine come with the Electron version of the app, so update it from time to time.
