# Nirmaan Files

Project tracking for [Nirmaan](https://www.nirmaan.org/), the student-run NGO at BITS Pilani,
Pilani campus.

Nirmaan runs several *verticals* — called **projects** here. Each one accumulates field visits,
meetings, context, and volunteer hours, and today none of it lives anywhere durable: institutional
memory leaves with every graduating batch. This app is the shared record.

Four things are tracked per project:

| Module | Status |
| --- | --- |
| **Daily logs** — MOVs (Moments of Visit) and MOMs (Minutes of Meeting) | ✅ shipped |
| **Knowledge base** — past context and how-things-work | planned |
| **Volunteer visit tracking** — who showed up, when | planned |
| **Resource links** — Drive folders and other pointers | planned |

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
account, and sample MOV/MOM entries — including a person who leads one project while volunteering
in another, which is the case the permission model exists for.

## Tests

```bash
cd backend && uv run pytest
```

## Contributing

`CLAUDE.md` documents the architecture, the permission model, and the conventions to follow.
Read it before adding a module.
