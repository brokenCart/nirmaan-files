"""Semester rollover.

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
