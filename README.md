# Nirmaan Files

Project tracking for [Nirmaan](https://www.nirmaan.org/), the student-run NGO at BITS Pilani,
Pilani campus.

Nirmaan runs several *verticals* — called **projects** here. Each one accumulates field visits,
meetings, and context, and today none of it lives anywhere durable: institutional memory leaves
with every graduating batch. This app is the shared record.

Four things are tracked per project:

| Module | Status |
| --- | --- |
| **Daily logs** — MOVs (Moments of Visit) and MOMs (Minutes of Meeting) | ✅ shipped |
| **Knowledge base** — past context and how-things-work | planned |
| **Volunteer visit tracking** — who showed up, when | ◐ counts shipped, see below |
| **Resource links** — Drive folders and other pointers | planned |

Adding someone to a project and opening a new semester are exec/lead jobs that currently have **no
screen** — the API supports both, but they are done through the Django admin at `/admin/` for now.

## Daily logs

Every entry is a MOV or a MOM on one project's timeline, and both kinds carry an **attendee list** —
that list is what visit and meeting counts are derived from, so mark who was actually there.
Entries are text-only for now; photos and video are deferred (`CLAUDE.md` explains why).

Who may do what:

- **Anyone in the project** can file an entry, and save it as a private draft first.
- **Only the author** can edit their own entry — at any point, published or not. No role overrides
  this, leads and exec included: an entry is one person's account of what happened.
- **Leads, finance leads and exec** can *remove* any entry in their project, and an author can
  withdraw their own. That is the moderation lever instead of editing — you delete an entry you
  disagree with rather than reword it under someone else's name. Deletes are soft, so nothing
  actually leaves the database.

## Attendance

Each project has an attendance view at `/projects/<slug>/attendance` — per-member visit and meeting
counts as a table and a bar chart, with an **Export to Excel** button that downloads a `.xlsx`.

Only published entries count. Drafts are private to their author, and counting them would leak
their existence through a total; removed entries stop counting for the same reason they leave the
timeline.

Counts are **headcounts, not hours** — a half-hour call and a full-day site visit each count once —
and they are per project, so someone active in two verticals has no combined total. A visit also
only counts if a MOV was actually filed for it. All three are deliberate for now; `CLAUDE.md`
records why under *Open questions*.

Behind it, `GET /api/projects/<slug>/attendance/` returns the rows and
`GET /api/projects/<slug>/attendance/export/` returns the workbook. Any member of the project can
read both.

## Stack

Django 6 + Django REST Framework on Python 3.14, PostgreSQL 17, React 19 + TypeScript on Vite,
Tailwind 4. Sign-in is Google, restricted to `@pilani.bits-pilani.ac.in`.

## Running it

```bash
cp .env.example .env          # then fill in GOOGLE_OAUTH_CLIENT_ID / VITE_GOOGLE_CLIENT_ID
docker compose up --build
```

The API is on `http://localhost:8000`, the app on `http://localhost:5173`, and interactive API
docs on `http://localhost:8000/api/docs/`.

> **After a pull that changes dependencies, rebuild:** `docker compose up -d --build backend`.
> Compose bind-mounts `./backend` into the container, so code changes are picked up live — but the
> virtualenv lives in the *image*. A new entry in `pyproject.toml` is therefore missing until you
> rebuild, and Django dies at import with `ModuleNotFoundError`. The container still reports "Up"
> while holding port 8000, so the symptom is **502 Bad Gateway** from the Vite proxy rather than an
> obvious crash — check `docker compose logs backend`.

To work without Docker, start just the database (`docker compose up -d db`) and run the two
halves directly:

```bash
cd backend  && uv run python manage.py migrate && uv run python manage.py runserver
cd frontend && npm install && npm run dev
```

### Google credentials

Create an **OAuth 2.0 Web client** in the
[Google Cloud console](https://console.cloud.google.com/apis/credentials) with
`http://localhost:5173` as an authorised JavaScript origin, then put the client ID into both
`GOOGLE_OAUTH_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`.

To develop without Google credentials at all, set `AUTH_FAKE_GOOGLE_TOKENS=true` and post a plain
JSON claims blob where a signed token would go. This exists only in the dev settings module.

### Demo data

```bash
cd backend && uv run python manage.py seed_demo --reset
```

Creates three projects with a lead, a finance lead, and two volunteers each, one exec-committee
account, and sample MOV/MOM entries with attendees on both — including a person who leads one
project while volunteering in another, which is the case the permission model exists for.

If your database predates attendees on visits, existing MOVs have none and every visit count reads
zero until entries are edited or the data is re-seeded. `--reset` drops the existing rows.

## Tests

```bash
cd backend && uv run pytest
```

## Contributing

`CLAUDE.md` documents the architecture, the permission model, and the conventions to follow.
Read it before adding a module.
