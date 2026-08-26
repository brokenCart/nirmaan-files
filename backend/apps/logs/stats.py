"""Per-member attendance counts for one project's timeline.

Attendance is what `DailyLog.attendees` is for: a member's visit count is the
number of published MOVs they were present at, and their meeting count the
same for MOMs.
"""

from django.db.models import Count, Q, QuerySet

from apps.projects.models import Membership

from .models import LogKind, LogStatus


def _attended(project, kind: str) -> Count:
    """Count of ``kind`` entries on ``project`` that the member attended.

    Drafts are excluded because they are private to their author — counting
    them would let one member infer another's unpublished work from a total.
    Soft-deleted entries are excluded for the same reason they leave the
    timeline: they are no longer part of the project's record.
    """
    return Count(
        "user__attended_logs",
        filter=Q(
            user__attended_logs__project=project,
            user__attended_logs__kind=kind,
            user__attended_logs__status=LogStatus.PUBLISHED,
            user__attended_logs__is_deleted=False,
        ),
        distinct=True,
    )


def attendance_for(project) -> QuerySet[Membership]:
    """Every active member of ``project``, annotated with `visits`/`meetings`.

    Rows are memberships rather than users so that each row carries the role it
    was earned under, and so a member with no attendance still appears — a zero
    is the point of the table.
    """
    return (
        Membership.objects.filter(project=project, is_active=True)
        .select_related("user")
        .annotate(
            visits=_attended(project, LogKind.MOV),
            meetings=_attended(project, LogKind.MOM),
        )
        .order_by("-visits", "-meetings", "user__full_name", "user__email")
    )
