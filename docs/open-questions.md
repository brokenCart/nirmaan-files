# Open questions

Decisions deliberately left open, with what each one would take to close.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

A first-time sign-in creates a user with **no memberships**, who therefore sees nothing until a
lead or exec adds them to a project. That is the current behaviour and the login screen says so.
Whether new users should instead auto-join a default project has not been decided.

Nothing opens a semester on its own — exec has to create the row. If they forget, `Semester.current()`
falls back to the last term that ended, so the app keeps working but the new term's entries pile
into the old one until someone notices. Whether that should be a scheduled job, a nag on the
project list, or left as a manual step each August has not been decided.

The migration bucketed pre-semester history into terms generated from the BITS calendar, and gave
each of those terms the *current* roster minus anyone who joined later. Nobody has checked those
rosters against what actually happened. If the old rosters matter, exec has to correct them by
hand.

**Opening a semester has API support but no UI.** `SemesterViewSet` is a full `ModelViewSet`, but
`queries.ts` only ever `GET`s `/api/semesters/`, so creating a term still means Django admin or a
raw API call — which is what makes the question above sharp rather than theoretical. Roster editing
*does* have a screen now (see [*Managing a roster*](roster.md)); semester creation is the one that does not.

**Attendance stops at counts, by decision.** No hours (a short call and a full-day visit weigh the
same), no per-person view across projects, and no visit record independent of a filed MOV — so a
trip nobody writes up did not happen as far as the table is concerned. Each was considered and left
out; revisit only if someone asks for volunteer-hour certificates, which is the use case that would
need all three.
