---
name: workdesk-docs
description: Update the WorkDesk docs after a feature or fix: TESTING.md, README.md, ROADMAP.md, CONTEXT.md. Use before committing user-visible work.
---

- **TESTING.md**: everything is unverified in the running app. Add a short `- [ ]` line per thing to look at, under the fitting section (or newest first). Never tick boxes yourself.
- **docs/features/*.md** (the site in `docs/`): update the page of the feature if behaviour the user sees changed; a walkthrough goes to `docs/use-cases/`. Keep `README.md` short: it is only the overview, quick start and links.
- **ROADMAP.md**: move finished items out, add the leftovers you know about.
- **CONTEXT.md**: only when a term is new or changes meaning; keep its "Avoid" lists honest.
- Style: plain sentences, no marketing words, no mention of Claude or AI.
