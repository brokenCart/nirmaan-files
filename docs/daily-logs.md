# Daily logs and attendance

MOVs and MOMs, the one table behind both, and the counts derived from their attendees.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

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
deliberate — see [*Open questions*](open-questions.md).
