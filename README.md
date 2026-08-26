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
| **Knowledge base** — past context and how-things-work | ✅ shipped |
| **Volunteer visit tracking** — who showed up, when | ✅ shipped |
| **Resource links** — Drive folders and other pointers | ✅ shipped |

Opening a new semester still has **no screen** — the API supports it, but exec does it through the
Django admin at `/admin/` for now. Roster changes do have one: see *Adding members* below.

## Daily logs

Every entry is a MOV or a MOM on one project's timeline, and both kinds carry an **attendee list** —
that list is what visit and meeting counts are derived from, so mark who was actually there.
Entries are text-only for now; photos and video are deferred (`CLAUDE.md` explains why).

Who may do what:

- **Any current member, and exec** can file an entry, and save it as a private draft first.
- **Only the author** can edit their own entry while its semester is open, and a former member
  loses that access — whether the entry is published or still a draft. No role overrides this,
  leads and exec included: an entry is one person's account of what happened.
- **Current leads, finance leads and the author** can *remove* an open-term entry; exec can remove
  one from any term. That is the moderation lever instead of editing — you delete an entry you
  disagree with rather than reword it under someone else's name. Deletes are soft, so nothing
  actually leaves the database.

A closed semester is frozen: nobody edits its entries, and only exec retains the removal lever.

## Knowledge base

Each project has a searchable knowledge base at `/projects/<slug>/knowledge` for the context,
processes, partner details and lessons that the next batch should not have to rediscover. Pages
support Markdown and are grouped by topic; search matches both names and page contents.

Unlike a timeline entry, a knowledge page is **shared writing**:

- **Any current member, and exec**, can start a page or edit any existing page. A phone number or
  process should not stay wrong just because the person who first wrote it has graduated.
- Every meaningful save creates a complete, attributed version in the page history. An optional
  change note explains what moved, and restoring an older version adds it as a new version rather
  than erasing the edits made since.
- **A current member who started the page, leads, finance leads and exec** can remove it. Removal
  is soft, so its text and history remain in the database.

Pages are not tied to semesters and have no private draft state: they describe what is true now,
not what happened on a date. A former member therefore keeps read-only access to the pages and
their histories, while writing remains limited to this semester's roster.

## Adding members

A project **lead** builds their own roster from the members panel on the project timeline — *Add
member* and an email address. Exec can do the same on any project.

A lead can only add **volunteers**. Appointing a project lead or a finance lead is the Executive
Committee's call, and so is changing or removing one: a lead who could name their own successor —
or a second lead — would have nobody above them in the loop. A lead can still remove a volunteer
from the roster.

The person does not need to have signed in yet. Adding `f20230000@pilani.bits-pilani.ac.in` creates
a placeholder that they take over the first time they sign in with Google, which is how a lead can
set up a term's roster before anyone has logged in. Only `@pilani.bits-pilani.ac.in` addresses are
accepted.

Rosters are **per semester**, so a member is added to one term, and the term being viewed is the
term written to. A lead can only change the open term: last semester's roster is the record of who
filed the entries in the archive, so it stays as it was. Exec can correct a past term, which
matters because the rosters for terms predating this feature were reconstructed from a guess.

Promotions are a new row, not an edit — someone who volunteers this term and leads the next is both
of those things, each against the term it was true in. Exec files that row.

**Removing** works the same way round: the bin on a roster row takes that person off this term. A
lead can remove volunteers, exec anyone — but **nobody can remove themselves**, so leaving a
project is something a colleague does for you rather than something you do quietly. That also stops
a project's only lead from stranding a roster nobody is left to manage. If the row was a placeholder nobody has ever signed in to
— a mistyped address, say — the account is deleted along with it, so typos do not pile up as
unclaimable users. That only happens when nothing else needs the account: if they are on another
project, on a past term's roster, marked present at a visit, or attached to a resource or knowledge
page, the account stays and only this term's roster row goes.

## Resources

Each project has a shelf of links at `/projects/<slug>/resources` — the Drive folder, the term
plan, the beneficiary sheet, the feedback form. Each one gets a name, a type and a line saying what
it is for, so the next batch can find things without asking.

This stores **addresses, not files**. Opening a link still needs access to it in Drive; nothing is
uploaded here.

- **Any current member, and exec** can add a link.
- **The current member who added it, current leads, finance leads and exec** can edit or remove it.
  That is wider than the timeline on purpose: a link is a pointer, not somebody's account of what
  happened, and when a Drive folder moves the lead needs to fix the address without tracking down
  whoever pasted it first.
- Removing a link removes the link. The file itself is untouched in Drive.

Unlike the timeline and the roster, the shelf is **not per semester** — a Drive folder is the same
folder next term, so nothing resets in August and nothing is frozen in the archive. What does stop
at the term boundary is who may write: someone off this semester's roster can open the links but
not change them.

The project's Drive folder is just one of these links, added the same way as any other. It used to
be a separate field on the project that only the Django admin could set; if yours had one, it has
been moved onto the shelf for you.

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
account, sample MOV/MOM entries with attendees on both, four resource links and four knowledge
pages per project. One knowledge page has an alumnus-to-current-lead revision trail, and one person
leads a project while volunteering in another — the cases those permission models exist for.

If your database predates attendees on visits, existing MOVs have none and every visit count reads
zero until entries are edited or the data is re-seeded. `--reset` drops the existing rows.

## Tests

```bash
cd backend && uv run pytest
```

## Contributing

`CLAUDE.md` and `AGENTS.md` contain the same architecture, permission model and conventions for
their respective coding agents. Read the one your tool uses before adding a module.
