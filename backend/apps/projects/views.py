from django.db.models import Count, Q
from django.http import Http404, HttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.logs.exports import attendance_workbook
from apps.logs.models import DailyLog, LogKind, LogStatus
from apps.logs.serializers import AttendanceRowSerializer
from apps.logs.stats import attendance_for

from .models import Membership, Project, Role, Semester
from .permissions import (
    IsExec,
    IsProjectLead,
    IsProjectMember,
    current_semester,
    role_in_project,
    visible_projects,
)
from .serializers import (
    ArchiveTermSerializer,
    MembershipSerializer,
    ProjectSerializer,
    SemesterSerializer,
)

SEMESTER_PARAM = OpenApiParameter(
    name="semester",
    description="Semester slug. Defaults to the term in progress.",
    required=False,
    type=str,
)


class SemesterViewSet(viewsets.ModelViewSet):
    """Academic terms, org-wide.

    Readable by anyone signed in — the SPA needs the list to build its term
    switcher. Only exec opens or edits one, and opening a term carries the
    previous term's roster forward so no project starts the semester empty.
    """

    serializer_class = SemesterSerializer
    permission_classes = [IsAuthenticated, IsExec]
    lookup_field = "slug"
    queryset = Semester.objects.all()

    def perform_create(self, serializer):
        from .services import carry_forward_roster

        semester = serializer.save()
        carry_forward_roster(semester)

    def perform_destroy(self, instance):
        # `DailyLog.semester` is PROTECT, so a term with entries refuses to go.
        # Memberships cascade, which is fine — they are the copy, not the record.
        instance.delete()

    @action(detail=False, methods=["get"])
    def current(self, request):
        """The term in progress, or the last one to have ended."""
        semester = current_semester(request)
        if semester is None:
            return Response(None)
        return Response(SemesterSerializer(semester).data)


class ProjectViewSet(viewsets.ModelViewSet):
    """Projects (verticals).

    Only exec creates or deletes projects; leads may edit their own project's
    details. The queryset — not the permission class — is what keeps one
    project's rows out of another project's members' hands.

    A project stays visible to anyone who has ever been a member of it, so the
    archive outlives the membership. `my_role` reports the *current* term's
    role, and comes back null for someone with archive-only access.
    """

    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated, IsProjectLead]
    lookup_field = "slug"
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = Project.objects.none()

    def get_queryset(self):
        semester = current_semester(self.request)
        return (
            # Through the ids rather than off `visible_projects` directly: that
            # queryset filters on `memberships` to the requesting user, and a
            # `Count("memberships")` annotated onto it would reuse that same
            # join and count only the caller's own rows — every project a
            # roster of one, while exec (whose queryset joins nothing) saw the
            # true number.
            Project.objects.filter(pk__in=visible_projects(self.request.user).values("pk"))
            .annotate(
                # The headline count is this term's roster, not everyone who has
                # ever passed through.
                member_count=Count(
                    "memberships",
                    filter=Q(memberships__is_active=True, memberships__semester=semester),
                    distinct=True,
                )
            )
            .order_by("name")
        )

    def perform_create(self, serializer):
        if not self.request.user.is_exec:
            raise PermissionDenied("Only the Executive Committee can create projects.")
        serializer.save()

    def perform_destroy(self, instance):
        if not self.request.user.is_exec:
            raise PermissionDenied("Only the Executive Committee can delete projects.")
        instance.delete()

    def _requested_semester(self) -> Semester | None:
        """The term named by ``?semester=``, defaulting to the current one."""
        slug = self.request.query_params.get("semester")
        if not slug:
            return current_semester(self.request)
        try:
            return Semester.objects.get(slug=slug)
        except Semester.DoesNotExist as error:
            raise Http404("No such semester.") from error

    # All three read routes are GETs, so `IsProjectLead` lets any member
    # through and `get_queryset` 404s everyone else — reading your own
    # project's counts needs no special role, this term or any past one.

    @extend_schema(parameters=[SEMESTER_PARAM], responses=AttendanceRowSerializer(many=True))
    @action(detail=True, methods=["get"])
    def attendance(self, request, slug=None):
        """Per-member visit and meeting counts for one semester of this project."""
        project = self.get_object()
        rows = attendance_for(project, self._requested_semester())
        return Response(AttendanceRowSerializer(rows, many=True).data)

    @extend_schema(parameters=[SEMESTER_PARAM], responses=ArchiveTermSerializer(many=True))
    @action(detail=True, methods=["get"])
    def archive(self, request, slug=None):
        """Every semester this project has a record in, newest first.

        One row per term: what was filed, how many people were on the roster,
        and who led it. The counts are of published, undeleted entries, matching
        what the attendance table for that term will show.
        """
        project = self.get_object()

        entry_counts = {
            row["semester"]: row
            for row in DailyLog.objects.filter(
                project=project, is_deleted=False, status=LogStatus.PUBLISHED
            )
            .values("semester")
            .annotate(
                visits=Count("pk", filter=Q(kind=LogKind.MOV)),
                meetings=Count("pk", filter=Q(kind=LogKind.MOM)),
            )
        }
        roster_counts = {
            row["semester"]: row["total"]
            for row in Membership.objects.filter(project=project, is_active=True)
            .values("semester")
            .annotate(total=Count("pk"))
        }
        leads: dict[int, list] = {}
        for membership in Membership.objects.filter(
            project=project, is_active=True, role=Role.LEAD
        ).select_related("user", "semester"):
            leads.setdefault(membership.semester_id, []).append(membership.user)

        # A term belongs in the archive if anything happened in it — entries
        # filed, or a roster that existed even if it filed nothing.
        semester_ids = set(entry_counts) | set(roster_counts)
        rows = [
            {
                "semester": semester,
                "visits": entry_counts.get(semester.pk, {}).get("visits", 0),
                "meetings": entry_counts.get(semester.pk, {}).get("meetings", 0),
                "member_count": roster_counts.get(semester.pk, 0),
                "leads": leads.get(semester.pk, []),
            }
            for semester in Semester.objects.filter(pk__in=semester_ids)
        ]
        return Response(ArchiveTermSerializer(rows, many=True).data)

    @extend_schema(
        parameters=[SEMESTER_PARAM],
        responses={
            (200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): (
                OpenApiTypes.BINARY
            )
        },
    )
    # `attendance.xlsx` would collide with DRF's format-suffix patterns; the
    # extension that matters is the one in Content-Disposition.
    @action(detail=True, methods=["get"], url_path="attendance/export")
    def attendance_export(self, request, slug=None):
        """The same counts as a downloadable Excel workbook."""
        project = self.get_object()
        semester = self._requested_semester()
        content = attendance_workbook(project, semester, attendance_for(project, semester))

        response = HttpResponse(
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        stamp = timezone.localdate().isoformat()
        # The slugs keep the filename ASCII, which spares us RFC 5987 encoding.
        term = f"-{semester.slug}" if semester else ""
        filename = f"nirmaan-{project.slug}{term}-attendance-{stamp}.xlsx"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class MembershipViewSet(viewsets.ModelViewSet):
    """Who belongs to which project, in what role, in which semester.

    Managed by project leads and exec. Volunteers can read the roster of
    projects they belong to but cannot change it.

    Rosters are per term and past terms are frozen: a lead manages the current
    semester only, because last semester's roster is the record of who filed
    the entries in the archive. Exec can still correct a past roster, which
    matters because the rows for terms predating this feature were backfilled
    from a guess.
    """

    serializer_class = MembershipSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = Membership.objects.none()

    def get_queryset(self):
        qs = Membership.objects.select_related("user", "project", "semester")
        user = self.request.user
        if not user.is_exec:
            qs = qs.filter(project__in=visible_projects(user))
        if project_slug := self.request.query_params.get("project"):
            qs = qs.filter(project__slug=project_slug)

        # The term default scopes the *roster*, not a single row: exec editing
        # a backfilled past membership must still be able to reach it by URL.
        if self.action != "list":
            return qs

        semester = self.request.query_params.get("semester")
        if semester == "all":
            return qs
        if semester:
            return qs.filter(semester__slug=semester)
        current = current_semester(self.request)
        return qs.filter(semester=current) if current else qs.none()

    def _assert_can_manage(self, project, semester) -> None:
        user = self.request.user
        if user.is_exec:
            return
        if role_in_project(self.request, project.pk) != Role.LEAD:
            raise PermissionDenied("Only the project lead or Executive Committee can do this.")

        current = current_semester(self.request)
        if current is None or semester != current:
            raise PermissionDenied(
                f"{semester} has ended. A past roster is part of the record — "
                "ask the Executive Committee if it needs correcting."
            )

    def perform_create(self, serializer):
        semester = serializer.validated_data.get("semester")
        if semester is None:
            semester = current_semester(self.request)
            if semester is None:
                raise PermissionDenied(
                    "No semester has been created yet. "
                    "Ask the Executive Committee to open the term."
                )
        self._assert_can_manage(serializer.validated_data["project"], semester)
        serializer.save(semester=semester)

    def perform_update(self, serializer):
        self._assert_can_manage(serializer.instance.project, serializer.instance.semester)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_can_manage(instance.project, instance.semester)
        instance.delete()
