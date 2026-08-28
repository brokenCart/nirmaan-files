# Semesters and archives

How terms work, and the per-project archive built on them.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

`projects.Semester(name, slug, starts_on, ends_on)`, org-wide, created by exec. Counting restarts
each term, and so does the roster.

- Terms are **explicit rows, not a formula** over dates: the BITS calendar shifts year to year, and
  exec needs a lever to open one. `Semester.for_date(d)` returns the containing term, falling back
  to the most recently *ended* one so a date in the summer gap still lands somewhere. `None` means
  the date precedes every term on record, which the log serializer turns into a 400.
- Overlap is rejected in `Semester.clean()` rather than by a Postgres exclusion constraint, which
  would need `btree_gist` — an extension a managed database may not permit the migration to create.
- **Opening a term copies the previous term's roster into it** (`apps/projects/services.py`,
  called from `SemesterViewSet.perform_create`). Without that, every project would start the
  semester empty and the lead would be locked out of building the roster they were meant to build.
  The copy is idempotent and never overwrites a role already set in the target term.
- `DailyLog.semester` is derived from `occurred_on` in `DailyLog.save()` and then stored, so the
  archive is an indexed lookup rather than a range join against a table exec can edit underneath
  it. Clear the field to force a re-derive; `DailyLogSerializer.update` does that when the date
  moves.

The migration pair `projects.0002` / `logs.0003` reconstructs terms from the BITS calendar back to
the oldest entry. **The backfilled rosters are a guess** — there was no history of who was in a
project when, so each membership was copied into every term that ended after the member joined.
That is why `MembershipViewSet` still lets exec, and only exec, edit a past term's roster.

### Archives

`GET /api/projects/<slug>/archive/` returns one row per semester the project has a record in,
newest first: visits, meetings, roster size and who led it. The SPA renders it at
`/projects/:slug/archive`, and it is open to anyone who has ever been a member — including people
who have since left, which is the whole reason it is a screen of its own rather than just the
timeline's term switcher.

`Project.my_role` reports the *current* term's role. **Null on a project the caller can still see
means archive-only access**, and the SPA reads it that way to decide whether to offer a compose
box. The session payload from `/api/auth/` is current-semester only for the same reason: it drives
every write affordance, and listing every term a user was ever in would put an Edit button in front
of a lead who stepped down two years ago.
