# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Project tracking for Nirmaan, a student-run NGO at BITS Pilani, Pilani campus. A *vertical* is
called a **project** in Nirmaan's vocabulary, and that word means a `projects.Project` row
throughout the codebase — never a software project.

Four modules are planned per project:

1. **Daily logs** — MOVs (Moments of Visit) and MOMs (Minutes of Meeting) — ✅ shipped, with
   per-semester counting and a project archive
2. **Knowledge base** — past context, lore — planned (`apps/knowledge`)
3. **Volunteer visit tracking** — ◐ attendance counts shipped; see *Attendance* below for what
   that does and does not cover. There is no `apps/visits`: counting derives from
   `DailyLog.attendees` and lives in `apps/logs/stats.py`.
4. **Resource links** — Drive URLs and similar — planned (`apps/resources`).
   `Project.drive_folder_url` already exists as the seam and is exposed by the serializer, but
   nothing in the SPA reads it yet.

Django REST Framework backend, React + TypeScript SPA, one repo, PostgreSQL.

## Commands

All backend commands run from `backend/`, all frontend commands from `frontend/`.

```bash
# Database (host port 5433 — 5432 is usually taken by another project)
docker compose up -d db

# Backend
uv run python manage.py migrate
uv run python manage.py runserver
uv run python manage.py seed_demo --reset      # demo projects, every role, sample logs
uv run pytest                                  # whole suite
uv run pytest apps/projects/tests/test_permissions.py::TestCrossProjectRoles   # one class
uv run pytest -k finance_lead                  # one pattern
uv run ruff check . && uv run ruff format .

# Frontend
npm run dev
npm run build          # tsc -b && vite build
npm run lint           # oxlint
npm run gen:api        # regenerate src/api/schema.ts from the running backend

# Everything at once
docker compose up --build
```

`npm run gen:api` reads `http://localhost:8000/api/schema/`, so the backend must be running.

## Architecture

### Roles are per-project and per-semester, not global

This is the load-bearing design decision. A person can be Lead of *Shiksha* and a plain Volunteer
of *Aarogya* at the same time, and can have been a Volunteer of *Shiksha* last semester. The only
org-wide role is Executive Committee.

- `accounts.User.is_exec` — org-wide, grants read across every project without any membership row.
- `projects.Membership(user, project, semester, role)` — everything else. `role` ∈ `LEAD`,
  `FINANCE_LEAD`, `VOLUNTEER`, one row per **(user, project, semester)**.

**Do not model roles as Django Groups or as a field on `User`.** That flattens the per-project
distinction and there is no way back once data exists. Likewise **do not edit a `Membership`'s role
to reflect a promotion** — that rewrites who held what when the archived entries were filed. A new
term is a new row.

Resolution lives in `apps/projects/permissions.py`:

- `current_semester(request)` — the term in progress, cached on the request.
- `membership_roles(request)` — `{project_id: role}` for the requesting user **this semester**,
  cached on the request object so a list endpoint checking N objects issues one query, not N.
- `visible_projects(user)` / `visible_project_ids(request)` — projects the user has been a member
  of in **any** semester. For queryset scoping.
- `IsProjectMember` — object belongs to a project the user has *ever* been in. A read gate.
- `require_roles(*roles)` → a permission class; `IsProjectLead` and `IsProjectStaff` are the
  prebuilt ones. Reads are open to anyone who has ever been a member, writes are limited to the
  named roles **held this semester**, exec bypasses.
- `IsExec` — reads for anyone signed in, writes for exec. Used by semesters, which are org-wide.

### Reads and writes resolve against different sets

The single easiest thing to get wrong. Before semesters, one query answered both "what can I read"
and "what can I write". It no longer does:

| Question | Answered by | Scope |
| --- | --- | --- |
| May I read this? | `visible_project_ids` | membership in **any** semester |
| May I write this? | `membership_roles` / `role_in_project` | membership **this** semester |

Resolving a write against the unscoped set silently hands last year's lead their old powers back.
`apps/conftest.py`'s `past_lead` fixture — lead of `project` in `past_semester`, nothing this term
— exists to catch exactly that, and is the fixture most new negative tests want.

### Semesters

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

### Permission classes gate actions; querysets hide rows

A DRF permission class only ever sees objects the queryset already returned. Every list endpoint
must narrow `get_queryset()` independently — see `ProjectViewSet.get_queryset` and
`DailyLogQuerySet.visible_to`. Getting this wrong leaks other projects' data even though the
permission class looks correct.

A consequence worth knowing: hitting a project you are not a member of returns **404, not 403**.
That is deliberate — 403 would confirm the project exists. Tests assert the 404.

### Auth: Google ID token in, own JWT out

1. The SPA gets an ID token from Google Identity Services.
2. `POST /api/auth/google/` → `apps/accounts/services.py` verifies signature and audience, then
   independently checks `iss`, `email_verified`, and that the domain is exactly
   `pilani.bits-pilani.ac.in`.
3. A short-lived access token comes back in the response body; the refresh token is set as an
   **httpOnly cookie** scoped to `/api/auth/`.

The `hosted_domain` prop on the frontend Google button is a hint for the account chooser, **not a
security control** — anyone can post any token straight to the endpoint. `is_allowed_email` in
`apps/accounts/domain.py` is the real gate, and it is an exact domain match rather than a suffix
check so `evil-pilani.bits-pilani.ac.in` cannot slip through.

Only Pilani campus is allowed. Goa and Hyderabad are explicitly refused, and tests assert it.

Users match on Google `sub` first, then email — which lets a lead add someone by email before they
have ever signed in, with the placeholder row adopted on first login.

On the client, the access token lives in a module variable in `src/api/client.ts`, never in
`localStorage`. A reload therefore starts signed-out until `restoreSession()` trades the refresh
cookie for a new token. Concurrent 401s share one in-flight refresh, because refresh tokens rotate
and a losing racer would present an already-blacklisted token.

### Daily logs

One `DailyLog` model carries both MOVs and MOMs, distinguished by `kind`, because the primary
screen is a single reverse-chronological feed per project and one indexed table serves it in one
query. Every field applies to both kinds — `attendees` included, since a visit has attendees just
as a meeting does and per-person visit and meet counts are derived from it. Split into two models
only if the kinds genuinely diverge.

Writes: any member **of the current semester** may file a log. **Only the author may edit one** —
at any status, and no role overrides this, leads and exec included. An entry is one person's
account of what happened, so staff who disagree with it delete it rather than reword it under the
author's name. Authorship is necessary but not sufficient: every write, edit included, also needs
membership **this semester**, so someone dropped from the roster mid-term keeps reading the feed
but stops editing what they filed while they were on it. Deleting is the moderation lever: leads, finance leads and exec may remove any log
in their project, and an author may withdraw their own. Deletes are soft (`is_deleted`) — the
timeline is institutional memory, which is what makes "remove it rather than rewrite it" safe.

**A closed semester is frozen.** Entries in a past term cannot be edited by anyone, author
included, and only exec can remove one — the moderation lever has to survive, since something that
should never have been published must still be removable a year on. Backdating a *new* entry into
a closed term is refused for the same reason, or the rule would be one date field away from moot.

`project` is rejected on update: write permission is judged against the project the entry already
belongs to, so a reassignment would sidestep that check.

Drafts are private to their author, enforced in `DailyLogQuerySet.visible_to`.

The timeline shows **one term at a time**, defaulting to the open one. `?semester=<slug>` reads a
past term and `?semester=all` reads across every term. That default applies to *listing* only —
detail routes must reach an archived entry by its own URL, or every 403 the frozen-archive rule is
meant to return arrives as a 404 instead.

### Attendance

`apps/logs/stats.py` turns `DailyLog.attendees` into per-member counts, served by
`GET /api/projects/<slug>/attendance/` and as an `.xlsx` by `.../attendance/export/`
(`apps/logs/exports.py`). Any member may read both. This is module 3 — there is no `apps/visits`,
because a visit *is* a MOV and a second table would mean two places to look for one event.

Roster and counts both come from **one semester**; mixing them lists a member against totals they
had no part in. `attendance_for` returns `Membership` rows, not users, so each row carries the role
held *in that term* and a member with no attendance still appears — a zero is the point of the
table. Drafts and soft-deleted entries are excluded, which is a privacy rule rather than tidiness:
a total that counted drafts would leak their existence.

Counts are headcounts. There is no duration field and no per-person rollup across projects, both
deliberate — see *Open questions*.

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

### API types are generated, not hand-written

`frontend/src/api/schema.ts` is generated by `openapi-typescript` from drf-spectacular's schema.
`src/api/types.ts` re-exports friendly aliases over it. Never edit `schema.ts` by hand — change the
serializer and run `npm run gen:api`. A renamed field then breaks the build instead of the app.

## Conventions

- Settings are split: `config/settings/{base,dev,prod,test}.py`. `manage.py` defaults to `dev`.
  Production reads every secret from the environment with no defaults, so a missing value fails at
  import rather than mid-request.
- Django apps live under `backend/apps/` and declare `name = "apps.<app>"` in their `AppConfig`.
- Tests run against Postgres, not SQLite, so unique constraints and case handling behave as they do
  in production. `apps/conftest.py` holds the factories and role fixtures — `lead`, `finance_lead`,
  `volunteer`, `exec_user`, `outsider` (a member of a *different* project) and `past_lead` (led
  this project last term, nothing this term). Those last two are the fixtures most negative tests
  need: one covers the project boundary, the other the semester boundary.
- Fixtures live in the term the test DB's migration created, reached via `conftest.current_term()`;
  `past_semester` sits the other side of the boundary. **Never hardcode a calendar date in a test**
  — `occurred_on` decides which term an entry lands in, so a fixed date drifts out of the open term
  as time passes. Use offsets from `timezone.localdate()`.
- When adding a module, extend `apps/projects/tests/test_permissions.py` alongside it. That file is
  the regression net for every endpoint's role behaviour.
- `AUTH_FAKE_GOOGLE_TOKENS` accepts a plain JSON claims blob instead of a signed token. It exists
  in the dev and test settings only and must never reach `prod.py`.
- Frontend `.npmrc` sets `legacy-peer-deps=true` because `openapi-typescript` still declares a
  TypeScript `^5.x` peer range while this project runs TypeScript 6. It works; the range is stale.
  Remove the flag once upstream widens it.

## Deferred: photos and video

MOVs and MOMs are **text-only for now**. Media was deliberately cut from v1.

A Google service account has **no Drive storage quota of its own**, so uploading into a folder that
lives in someone's *My Drive* fails with `403 storageQuotaExceeded` regardless of the owner's free
space. It only works against a **Shared Drive** (org-owned, drawn from BITS's pooled storage) or
via OAuth delegation as a real user holding a refresh token. Which of those applies to Nirmaan's
existing project Drives was not settled, so uploads were dropped rather than guessed at.

The agreed design for when it lands: one Drive folder per project; the backend grants each member's
`@pilani` address read access via the Drive API on join; the SPA embeds Drive preview/thumbnail
URLs so Google enforces auth against the viewer's own session. No media bytes flow through our
server, and the external PR team can open the same folder natively.
`Project.drive_folder_url` already exists as the seam.

## Open questions

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

**Roster and semester editing have API support but no UI.** `MembershipViewSet` and
`SemesterViewSet` are full `ModelViewSet`s, but the SPA only reads them — `ProjectMembersPanel` has
no mutations and `queries.ts` only ever `GET`s `/api/semesters/`. So adding a member to a project
and opening a term both mean Django admin or a raw API call today. This is what makes the two
questions above sharp rather than theoretical.

**Attendance stops at counts, by decision.** No hours (a short call and a full-day visit weigh the
same), no per-person view across projects, and no visit record independent of a filed MOV — so a
trip nobody writes up did not happen as far as the table is concerned. Each was considered and left
out; revisit only if someone asks for volunteer-hour certificates, which is the use case that would
need all three.
