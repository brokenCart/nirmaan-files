from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from apps.projects.models import Project, Role
from apps.projects.permissions import IsProjectMember, role_in_project

from .models import Resource
from .serializers import ResourceSerializer


class ResourceViewSet(viewsets.ModelViewSet):
    """A project's shelf of links — Drive folders, reports, forms.

    Write rules:
      * any member of the project **this semester** may add a link;
      * whoever added it, plus **leads, finance leads and exec**, may edit or
        remove it;
      * a past member reads the shelf and writes nothing, as everywhere else.

    That edit rule is deliberately wider than the timeline's, where only the
    author may edit and no role overrides it. An entry is one person's account
    of what happened, so rewording it under their name misrepresents them. A
    link is not an account of anything — it is a pointer, and pointers go stale.
    When a Drive folder moves, whoever runs the project has to be able to fix
    the URL without hunting down the volunteer who first pasted it.

    There is no term boundary to enforce because a resource has no term: see
    :class:`~apps.resources.models.Resource`. The shelf a project had in August
    is the shelf it still has in January.
    """

    serializer_class = ResourceSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    # Unpaginated, unlike the timeline. A shelf is a reference list that gets
    # scanned, not a feed that gets read — splitting a dozen links across pages
    # hides half of them behind a control nobody expects on this screen. The
    # ceiling is a project's own tidiness rather than a page size, which is the
    # right trade at this size and would not be at the timeline's.
    pagination_class = None
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = Resource.objects.none()

    def get_queryset(self):
        qs = Resource.objects.visible_to(self.request).select_related("project", "added_by")
        params = self.request.query_params
        if project_slug := params.get("project"):
            qs = qs.filter(project__slug=project_slug)
        if kind := params.get("kind"):
            qs = qs.filter(kind=kind)
        return qs

    def _assert_current_member(self, project: Project) -> str:
        """The caller's role on ``project`` this term, or a 403 explaining.

        Reading is wider than writing here exactly as it is on the timeline:
        `visible_to` admits anyone who was ever a member, so the roster check
        has to happen on the way in rather than being assumed upstream.
        """
        role = role_in_project(self.request, project.pk)
        if role is None:
            raise PermissionDenied(
                "You are not a member of this project this semester. "
                "You can open its links but not change them."
            )
        return role

    def _assert_can_change(self, resource: Resource) -> None:
        """Gate an edit or a removal: whoever added it, or whoever runs it."""
        user = self.request.user
        if user.is_exec:
            return

        role = self._assert_current_member(resource.project)
        if role in (Role.LEAD, Role.FINANCE_LEAD):
            return
        if resource.added_by_id != user.pk:
            raise PermissionDenied(
                "Only whoever added this link, or a project lead, can change it."
            )

    def perform_create(self, serializer):
        if not self.request.user.is_exec:
            self._assert_current_member(serializer.validated_data["project"])
        serializer.save(added_by=self.request.user)

    def perform_update(self, serializer):
        self._assert_can_change(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        # A hard delete, unlike a log's. A link is a pointer, not a published
        # account — see `Resource`.
        self._assert_can_change(instance)
        instance.delete()
