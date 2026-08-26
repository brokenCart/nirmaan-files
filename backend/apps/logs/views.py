from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated

from apps.projects.models import Project, Role
from apps.projects.permissions import IsProjectMember, role_in_project

from .models import DailyLog, LogStatus
from .pagination import DailyLogPagination
from .serializers import DailyLogSerializer


class DailyLogViewSet(viewsets.ModelViewSet):
    """MOV and MOM entries on a project timeline.

    Write rules, beyond exec bypass:
      * leads and finance leads may write any log in their project;
      * a volunteer may create logs and edit their own while still a draft.

    Once a volunteer's log is published it becomes the project's record and only
    project staff can amend it.
    """

    serializer_class = DailyLogSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = DailyLogPagination
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = DailyLog.objects.none()

    def get_queryset(self):
        qs = (
            DailyLog.objects.visible_to(self.request)
            .select_related("project", "author")
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
        return qs

    def _assert_can_write(self, project: Project, instance: DailyLog | None) -> None:
        user = self.request.user
        if user.is_exec:
            return

        role = role_in_project(self.request, project.pk)
        if role is None:
            raise PermissionDenied("You are not a member of this project.")
        if role in (Role.LEAD, Role.FINANCE_LEAD):
            return

        # Volunteer.
        if instance is None:
            return
        if instance.author_id != user.pk:
            raise PermissionDenied("Volunteers can only edit their own logs.")
        if instance.status != LogStatus.DRAFT:
            raise PermissionDenied(
                "This log is published. Ask a project lead to make further changes."
            )

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        if project is None:
            raise ValidationError({"project": "This field is required."})
        self._assert_can_write(project, None)
        serializer.save(author=self.request.user)

    def perform_update(self, serializer):
        self._assert_can_write(serializer.instance.project, serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_can_write(instance.project, instance)
        # Soft delete: the timeline is the project's institutional memory.
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])
