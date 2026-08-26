from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated

from apps.projects.models import Project, Role, Semester
from apps.projects.permissions import IsProjectMember, current_semester, role_in_project

from .models import DailyLog
from .pagination import DailyLogPagination
from .serializers import DailyLogSerializer


class DailyLogViewSet(viewsets.ModelViewSet):
    """MOV and MOM entries on a project timeline.

    Write rules:
      * any member of the project **this semester** may file a log;
      * only its **author**, and only while still a member this semester, may
        edit one — including after publishing, and including against leads and
        exec, who get no edit rights at all;
      * leads, finance leads and exec may delete any log in their project, and
        an author may delete their own;
      * a closed semester is frozen. Entries in a past term cannot be edited by
        anyone, and only exec can remove one.

    An entry is one person's account of what happened, so staff who disagree
    with it remove it rather than reword it under the author's name. Deletes
    are soft, which is what makes that safe.

    Reading is wider than writing: anyone who has ever been a member sees the
    whole archive. Filing against it is what stops at the term boundary.
    """

    serializer_class = DailyLogSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = DailyLogPagination
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = DailyLog.objects.none()

    def get_queryset(self):
        qs = (
            DailyLog.objects.visible_to(self.request)
            .select_related("project", "author", "semester")
            .prefetch_related("attendees")
        )
        params = self.request.query_params
        if project_slug := params.get("project"):
            qs = qs.filter(project__slug=project_slug)
        if kind := params.get("kind"):
            qs = qs.filter(kind=kind)
        if since := params.get("since"):
            qs = qs.filter(occurred_on__gte=since)
        if until := params.get("until"):
            qs = qs.filter(occurred_on__lte=until)

        # Scoping to a term is a property of the *feed*, not of an entry. A
        # detail route must reach an archived entry by its own URL — otherwise
        # every 403 the frozen-archive rule is meant to return arrives as a 404
        # instead, and the SPA cannot open a permalink into last year.
        if self.action != "list":
            return qs

        # `semester=all` reads across every term; an explicit slug reads one;
        # the default is the term in progress, so the timeline does not open on
        # three years of history.
        semester = params.get("semester")
        if semester == "all":
            return qs
        if semester:
            return qs.filter(semester__slug=semester)
        current = current_semester(self.request)
        return qs.filter(semester=current) if current else qs.none()

    def _open_semester(self) -> Semester:
        current = current_semester(self.request)
        if current is None:
            raise ValidationError(
                "No semester has been created yet. Ask the Executive Committee to open the term."
            )
        return current

    def _assert_can_create(self, project: Project, occurred_on) -> None:
        current = self._open_semester()
        if self.request.user.is_exec:
            return
        if role_in_project(self.request, project.pk) is None:
            raise PermissionDenied(
                "You are not a member of this project this semester. "
                "You can read its archive but not add to it."
            )
        # Backdating far enough would file a fresh entry straight into a closed
        # term, which is the frozen-archive rule with an extra step.
        landing = Semester.for_date(occurred_on)
        if landing is not None and landing.pk != current.pk:
            raise PermissionDenied(
                f"That date falls in {landing}, which has ended. "
                "Ask the Executive Committee to add it."
            )

    def _assert_is_open(self, instance: DailyLog) -> None:
        """Refuse to touch an entry that belongs to a closed term."""
        current = current_semester(self.request)
        if current is None or instance.semester_id != current.pk:
            raise PermissionDenied(
                f"{instance.semester} has ended. Entries in a past semester are part of "
                "the record and cannot be changed."
            )

    def _assert_can_edit(self, instance: DailyLog) -> None:
        # Two gates, then authorship. The term check runs first so a past member
        # editing an old entry is told the archive is closed rather than that
        # they are the author.
        self._assert_is_open(instance)

        # Membership is *not* established upstream: `visible_to` scopes to any
        # semester, so someone dropped from this term's roster still reads the
        # feed — and would otherwise keep editing the entries they filed while
        # they were on it. Write access ends with the membership, which is the
        # same rule `_assert_can_create` and `_assert_can_delete` apply.
        user = self.request.user
        if not user.is_exec and role_in_project(self.request, instance.project_id) is None:
            raise PermissionDenied(
                "You are not a member of this project this semester. "
                "You can read the timeline but no longer change it."
            )

        # Authorship is the rest of the rule — no role grants an edit, exec
        # included.
        if instance.author_id != self.request.user.pk:
            raise PermissionDenied(
                "Only the author can edit this entry. Ask a project lead to remove it instead."
            )

    def _assert_can_delete(self, instance: DailyLog) -> None:
        user = self.request.user
        if user.is_exec:
            # Exec keeps the moderation lever over the archive: something that
            # should never have been published must still be removable a year
            # on. The delete is soft, so this hides the entry, not the history.
            return

        self._assert_is_open(instance)

        role = role_in_project(self.request, instance.project_id)
        if role is None:
            raise PermissionDenied("You are not a member of this project this semester.")
        if role in (Role.LEAD, Role.FINANCE_LEAD):
            return
        if instance.author_id != user.pk:
            raise PermissionDenied("Volunteers can only delete their own entries.")

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        if project is None:
            raise ValidationError({"project": "This field is required."})
        self._assert_can_create(project, serializer.validated_data["occurred_on"])
        serializer.save(author=self.request.user)

    def perform_update(self, serializer):
        self._assert_can_edit(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_can_delete(instance)
        # Soft delete: the timeline is the project's institutional memory.
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])
