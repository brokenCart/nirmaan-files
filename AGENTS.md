# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

Project tracking for Nirmaan, a student-run NGO at BITS Pilani, Pilani campus. A *vertical* is
called a **project** in Nirmaan's vocabulary, and that word means a `projects.Project` row
throughout the codebase — never a software project.

Four modules are tracked per project:

1. **Daily logs** — MOVs (Moments of Visit) and MOMs (Minutes of Meeting) — ✅ shipped, with
   per-semester counting and a project archive
2. **Knowledge base** — ✅ shipped as collaborative Markdown pages with complete revision history
   (`apps/knowledge`); see *Knowledge base* below
3. **Volunteer visit tracking** — ✅ shipped as per-member attendance counts; see *Attendance*
   below for the scope, which stops at counts by decision rather than for want of finishing.
   There is no `apps/visits`: counting derives from `DailyLog.attendees` and lives in
   `apps/logs/stats.py`.
4. **Resource links** — Drive URLs and similar — ✅ shipped (`apps/resources`). See *Resource
   links* below. The Drive folder is a resource like any other; there is no separate field for it.

Django REST Framework backend, React + TypeScript SPA, one repo, PostgreSQL.

## Commands

All backend commands run from `backend/`, all frontend commands from `frontend/`.

```bash
# Database (host port 5433 — 5432 is usually taken by another project)
docker compose up -d db

# Backend
uv run python manage.py migrate
uv run python manage.py runserver
uv run python manage.py seed_demo --reset      # demo projects, every role, sample content
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

### Managing a roster

`MembershipViewSet` is the write side of the roster, and `_assert_can_manage` is the rule: exec
bypasses, otherwise the caller must be `LEAD` **this term** and the row must belong to the open
term. A lead cannot touch a closed term at all — last term's roster is the record of who filed the
entries now sitting in the archive, so rewriting it would restate who was there.

**A lead hands out `VOLUNTEER` and nothing else** (`LEAD_ASSIGNABLE_ROLES`). Lead and finance lead
carry the money and the roster itself, so a lead who could name them could appoint their own
successor, or a second lead, with nobody above them in the loop. Exec appoints staff.

`_assert_can_manage` therefore takes **every role the write touches**, not just the new one:

- create — the role being granted, defaulting to `VOLUNTEER` when the field is omitted, since the
  model default would otherwise slip past the check unexamined;
- update — the row's current role *and* what it would become. Checking only the target would leave
  the rule one PATCH from moot (add a volunteer, then promote them); checking only the current role
  would let a lead demote the finance lead sitting beside them.
- destroy — the row's current role, so removing staff is exec's too. A lead can still remove a
  volunteer.

Being able to *see* a role is unaffected: the roster reads the same for everyone.

The SPA renders this in `ProjectMembersPanel` (the timeline's left rail), which shows an
**Add member** form when `canManageRoster` in `src/api/types.ts` says so. That predicate mirrors
`_assert_can_manage` and takes `isExec` **separately from `role`**, because `roleIn` reports a
project membership in preference to the committee marker — an exec who also volunteers on the
project comes back `VOLUNTEER`, and gating on `role === 'EXEC'` would hide a form the server would
have accepted. `assignableRoles` alongside it mirrors `LEAD_ASSIGNABLE_ROLES`, so a lead gets a
line of text where exec gets a picker — a `<select>` that cannot select anything reads as broken
rather than as a rule.

Two things the form does deliberately:

- **It posts `semester` explicitly** rather than letting the serializer default to the current
  term. Exec correcting a past roster is a supported case, and the default would silently retarget
  it. The rail is per-term already, so the term on screen is the term written to; the `all` view
  names no single term and falls back to the open one, which the submit button then labels.
- **It identifies the person by email, not id.** A lead can add someone who has never signed in;
  `MembershipSerializer.create` makes a placeholder user that is adopted on their first Google
  login by the `sub`-then-email match in `apps/accounts/services.py`.

The panel renders for a caller who can manage it even when the roster is **empty** — that is
exactly the term that needs building, and hiding the rail until someone is already on it would
leave a lead with no way in.

**Removing takes an unclaimed placeholder with it.** `perform_destroy` deletes the membership and
then calls `discard_placeholder_user` (`apps/projects/services.py`), which deletes the `User` row
only when it is genuinely disposable — otherwise a typo'd address leaves an account nobody can ever
claim. "Unclaimed" (`google_sub IS NULL`) is necessary but nowhere near sufficient, because
`Membership.user` is **CASCADE** and both log tables point at users. It refuses while the row still
has:

- **another membership** — the dangerous one. A placeholder on two projects, or carried into a past
  term, would vanish off a roster the caller has no authority over, and the archive would lose a
  member. One CASCADE, silently, across the project boundary the whole permission model exists to
  hold.
- **an authored entry** — `DailyLog.author` is PROTECT, so this raises rather than cascades.
  Unreachable in practice (filing needs a login, and logging in claims the row) but guarded rather
  than left to surface as a 500.
- **an attendance mark** — `DailyLog.attendees` is a plain M2M and drops silently, restating who
  was at a visit and moving the counts. A placeholder can absolutely be marked present: recording
  who turned up is *why* a lead adds someone before they sign in.
- **a resource they added** — `Resource.added_by` is PROTECT. Unreachable in practice for an
  unclaimed user, but an explicit guard turns a broken invariant into "keep the account" rather
  than a 500 during an ordinary roster removal.
- **anything in the knowledge base** — `Article.created_by`, `Article.updated_by` and
  `ArticleRevision.edited_by` are all PROTECT. The revision reference is normally the broad one,
  but all three are checked rather than relying on that invariant; soft-deleted pages count too,
  because their content and history deliberately remain in the database.

So the rule is "remove the roster row always, delete the account only when nothing is left pointing
at it". Removing is a hard delete, unlike a log — a roster row is a fact about the present term,
not a published account of something that happened.

`UserSerializer.has_signed_in` exposes `google_sub IS NOT NULL` as a boolean — the useful fact
without the identifier — so the SPA can word the confirmation honestly. It says the account is
*unclaimed*, not that it will definitely be deleted, because the server makes the final call.

**Nobody removes their own row** (`_assert_not_self`), exec included, and `is_active=False` counts
as removal — it drops the row from the roster, the attendance table and the member count exactly as
a DELETE does, so both hooks check it. Leaving is someone else's action: it keeps the only lead
from stranding a roster nobody can then manage, and an exec from quietly clearing themselves
mid-term. Only removal is blocked — editing your own row's *role* is not leaving.

For a lead this is belt and braces, since their own row is a `LEAD` row and the staff rule already
refuses it; the case the self rule actually adds is **exec**, who bypasses every other check.
Authority is asserted before selfhood, so someone with no business touching the roster still gets
the generic refusal rather than a hint about whose row it is.

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

### Resource links

`apps.resources.Resource` is a named link on a project's shelf — the Drive folder, the term plan,
the feedback form. `GET /api/resources/?project=<slug>` is the shelf; the SPA renders it at
`/projects/:slug/resources`.

**A resource carries no semester**, and that is the decision to understand before changing
anything here. Logs and memberships are term-scoped because they record what happened or who held
a role then, and their counting restarts each August. Resources and articles instead describe what
exists *now*: the Drive folder is the same folder it was last term. Scoping one would empty every
shelf at rollover and hand each project the problem `carry_forward_roster` exists to solve, for
nothing in return. It follows that there is no frozen archive here either — a link added two terms
ago is still editable, because there is no term to have closed.

What does still resolve against the current term is the *person*. Reads use `visible_project_ids`,
like the timeline, so a past member keeps the shelf. Writes need membership **this** semester, so
someone dropped from the roster mid-term stops changing it.

**The resource edit rule is deliberately wider than a log's.** The knowledge base widens it again,
so the three content types have intentionally different ownership rules:

| | may edit | may remove |
| --- | --- | --- |
| `DailyLog` | the current author, nobody else | current staff/author, or exec |
| `Resource` | the current adder, **current staff, or exec** | the same set |
| `Article` | **any current member, or exec** | current staff/starter, or exec |

An entry is one person's account of what happened, so rewording it under their name misrepresents
them — which is why leads delete rather than edit. A link is not an account of anything. It is a
pointer, and pointers go stale: when a Drive folder moves, the lead has to be able to fix the URL
without hunting down the volunteer who first pasted it. An article is collectively owned and keeps
every version, so any current member may correct it; see *Knowledge base* below.

Resource deletes are **hard**, unlike logs and articles. A stale pointer left as a tombstone serves
nobody, and whatever it pointed at is still in Drive either way; the other two rows hold the
content itself, so their removal is reversible.

Two smaller things:

- **The scheme is pinned to http/https.** `web_url_validator` in `models.py` guards the admin and
  the shell, but **not** the API: DRF strips every `URLValidator` off a model `URLField` and
  substitutes its own, which also accepts `ftp`. `ResourceSerializer.validate_url` therefore runs
  the same validator by hand — both call the one object, so the two cannot drift.
- **The list is unpaginated** (`pagination_class = None`). A shelf is a reference list that gets
  scanned, not a feed that gets read, and paging a dozen links hides half of them behind a control
  nobody expects on that screen. Note that this makes the response a bare array, not DRF's
  `{count, results}` envelope — `useResources` types it accordingly.

`Resource.added_by` is PROTECT, matching `DailyLog.author`, so `discard_placeholder_user` checks it
before deleting an unclaimed account. Unreachable in practice for the same reason the authored-log
case is, but an unguarded PROTECT surfaces as a 500 on an ordinary roster removal.

**`Project.drive_folder_url` is gone** (`projects.0003`). It predated this module as the one link a
project could hold, and once a project can hold any number the field was a second, special-cased
place to put a Drive URL — one the SPA could only ever read, so setting it meant the Django admin.
A folder is now a `Resource` with `kind=FOLDER`, added and fixed by the same people through the
same screen, and validated by the same `web_url_validator` (the old field was a plain `URLField`
and would have taken an `ftp://`).

The migration carries existing values across rather than dropping them, and two things about it are
worth knowing:

- **`added_by` is a guess.** Nothing recorded who set the field, and the column is NOT NULL, so
  each row is attributed to the project's most recent lead — who *would* have set it — with an exec
  as fallback and a `pk` tiebreak so two leads in one term cannot make the migration answer
  differently on a replay. Same class of guess as `0002`'s backfilled rosters.
- **The reverse restores only where it is unambiguous.** Nothing marks which row came from the
  field, so a project with one `FOLDER` resource gets it back and a project with several is left
  blank rather than handed a folder that was never in the column. Matching on the row's title would
  look exact and break the moment somebody names their own folder the same thing. Nothing is lost
  either way — the rows stay on the shelf, which is where the URLs live now.

### Knowledge base

`apps.knowledge.Article` is a Markdown page of context, process, partner information or lessons
learned. `GET /api/articles/?project=<slug>` is the index, and the SPA renders it at
`/projects/:slug/knowledge`; `/api/articles/<id>/revisions/` returns its complete history.

**An article has no semester and no draft state.** Like a resource, it describes what is true now,
not what happened on a date, so putting it in a term would empty the knowledge base at rollover.
Unlike a log draft, a half-written handover page must not become invisible forever when its author
graduates. Written is published to the project immediately; the revision trail is what makes early
and collaborative writing safe.

Reads use `ArticleQuerySet.visible_to`, so anyone who has belonged to the project in any semester
keeps the pages and their histories; foreign-project rows are filtered out and therefore 404.
Writes use the current roster. Exec bypasses as usual, while a past member has read-only access.

The defining rule is that **any current member may edit any article**, regardless of who started
it. A shared statement of current practice would quickly go stale if only its original author
could fix it. Every meaningful API save records a complete `ArticleRevision` snapshot — title,
body, category, editor, timestamp and optional note — and creation records version one. Restoring
an old version is an ordinary edit that appends another snapshot; it never rewinds or deletes
history. A no-op save creates no revision and does not change `updated_by`. Create and update wrap
the article and revision writes in one transaction, and `updated_by` is denormalized from the
newest revision.

Removal is deliberately narrower: exec, current staff, or the current member who started the page
may remove it. Deletes are **soft** (`is_deleted`), because the article row is the content this
module exists to preserve, and all of its revisions remain. This differs from the resource shelf,
where the row is only a pointer and deletion is hard.

The live `(project, title)` pair is unique under a partial constraint, so a removed page releases
its title without losing its tombstone. `project` is rejected on update because permission was
checked against the project the article already belongs to. The index is unpaginated and carries a
240-character excerpt instead of each body; `?category=` and `?q=` filter it, with the latter using
a case-insensitive substring match across titles and bodies. Detail responses carry the full body.

The SPA renders bodies with `react-markdown`, which creates React elements without enabling raw
HTML, and opens page-authored links in a separate, non-opener tab. Keep that trust boundary intact
if Markdown plugins are added later.

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
- TypeScript is pinned to the latest 5.x release because `openapi-typescript` still declares a
  `^5.x` peer range. Keep the two compatible so ordinary `npm install`, `npm ci`, and `npm ls`
  work without `legacy-peer-deps`.

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

The seam is the project's `FOLDER` resource — `Project.drive_folder_url` used to be it and was
removed in `projects.0003` (see *Resource links*). Note that nothing constrains a project to one
`FOLDER` row, so that work has to decide which one it uploads into rather than assuming.

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

**Opening a semester has API support but no UI.** `SemesterViewSet` is a full `ModelViewSet`, but
`queries.ts` only ever `GET`s `/api/semesters/`, so creating a term still means Django admin or a
raw API call — which is what makes the question above sharp rather than theoretical. Roster editing
*does* have a screen now (see *Managing a roster*); semester creation is the one that does not.

**Attendance stops at counts, by decision.** No hours (a short call and a full-day visit weigh the
same), no per-person view across projects, and no visit record independent of a filed MOV — so a
trip nobody writes up did not happen as far as the table is concerned. Each was considered and left
out; revisit only if someone asks for volunteer-hour certificates, which is the use case that would
need all three.
