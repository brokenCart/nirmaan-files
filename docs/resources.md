# Resource links

A project's shelf of Drive URLs and other pointers.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

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

**The resource edit rule is deliberately wider than a log's**: whoever added the link, current
staff, or exec. The full comparison across all four content types is the table in
[AGENTS.md](../AGENTS.md#the-three-content-types-have-deliberately-different-ownership), which is
the one copy — do not restate it here.

The reason for the width is specific to this module. An entry is one person's account of what
happened, so rewording it under their name misrepresents them, which is why leads delete rather
than edit. A link is not an account of anything. It is a pointer, and pointers go stale: when a
Drive folder moves, the lead has to be able to fix the URL without hunting down the volunteer who
first pasted it.

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
