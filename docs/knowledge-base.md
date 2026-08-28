# Knowledge base

Collaborative Markdown pages with complete revision history.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

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
