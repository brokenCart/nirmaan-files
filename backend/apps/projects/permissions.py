"""Role resolution and DRF permission classes.

Three rules govern the whole API:

1. ``user.is_exec`` grants org-wide access without any ``Membership`` row.
2. Everyone else is judged by their role on *the project the object belongs to*.
3. **Reading and writing resolve against different sets.** Roles are per
   semester, so "may I write here" asks about the *current* term's membership,
   while "may I read this" asks whether the user has *ever* been a member. A
   volunteer who was not carried into this term keeps the archive and loses the
   compose box.

That third rule is why :func:`membership_roles` and :func:`visible_project_ids`
no longer answer from the same query, and it is the easiest thing in this file
to get subtly wrong: resolving a write against the unscoped set silently hands
last year's lead their old powers back.

Permission classes gate actions; they do not hide rows. Listing endpoints must
still narrow their queryset (see :func:`visible_projects`), because a permission
class only ever sees objects the queryset already returned.
"""

from __future__ import annotations

from django.db.models import QuerySet
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import Membership, Project, Role, Semester

_ROLES_CACHE_ATTR = "_nirmaan_membership_roles"
_READABLE_CACHE_ATTR = "_nirmaan_readable_projects"
_SEMESTER_CACHE_ATTR = "_nirmaan_current_semester"

_MISSING = object()


def current_semester(request) -> Semester | None:
    """The term in progress, cached on the request.

    Every write check needs it, so resolving it once per request keeps a list
    endpoint to a single lookup. ``None`` means no semester has been created
    yet, which denies every write rather than silently falling back to an
    unscoped roster.
    """
    cached = getattr(request, _SEMESTER_CACHE_ATTR, _MISSING)
    if cached is not _MISSING:
        return cached

    semester = Semester.current()
    setattr(request, _SEMESTER_CACHE_ATTR, semester)
    return semester


def membership_roles(request) -> dict[int, str]:
    """Map of ``project_id -> role`` for the requesting user **this semester**.

    Resolved in one query and reused, so a list endpoint checking N objects does
    not issue N membership lookups. This is the set that governs writes; use
    :func:`visible_project_ids` for reads.
    """
    cached = getattr(request, _ROLES_CACHE_ATTR, None)
    if cached is not None:
        return cached

    user = getattr(request, "user", None)
    semester = current_semester(request)
    if user is None or not user.is_authenticated or semester is None:
        roles: dict[int, str] = {}
    else:
        roles = dict(
            Membership.objects.filter(user=user, is_active=True, semester=semester).values_list(
                "project_id", "role"
            )
        )

    setattr(request, _ROLES_CACHE_ATTR, roles)
    return roles


def role_in_project(request, project_id: int) -> str | None:
    """The user's role on ``project_id`` this semester, if any."""
    return membership_roles(request).get(project_id)


def visible_projects(user) -> QuerySet[Project]:
    """Projects ``user`` may see at all — membership in *any* semester.

    Deliberately unscoped by term: the timeline is institutional memory, and
    someone who ran a project two years ago can still open what they wrote.
    """
    if not user.is_authenticated:
        return Project.objects.none()
    if user.is_exec:
        return Project.objects.all()
    return Project.objects.filter(memberships__user=user, memberships__is_active=True).distinct()


def visible_project_ids(request) -> list[int] | None:
    """Project ids the user can read, or ``None`` meaning "no restriction".

    Cached per request like :func:`membership_roles`, and separate from it: a
    past member appears here but not there.
    """
    cached = getattr(request, _READABLE_CACHE_ATTR, _MISSING)
    if cached is not _MISSING:
        return cached

    user = request.user
    if user.is_authenticated and user.is_exec:
        ids: list[int] | None = None
    elif not user.is_authenticated:
        ids = []
    else:
        ids = list(
            Membership.objects.filter(user=user, is_active=True)
            .values_list("project_id", flat=True)
            .distinct()
        )

    setattr(request, _READABLE_CACHE_ATTR, ids)
    return ids


def can_read_project(request, project_id: int) -> bool:
    ids = visible_project_ids(request)
    return ids is None or project_id in ids


def _project_of(obj) -> Project | None:
    if isinstance(obj, Project):
        return obj
    return getattr(obj, "project", None)


class IsProjectMember(BasePermission):
    """Object belongs to a project the user has been a member of (or is exec).

    Membership in any semester is enough — this class is the read gate. Views
    that also accept writes through it must check the current term themselves;
    :class:`~apps.logs.views.DailyLogViewSet` and
    :class:`~apps.projects.views.MembershipViewSet` both do.
    """

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
        return can_read_project(request, project.pk)


class HasProjectRole(BasePermission):
    """Base for role-gated write access. Use :func:`require_roles` to build one.

    Reads are allowed for anyone who has ever been a member; writes require one
    of ``allowed_roles`` **held this semester**. Exec bypasses both.
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

        if request.method in SAFE_METHODS:
            return can_read_project(request, project.pk)
        return role_in_project(request, project.pk) in self.allowed_roles


def require_roles(*roles: str) -> type[HasProjectRole]:
    """Build a permission class allowing writes only for ``roles``."""
    names = tuple(roles)
    return type(
        f"HasProjectRole_{'_'.join(names)}",
        (HasProjectRole,),
        {"allowed_roles": names},
    )


class IsExec(BasePermission):
    """Reads for any signed-in user, writes for the Executive Committee only.

    Semesters are org-wide, so they are not a per-project question at all.
    """

    message = "Only the Executive Committee can change semesters."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user.is_authenticated:
            return False
        return request.method in SAFE_METHODS or user.is_exec


#: Writes restricted to whoever runs the project.
IsProjectLead = require_roles(Role.LEAD)

#: Writes for leads and finance leads — the default for project content.
IsProjectStaff = require_roles(Role.LEAD, Role.FINANCE_LEAD)
