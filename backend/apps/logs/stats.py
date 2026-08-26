"""Per-member attendance counts for one project, in one semester.

Attendance is what `DailyLog.attendees` is for: a member's visit count is the
number of published MOVs they were present at, and their meeting count the
same for MOMs.

Both sides of the table are scoped to a single term — the roster comes from
that semester's memberships and the counts from that semester's entries. That
is what "counting restarts each semester" means, and the two must use the same
term or a member shows up against totals they had no part in.
"""

from django.db.models import Count, Q, QuerySet

from apps.projects.models import Membership, Semester

from .models import LogKind, LogStatus


def _attended(project, semester, kind: str) -> Count:
    """Count of ``kind`` entries on ``project`` in ``semester`` the member attended.

    Drafts are excluded because they are private to their author — counting
    them would let one member infer another's unpublished work from a total.
    Soft-deleted entries are excluded for the same reason they leave the
    timeline: they are no longer part of the project's record.
    """
    return Count(
        "user__attended_logs",
        filter=Q(
            user__attended_logs__project=project,
            user__attended_logs__semester=semester,
            user__attended_logs__kind=kind,
            user__attended_logs__status=LogStatus.PUBLISHED,
            user__attended_logs__is_deleted=False,
        ),
        distinct=True,
    )


def attendance_for(project, semester: Semester | None) -> QuerySet[Membership]:
    """``semester``'s members of ``project``, annotated with `visits`/`meetings`.

    Rows are memberships rather than users so that each row carries the role it
    was earned under *in that term* — a volunteer who later became lead is
    still listed as a volunteer against the semester they volunteered in — and
    so a member with no attendance still appears, since a zero is the point of
    the table.
    """
    if semester is None:
        return Membership.objects.none()

    return (
        Membership.objects.filter(project=project, semester=semester, is_active=True)
        .select_related("user")
        .annotate(
            visits=_attended(project, semester, LogKind.MOV),
            meetings=_attended(project, semester, LogKind.MOM),
        )
        .order_by("-visits", "-meetings", "user__full_name", "user__email")
    )
