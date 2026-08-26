"""Roster services: semester rollover, and discarding unclaimed placeholders.

Opening a term clones the previous term's roster into it. Without that, the day
a semester ticks over every project would have no members — including the lead,
who would then be locked out of building the roster they were supposed to build.
Leads prune graduates and add newcomers afterwards; the copy is a starting
point, not the final record.
"""

from __future__ import annotations

from .models import Membership, Semester


def previous_semester(semester: Semester) -> Semester | None:
    """The term immediately before ``semester``, by start date."""
    return Semester.objects.filter(starts_on__lt=semester.starts_on).order_by("-starts_on").first()


def carry_forward_roster(semester: Semester, *, source: Semester | None = None) -> int:
    """Copy ``source``'s active memberships into ``semester``. Returns the count.

    Idempotent: rows already present for a (user, project) pair in the target
    term are left alone, so re-running never overwrites a role a lead has since
    corrected. Returns 0 when there is no earlier term — the first semester ever
    opened starts empty by definition.
    """
    if source is None:
        source = previous_semester(semester)
    if source is None:
        return 0

    taken = set(Membership.objects.filter(semester=semester).values_list("user_id", "project_id"))
    carried = [
        Membership(
            user_id=membership.user_id,
            project_id=membership.project_id,
            semester=semester,
            role=membership.role,
            is_active=True,
        )
        for membership in Membership.objects.filter(semester=source, is_active=True)
        if (membership.user_id, membership.project_id) not in taken
    ]
    Membership.objects.bulk_create(carried)
    return len(carried)


def discard_placeholder_user(user) -> bool:
    """Delete ``user`` if they are an unclaimed placeholder nothing else needs.

    A lead can add someone by email before that person has ever signed in, which
    creates a `User` row with ``google_sub`` still NULL. Taking such a row off a
    roster should take the row with it — otherwise a typo'd address leaves an
    account nobody can ever claim sitting in the table forever.

    "Unclaimed" is necessary but nowhere near sufficient, because
    ``Membership.user`` cascades and the log tables point here too. Deleting is
    refused when the row is still load-bearing:

    - **another membership** — a placeholder added to two projects, or carried
      into a past term, is one CASCADE away from vanishing off a roster the
      caller has no business touching. This is the dangerous one: it would let
      a lead of one project silently empty a seat on another.
    - **an authored entry** — ``DailyLog.author`` is PROTECT, so this would
      raise rather than cascade. Unreachable in practice (you cannot file an
      entry without signing in, and signing in claims the row) but guarded
      rather than left to surface as a 500.
    - **an attendance mark** — ``DailyLog.attendees`` is a plain M2M and would
      drop silently, quietly restating who was at a visit and moving the
      counts. A placeholder absolutely can be marked present: recording who
      turned up is the reason a lead adds them before they sign in.
    - **a resource they added** — ``Resource.added_by`` is PROTECT for the same
      reason ``DailyLog.author`` is, and unreachable for the same reason. Left
      unchecked it would surface as a 500 on an otherwise ordinary removal.
    - **anything in the knowledge base** — ``ArticleRevision.edited_by``,
      ``Article.created_by`` and ``Article.updated_by`` are all PROTECT. The
      revision check is the broad one and in practice subsumes the other two,
      since ``record_revision`` writes ``updated_by`` and the revision row
      together and a page's creator always owns its first version; both are
      still asserted rather than left resting on that invariant, because the
      cost of it being wrong is the 500 this function exists to avoid. Note
      that a soft-deleted page still holds its references, so a placeholder who
      started a page that was later removed is correctly refused.

    Call *after* the membership row is gone, so "no remaining memberships" is a
    question about what is left. Returns whether the user was deleted.
    """
    if user.google_sub is not None:
        return False
    if user.memberships.exists():
        return False
    if user.authored_logs.exists():
        return False
    if user.attended_logs.exists():
        return False
    if user.added_resources.exists():
        return False
    if user.article_revisions.exists():
        return False
    if user.authored_articles.exists() or user.edited_articles.exists():
        return False

    user.delete()
    return True
