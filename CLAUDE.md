# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Project tracking for Nirmaan, a student-run NGO at BITS Pilani, Pilani campus. A *vertical* is
called a **project** in Nirmaan's vocabulary, and that word means a `projects.Project` row
throughout the codebase — never a software project.

Four modules are planned per project. Only the first is built:

1. **Daily logs** — MOVs (Moments of Visit) and MOMs (Minutes of Meeting) — ✅ shipped
2. **Knowledge base** — past context, lore — planned (`apps/knowledge`)
3. **Volunteer visit tracking** — planned (`apps/visits`)
4. **Resource links** — Drive URLs and similar — planned (`apps/resources`)

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

### Roles are per-project, not global

This is the load-bearing design decision. A person can be Lead of *Shiksha* and a plain Volunteer
of *Aarogya* at the same time. The only org-wide role is Executive Committee.

- `accounts.User.is_exec` — org-wide, grants read across every project without any membership row.
- `projects.Membership(user, project, role)` — everything else. `role` ∈ `LEAD`, `FINANCE_LEAD`,
  `VOLUNTEER`, one row per (user, project).

**Do not model roles as Django Groups or as a field on `User`.** That flattens the per-project
distinction and there is no way back once data exists.

Resolution lives in `apps/projects/permissions.py`:

- `membership_roles(request)` — `{project_id: role}` for the requesting user, cached on the request
  object so a list endpoint checking N objects issues one query, not N.
- `IsProjectMember` — object belongs to a project the user is in.
- `require_roles(*roles)` → a permission class; `IsProjectLead` and `IsProjectStaff` are the
  prebuilt ones. Reads are open to any member, writes are limited to the named roles, exec bypasses.
- `visible_projects(user)` / `visible_project_ids(request)` — for queryset scoping.

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
query. `location` is MOV-only, `attendees` is MOM-only, and the serializer rejects each on the
wrong kind. Split into two models only if the kinds genuinely diverge.

Writes: leads and finance leads may edit anything in their project; a volunteer may create logs and
edit their own only while `status == DRAFT`. Once published, a volunteer's log is the project's
record. Deletes are soft (`is_deleted`) — the timeline is institutional memory.

Drafts are private to their author, enforced in `DailyLogQuerySet.visible_to`.

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
  `volunteer`, `exec_user`, and `outsider` (a member of a *different* project, which is the fixture
  most negative tests need).
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

## Open question

A first-time sign-in creates a user with **no memberships**, who therefore sees nothing until a
lead or exec adds them to a project. That is the current behaviour and the login screen says so.
Whether new users should instead auto-join a default project has not been decided.
