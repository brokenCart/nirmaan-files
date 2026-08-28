# AGENTS.md

Guidance for coding agents working in this repository — Claude Code, Codex, and anything else that
reads an agents file.

**Start here, then follow the table below to the file for what you are touching.** This file is
deliberately short: it carries only the rules that apply to every change, so that it costs little to
load into every session. The module-specific detail lives in `docs/`.

`CLAUDE.md` is a one-line `@AGENTS.md` import and nothing else, because Claude Code reads
`CLAUDE.md` and not this file. Put instructions here or in `docs/`; never copy them into
`CLAUDE.md`. The two files were maintained as separate copies of the same document until they
drifted, which is why they were merged.

## What this is

Project tracking for Nirmaan, a student-run NGO at BITS Pilani, Pilani campus. A *vertical* is
called a **project** in Nirmaan's vocabulary, and that word means a `projects.Project` row
throughout the codebase — never a software project.

Five modules are tracked per project, all shipped:

1. **Daily logs** — MOVs (Moments of Visit) and MOMs (Minutes of Meeting), with per-semester
   counting and a project archive (`apps/logs`)
2. **Knowledge base** — collaborative Markdown pages with complete revision history
   (`apps/knowledge`)
3. **Volunteer visit tracking** — per-member attendance counts. **There is no `apps/visits`**:
   counting derives from `DailyLog.attendees` and lives in `apps/logs/stats.py`, and it stops at
   counts by decision rather than for want of finishing.
4. **Resource links** — Drive URLs and similar (`apps/resources`). The Drive folder is a resource
   like any other; there is no separate field for it.
5. **Reimbursements** — volunteers claim money back, the project finance lead approves or rejects
   (`apps/reimbursements`). Text-only for now; receipt images are deferred for the same Drive
   reason media is everywhere else.

The table under [*Where the rest of it is*](#where-the-rest-of-it-is) says which file to read for
each.

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

## Where the rest of it is

This file holds only what applies to **every** change. Everything module-specific lives in `docs/`,
one file per area, and is not loaded until you need it — **read the relevant file before changing
code in that area.** Each carries rules whose rationale is not recoverable from the code, so
skipping it means rediscovering a decision by breaking it.

| Working on | Read first | Why it is not obvious from the code |
| --- | --- | --- |
| Semesters, term rollover, the archive | [`docs/semesters.md`](docs/semesters.md) | Terms are rows, not a formula; opening one copies the roster forward |
| Membership rows, adding/removing members | [`docs/roster.md`](docs/roster.md) | A lead may hand out only `VOLUNTEER`; removal can delete the user |
| Sign-in, tokens, the campus domain gate | [`docs/auth.md`](docs/auth.md) | The frontend `hosted_domain` prop is **not** the security control |
| MOVs, MOMs, attendance counts, the export | [`docs/daily-logs.md`](docs/daily-logs.md) | Only the author edits, at any status, with no role override |
| The resource shelf | [`docs/resources.md`](docs/resources.md) | Carries no semester; DRF silently drops the model's URL validator |
| Knowledge base pages and revisions | [`docs/knowledge-base.md`](docs/knowledge-base.md) | Any current member edits any page; every save snapshots |
| Reimbursement requests and review | [`docs/reimbursements.md`](docs/reimbursements.md) | A volunteer sees only their own rows; `FINANCE_LEAD` ≠ `LEAD` here |
| Anything wanting file upload | [`docs/deferred-media.md`](docs/deferred-media.md) | Blocked on a Drive quota question, not on effort |
| Whether something is settled | [`docs/open-questions.md`](docs/open-questions.md) | Several gaps are deliberate rather than unfinished |

Adding a module means adding a file here and a row above, not another section in this file.

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

### Permission classes gate actions; querysets hide rows

A DRF permission class only ever sees objects the queryset already returned. Every list endpoint
must narrow `get_queryset()` independently — see `ProjectViewSet.get_queryset` and
`DailyLogQuerySet.visible_to`. Getting this wrong leaks other projects' data even though the
permission class looks correct.

A consequence worth knowing: hitting a project you are not a member of returns **404, not 403**.
That is deliberate — 403 would confirm the project exists. Tests assert the 404.

### The three content types have deliberately different ownership

The single most useful thing to know before touching any write rule. These are not an inconsistency
to be tidied up — each row records a different kind of thing, and the edit rule follows from that.
The detail, and the reasoning, is in each module's file.

| | may edit | may remove |
| --- | --- | --- |
| `DailyLog` | the current author, nobody else | current staff/author, or exec |
| `Resource` | the current adder, **current staff, or exec** | the same set |
| `Article` | **any current member, or exec** | current staff/starter, or exec |
| `Reimbursement` | the submitter, **and only while `PENDING`** | current staff/submitter while `PENDING`, else exec |

An entry is one person's account of what happened, so rewording it under their name misrepresents
them — staff delete rather than edit. A link is a pointer that goes stale, so whoever runs the
project can fix it. An article is collectively owned and keeps every version. A claim is a statement
about money that somebody signs, so it stops changing at the signature.

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
  the regression net for every endpoint's role behaviour. What belongs there is the project and
  semester boundaries; a module's own rules live in its own test package (see
  `apps/reimbursements/tests/`, which holds the review workflow while `test_permissions.py` holds
  only the two boundaries).
- `AUTH_FAKE_GOOGLE_TOKENS` accepts a plain JSON claims blob instead of a signed token. It exists
  in the dev and test settings only and must never reach `prod.py`.
- TypeScript is pinned to the latest 5.x release because `openapi-typescript` still declares a
  `^5.x` peer range. Keep the two compatible so ordinary `npm install`, `npm ci`, and `npm ls`
  work without `legacy-peer-deps`.
