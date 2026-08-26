from django.db.models import Count, Q
from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from .models import Membership, Project, Role
from .permissions import (
    IsProjectLead,
    IsProjectMember,
    role_in_project,
    visible_projects,
)
from .serializers import MembershipSerializer, ProjectSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    """Projects (verticals).

    Only exec creates or deletes projects; leads may edit their own project's
    details. The queryset — not the permission class — is what keeps one
    project's rows out of another project's members' hands.
    """

    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated, IsProjectLead]
    lookup_field = "slug"
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = Project.objects.none()

    def get_queryset(self):
        return (
            visible_projects(self.request.user)
            .annotate(member_count=Count("memberships", filter=Q(memberships__is_active=True)))
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


class MembershipViewSet(viewsets.ModelViewSet):
    """Who belongs to which project, and in what role.

    Managed by project leads and exec. Volunteers can read the roster of
    projects they belong to but cannot change it.
    """

    serializer_class = MembershipSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = Membership.objects.none()

    def get_queryset(self):
        qs = Membership.objects.select_related("user", "project")
        user = self.request.user
        if not user.is_exec:
            qs = qs.filter(project__in=visible_projects(user))
        project_slug = self.request.query_params.get("project")
        if project_slug:
            qs = qs.filter(project__slug=project_slug)
        return qs

    def _assert_can_manage(self, project) -> None:
        user = self.request.user
        if user.is_exec:
            return
        if role_in_project(self.request, project.pk) != Role.LEAD:
            raise PermissionDenied("Only the project lead or Executive Committee can do this.")

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        self._assert_can_manage(project)
        serializer.save()

    def perform_update(self, serializer):
        self._assert_can_manage(serializer.instance.project)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_can_manage(instance.project)
        instance.delete()
