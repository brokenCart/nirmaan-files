"""Role resolution and DRF permission classes.

Two rules govern the whole API:

1. ``user.is_exec`` grants org-wide access without any ``Membership`` row.
2. Everyone else is judged by their role on *the project the object belongs to*.

Permission classes gate actions; they do not hide rows. Listing endpoints must
still narrow their queryset (see :func:`visible_projects`), because a permission
class only ever sees objects the queryset already returned.
"""

from __future__ import annotations

from django.db.models import QuerySet
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import Membership, Project, Role

_CACHE_ATTR = "_nirmaan_membership_roles"


def membership_roles(request) -> dict[int, str]:
    """Map of ``project_id -> role`` for the requesting user, cached per request.

    Resolved in one query and reused, so a list endpoint checking N objects does
    not issue N membership lookups.
    """
    cached = getattr(request, _CACHE_ATTR, None)
    if cached is not None:
        return cached

    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        roles: dict[int, str] = {}
    else:
        roles = dict(
            Membership.objects.filter(user=user, is_active=True).values_list("project_id", "role")
        )

    setattr(request, _CACHE_ATTR, roles)
    return roles


def role_in_project(request, project_id: int) -> str | None:
    return membership_roles(request).get(project_id)


def visible_projects(user) -> QuerySet[Project]:
    """Projects ``user`` may see at all."""
    if not user.is_authenticated:
        return Project.objects.none()
    if user.is_exec:
        return Project.objects.all()
    return Project.objects.filter(memberships__user=user, memberships__is_active=True).distinct()


def visible_project_ids(request) -> list[int] | None:
    """Project ids the user can read, or ``None`` meaning "no restriction"."""
    user = request.user
    if user.is_authenticated and user.is_exec:
        return None
    return list(membership_roles(request).keys())


def _project_of(obj) -> Project | None:
    if isinstance(obj, Project):
        return obj
    return getattr(obj, "project", None)


class IsProjectMember(BasePermission):
    """Object must belong to a project the user is a member of (or user is exec)."""

    message = "You are not a member of this project."

    def has_object_permission(self, request, view, obj) -> bool:
        user = request.user
        if not user.is_authenticated:
            return False
        if user.is_exec:
            return True
        project = _project_of(obj)
        if project is None:
            return False
        return role_in_project(request, project.pk) is not None


class HasProjectRole(BasePermission):
    """Base for role-gated write access. Use :func:`require_roles` to build one.

    Reads are allowed for any member; writes require one of ``allowed_roles``.
    Exec bypasses both.
    """

    allowed_roles: tuple[str, ...] = ()

    message = "Your role in this project does not allow this action."

    def has_object_permission(self, request, view, obj) -> bool:
        user = request.user
        if not user.is_authenticated:
            return False
        if user.is_exec:
            return True

        project = _project_of(obj)
        if project is None:
            return False

        role = role_in_project(request, project.pk)
        if role is None:
            return False
        if request.method in SAFE_METHODS:
            return True
        return role in self.allowed_roles


def require_roles(*roles: str) -> type[HasProjectRole]:
    """Build a permission class allowing writes only for ``roles``."""
    names = tuple(roles)
    return type(
        f"HasProjectRole_{'_'.join(names)}",
        (HasProjectRole,),
        {"allowed_roles": names},
    )


#: Writes restricted to whoever runs the project.
IsProjectLead = require_roles(Role.LEAD)

#: Writes for leads and finance leads — the default for project content.
IsProjectStaff = require_roles(Role.LEAD, Role.FINANCE_LEAD)
