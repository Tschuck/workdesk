---
name: desk-handoff
description: Write down where the work stands, so the next session or a parked desk can pick up. Use before parking or ending a session, or for "write a handoff".
---

Write a short note to the WorkDesk's notes folder (`notes/handoff.md` in the desk folder, the parent of the branch folders), replacing the old one:

- Goal in one line
- Done (with branch names)
- Open: what is half-finished, failing, or undecided
- Next step, concrete
- Commands to run or files to open first

Facts only, no filler. Then run `node "$WORKDESK_CLI" desk current` and mention unresolved Todos in the note.
