from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated

from apps.projects.models import Project, Role
from apps.projects.permissions import IsProjectMember, role_in_project

from .models import DailyLog
from .pagination import DailyLogPagination
from .serializers import DailyLogSerializer


class DailyLogViewSet(viewsets.ModelViewSet):
    """MOV and MOM entries on a project timeline.

    Write rules:
      * any member of the project may file a log;
      * only its **author** may edit one — including after publishing, and
        including against leads and exec, who get no edit rights at all;
      * leads, finance leads and exec may delete any log in their project, and
        an author may delete their own.

    An entry is one person's account of what happened, so staff who disagree
    with it remove it rather than reword it under the author's name. Deletes
    are soft, which is what makes that safe.
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

    def _assert_can_create(self, project: Project) -> None:
        if self.request.user.is_exec:
            return
        if role_in_project(self.request, project.pk) is None:
            raise PermissionDenied("You are not a member of this project.")

    def _assert_can_edit(self, instance: DailyLog) -> None:
        # Authorship is the whole rule — no role grants an edit, exec included.
        # Membership is already established upstream: a non-member never gets
        # the row out of `visible_to`, so they see a 404 before reaching here.
        if instance.author_id != self.request.user.pk:
            raise PermissionDenied(
                "Only the author can edit this entry. Ask a project lead to remove it instead."
            )

    def _assert_can_delete(self, instance: DailyLog) -> None:
        user = self.request.user
        if user.is_exec:
            return

        role = role_in_project(self.request, instance.project_id)
        if role is None:
            raise PermissionDenied("You are not a member of this project.")
        if role in (Role.LEAD, Role.FINANCE_LEAD):
            return
        if instance.author_id != user.pk:
            raise PermissionDenied("Volunteers can only delete their own entries.")

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        if project is None:
            raise ValidationError({"project": "This field is required."})
        self._assert_can_create(project)
        serializer.save(author=self.request.user)

    def perform_update(self, serializer):
        self._assert_can_edit(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_can_delete(instance)
        # Soft delete: the timeline is the project's institutional memory.
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])
